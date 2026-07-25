import * as path from "node:path";
import {
  Stack,
  StackProps,
  RemovalPolicy,
  Duration,
  CfnOutput,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import * as iam from "aws-cdk-lib/aws-iam";

export interface SecureTransferStackProps extends StackProps {
  /** "owner/repo" allowed to assume the GitHub Actions deploy role. */
  readonly githubRepo: string;
  /** Admin's own email — notified when someone sends files. */
  readonly adminEmail: string;
  readonly domainName: string;
  readonly hostedZoneId: string;
  readonly hostedZoneName: string;
  /** Must be an ISSUED cert in us-east-1 covering domainName. */
  readonly certificateArn: string;
}

export class SecureTransferStack extends Stack {
  constructor(scope: Construct, id: string, props: SecureTransferStackProps) {
    super(scope, id, props);

    const { githubRepo, adminEmail, domainName, hostedZoneId, hostedZoneName, certificateArn } =
      props;

    // -------------------------------------------------------------------
    // DynamoDB — single table + one GSI for admin-wide list views
    // -------------------------------------------------------------------
    const table = new dynamodb.Table(this, "Table", {
      tableName: "SecureTransfer",
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    table.addGlobalSecondaryIndex({
      indexName: "GSI1",
      partitionKey: { name: "gsi1pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "gsi1sk", type: dynamodb.AttributeType.STRING },
    });

    // -------------------------------------------------------------------
    // S3 — files bucket (kept forever, admin deletes manually) + SPA bucket
    // -------------------------------------------------------------------
    const filesBucket = new s3.Bucket(this, "FilesBucket", {
      removalPolicy: RemovalPolicy.RETAIN,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedOrigins: [`https://${domainName}`, "http://localhost:5173"],
          allowedHeaders: ["*"],
          exposedHeaders: ["ETag"],
          maxAge: 3000,
        },
      ],
    });

    const siteBucket = new s3.Bucket(this, "SiteBucket", {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
    });

    // -------------------------------------------------------------------
    // Cognito — passwordless email-OTP for everyone, "Admins" group
    // -------------------------------------------------------------------
    const userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: "secure-transfer",
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        givenName: { required: true, mutable: true },
        familyName: { required: true, mutable: true },
        email: { required: true, mutable: true },
      },
      accountRecovery: cognito.AccountRecovery.NONE,
      removalPolicy: RemovalPolicy.RETAIN,
      featurePlan: cognito.FeaturePlan.ESSENTIALS, // required for choice-based/passwordless auth
      signInPolicy: {
        allowedFirstAuthFactors: {
          // Cognito requires password to remain an allowed factor at the
          // policy level, but admin-created users are never given one, so
          // in practice only email OTP is usable.
          password: true,
          emailOtp: true,
        },
      },
      email: cognito.UserPoolEmail.withSES({
        fromEmail: `no-reply@${hostedZoneName}`,
        fromName: "Secure Transfer",
        sesRegion: "us-east-1",
        sesVerifiedDomain: hostedZoneName,
      }),
    });

    const userPoolClient = userPool.addClient("SpaClient", {
      authFlows: { user: true }, // enables USER_AUTH (choice-based / passwordless)
      disableOAuth: true, // the SPA calls the Auth SDK directly; no Hosted UI/OAuth redirect flow
      generateSecret: false,
      preventUserExistenceErrors: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
    });

    new cognito.CfnUserPoolGroup(this, "AdminsGroup", {
      userPoolId: userPool.userPoolId,
      groupName: "Admins",
      description: "Users who can access the admin dashboard",
    });

    // -------------------------------------------------------------------
    // Lambdas
    // -------------------------------------------------------------------
    const backendDir = path.join(__dirname, "..", "..", "backend", "src");
    const sesIdentityArn = `arn:aws:ses:${this.region}:${this.account}:identity/${hostedZoneName}`;

    const commonEnv = {
      TABLE_NAME: table.tableName,
      FROM_EMAIL: `no-reply@${hostedZoneName}`,
      SITE_URL: `https://${domainName}`,
    };

    const apiFn = new NodejsFunction(this, "ApiFunction", {
      entry: path.join(backendDir, "api.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(15),
      bundling: { minify: true, target: "node22" },
      environment: {
        ...commonEnv,
        FILES_BUCKET: filesBucket.bucketName,
        USER_POOL_ID: userPool.userPoolId,
        ALLOWED_ORIGIN: `https://${domainName}`,
      },
    });
    table.grantReadWriteData(apiFn);
    filesBucket.grantReadWrite(apiFn);
    filesBucket.grantDelete(apiFn);
    apiFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cognito-idp:AdminCreateUser"],
        resources: [userPool.userPoolArn],
      })
    );
    apiFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ses:SendEmail", "ses:SendRawEmail"],
        resources: [sesIdentityArn],
      })
    );

    const s3EventFn = new NodejsFunction(this, "S3EventFunction", {
      entry: path.join(backendDir, "s3-event.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { minify: true, target: "node22" },
      environment: {
        ...commonEnv,
        ADMIN_EMAIL: adminEmail,
      },
    });
    table.grantReadWriteData(s3EventFn);
    s3EventFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ses:SendEmail", "ses:SendRawEmail"],
        resources: [sesIdentityArn],
      })
    );

    filesBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(s3EventFn)
    );

    // -------------------------------------------------------------------
    // HTTP API — single JWT-authenticated Lambda behind /api/*
    // -------------------------------------------------------------------
    const issuer = `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`;
    const authorizer = new HttpJwtAuthorizer("JwtAuthorizer", issuer, {
      jwtAudience: [userPoolClient.userPoolClientId],
    });

    const httpApi = new apigwv2.HttpApi(this, "HttpApi", {
      apiName: "secure-transfer-api",
      defaultAuthorizer: authorizer,
    });

    httpApi.addRoutes({
      path: "/api/{proxy+}",
      methods: [apigwv2.HttpMethod.ANY],
      integration: new HttpLambdaIntegration("ApiIntegration", apiFn),
    });

    // -------------------------------------------------------------------
    // CloudFront — SPA at "/", API at "/api/*" on the same origin (no CORS)
    // -------------------------------------------------------------------
    const certificate = acm.Certificate.fromCertificateArn(this, "Certificate", certificateArn);
    const apiDomain = `${httpApi.apiId}.execute-api.${this.region}.amazonaws.com`;

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      domainNames: [domainName],
      certificate,
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      additionalBehaviors: {
        "/api/*": {
          origin: new origins.HttpOrigin(apiDomain, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        },
      },
      // No custom error responses: this app has no client-side routing (a
      // single "/" that switches views by auth state, not by URL), so there's
      // no SPA-fallback path to rewrite — and a distribution-wide 403/404
      // rewrite would also swallow real 403/404 JSON responses from /api/*.
    });

    // -------------------------------------------------------------------
    // DNS — transfer.pauldev.io -> CloudFront
    // -------------------------------------------------------------------
    const zone = route53.HostedZone.fromHostedZoneAttributes(this, "Zone", {
      hostedZoneId,
      zoneName: hostedZoneName,
    });
    new route53.ARecord(this, "AliasRecord", {
      zone,
      recordName: domainName,
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
    });
    new route53.AaaaRecord(this, "AliasRecordV6", {
      zone,
      recordName: domainName,
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
    });

    // -------------------------------------------------------------------
    // GitHub Actions OIDC deploy role — scoped to the CDK bootstrap roles
    // (not AdministratorAccess) and to this one repo.
    // -------------------------------------------------------------------
    const githubProvider = new iam.OpenIdConnectProvider(this, "GitHubOidcProvider", {
      url: "https://token.actions.githubusercontent.com",
      clientIds: ["sts.amazonaws.com"],
    });

    // GitHub embeds immutable owner/repo IDs in the sub claim (e.g.
    // "repo:owner@123/repo@456:ref:...") rather than the plain
    // "repo:owner/repo:*" form, so match both to be safe.
    const [githubOwner, githubRepoName] = githubRepo.split("/");
    const deployRole = new iam.Role(this, "GitHubDeployRole", {
      roleName: "secure-transfer-github-deploy",
      assumedBy: new iam.WebIdentityPrincipal(githubProvider.openIdConnectProviderArn, {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        },
        StringLike: {
          "token.actions.githubusercontent.com:sub": [
            `repo:${githubRepo}:*`,
            `repo:${githubOwner}@*/${githubRepoName}@*:*`,
          ],
        },
      }),
      maxSessionDuration: Duration.hours(1),
    });
    // CDK bootstrap creates deploy/file-publishing/image-publishing/lookup
    // roles in this account; assuming those (rather than granting broad
    // service permissions directly) is the standard least-privilege pattern
    // for CDK-via-GitHub-Actions.
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["sts:AssumeRole"],
        resources: [`arn:aws:iam::${this.account}:role/cdk-hnb659fds-*`],
      })
    );
    // Needed for `cdk deploy` to read bootstrap stack/version info directly.
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["cloudformation:DescribeStacks"],
        resources: [`arn:aws:cloudformation:${this.region}:${this.account}:stack/CDKToolkit/*`],
      })
    );
    // Needed to sync the built SPA and invalidate the cache after deploy.
    siteBucket.grantReadWrite(deployRole);
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["cloudfront:CreateInvalidation"],
        resources: [
          `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
        ],
      })
    );

    // -------------------------------------------------------------------
    // Outputs
    // -------------------------------------------------------------------
    new CfnOutput(this, "SiteUrl", { value: `https://${domainName}` });
    new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId });
    new CfnOutput(this, "HttpApiUrl", { value: httpApi.apiEndpoint });
    new CfnOutput(this, "SiteBucketName", { value: siteBucket.bucketName });
    new CfnOutput(this, "FilesBucketName", { value: filesBucket.bucketName });
    new CfnOutput(this, "DistributionId", { value: distribution.distributionId });
    new CfnOutput(this, "GitHubDeployRoleArn", { value: deployRole.roleArn });
  }
}
