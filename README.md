# Secure Transfer

A small, low-traffic file transfer site at **transfer.pauldev.io**. Everyone (admin and
recipients) signs in with a passwordless email one-time code via Cognito. The admin creates
users, shares files with a chosen expiration, and can see who has downloaded what and who has
sent files back. Recipients can always send files to the admin, and can download whatever's been
shared with them until it expires.

## Architecture

- **Frontend:** React + Vite SPA, hosted on a private S3 bucket behind CloudFront.
- **Auth:** Cognito User Pool (Essentials tier), email-OTP passwordless sign-in for everyone.
  Admin is a user in the `Admins` group.
- **API:** API Gateway HTTP API with a Cognito JWT authorizer, one Lambda (Hono router,
  `backend/src/api.ts`). CloudFront routes `/api/*` to it, so the SPA and API share an origin
  (no CORS needed in production).
- **Storage:** files are uploaded directly to S3 via presigned URLs — no zipping, no server
  bottleneck. Multiple files uploaded together are tracked as one "group." An S3 event Lambda
  (`backend/src/s3-event.ts`) marks files ready and emails a notification once a whole group has
  landed.
- **Database:** one DynamoDB table (on-demand billing) + one GSI for admin-wide list views.
- **Retention:** files and data are kept forever (`RemovalPolicy.RETAIN` on the table and files
  bucket) — the admin deletes things manually from the dashboard.
- **Email:** SES, from `no-reply@pauldev.io` — used for OTP codes (via Cognito) and for share/upload
  notifications.

Cost at this scale is effectively pennies a month: on-demand DynamoDB, Lambda free tier, HTTP API
(~$1/million requests), S3 storage, Cognito Essentials (free under 10,000 MAU), SES ($0.10/1,000
emails).

## One-time setup

These steps happen once, outside of normal `git push` deploys.

### 1. Install dependencies

```sh
npm install
```

### 2. Bootstrap CDK in us-east-1

The app deploys entirely to **us-east-1** (where the `pauldev.io` SES identity and the
`*.pauldev.io` ACM certificate already live). CDK is likely already bootstrapped in your default
region (us-east-2) but needs a one-time bootstrap in us-east-1 too:

```sh
npx --prefix infra cdk bootstrap aws://435432815368/us-east-1
```

### 3. Confirm SES is ready

Check that `pauldev.io` is DKIM-verified:

```sh
aws sesv2 get-email-identity --email-identity pauldev.io --region us-east-1
```

If `DkimAttributes.Status` isn't `SUCCESS`, add the DKIM CNAME records it lists to the
`pauldev.io` Route53 zone.

**Request SES production access** (SES starts in sandbox mode, which only sends to
pre-verified addresses):

```sh
aws sesv2 get-account --region us-east-1 --query ProductionAccessEnabled
```

If `false`, request production access from the SES console (Account dashboard → "Request
production access"). Until that's approved, OTP codes and notifications will only reach email
addresses you've manually verified in SES.

### 4. Check the CDK context defaults

`infra/bin/app.ts` defaults `githubRepo` to `paulschlueter/secure-transfer` and `adminEmail` to
`paul@paulschlueter.com` — the GitHub OIDC deploy role is scoped to the former, and the latter
gets notified when someone sends you files. Override either at deploy time if needed:

```sh
npx cdk deploy -c githubRepo=your-org/your-repo -c adminEmail=you@example.com
```

### 5. First deploy (must be run locally, not from CI)

The GitHub Actions workflow assumes an IAM role that this same deploy creates — so the very
first deploy has to happen from your own machine with your AWS credentials:

```sh
cd infra
npx cdk deploy --outputs-file outputs.json
```

This creates everything: Cognito, DynamoDB, S3, the Lambdas, CloudFront, the `transfer.pauldev.io`
DNS record, and the GitHub OIDC deploy role. Note the outputs (`UserPoolId`,
`UserPoolClientId`, `SiteBucketName`, `DistributionId`) — the deploy workflow reads these from
`outputs.json` automatically on subsequent runs, but you'll want `UserPoolId` for the next step.

### 6. Create your own admin user

```sh
USER_POOL_ID=<UserPoolId from outputs.json>

aws cognito-idp admin-create-user \
  --user-pool-id "$USER_POOL_ID" \
  --username paul@paulschlueter.com \
  --user-attributes Name=email,Value=paul@paulschlueter.com Name=email_verified,Value=true \
                     Name=given_name,Value=Paul Name=family_name,Value=Schlueter \
  --message-action SUPPRESS \
  --region us-east-1

aws cognito-idp admin-add-user-to-group \
  --user-pool-id "$USER_POOL_ID" \
  --username paul@paulschlueter.com \
  --group-name Admins \
  --region us-east-1
```

(This bypasses the app's own "create user" API, so it won't have a DynamoDB profile row — that's
fine, the admin dashboard doesn't need one for itself. Every other user should be created from the
admin dashboard instead, which wires up the DynamoDB record and sends the invite email.)

### 7. Build and publish the frontend once

The first `cdk deploy` only stands up infrastructure — the site bucket is still empty. Build and
publish manually the first time (subsequent pushes to `main` do this automatically):

```sh
cd frontend
VITE_USER_POOL_ID=$(jq -r '.SecureTransferStack.UserPoolId' ../infra/outputs.json) \
VITE_USER_POOL_CLIENT_ID=$(jq -r '.SecureTransferStack.UserPoolClientId' ../infra/outputs.json) \
  npm run build
aws s3 sync dist "s3://$(jq -r '.SecureTransferStack.SiteBucketName' ../infra/outputs.json)" --delete
aws cloudfront create-invalidation \
  --distribution-id "$(jq -r '.SecureTransferStack.DistributionId' ../infra/outputs.json)" \
  --paths "/*"
```

### 8. Push to GitHub

Create the repo (matching the `githubRepo` context value), push, and from then on every push to
`main` deploys automatically via `.github/workflows/deploy.yml` — no secrets to configure, since
the role ARN is deterministic (`arn:aws:iam::435432815368:role/secure-transfer-github-deploy`) and
trusts only that one repo.

## Local development

```sh
npm run --prefix backend typecheck
npm run --prefix infra synth
npm run --prefix frontend dev
```

The Vite dev server proxies `/api/*` to `http://localhost:3000` by default (set
`VITE_DEV_API_PROXY_TARGET` to point at a deployed HttpApi instead). You'll also need a
`frontend/.env.local` with `VITE_USER_POOL_ID` / `VITE_USER_POOL_CLIENT_ID` from your deployed
stack — see `frontend/.env.example`.

## Repository layout

```
infra/      CDK app — the whole stack lives in infra/lib/secure-transfer-stack.ts
backend/    Lambda source (Hono API + S3 event handler), shared by both functions
frontend/   React SPA
```
