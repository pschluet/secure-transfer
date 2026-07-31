import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, it } from "vitest";
import { SecureTransferStack } from "../lib/secure-transfer-stack";

let template: Template;

beforeAll(() => {
  const app = new App();
  const stack = new SecureTransferStack(app, "TestStack", {
    env: { account: "435432815368", region: "us-east-1" },
    githubRepo: "pschluet/secure-transfer",
    adminEmail: "paul@paulschlueter.com",
    domainName: "transfer.pauldev.io",
    hostedZoneId: "Z0005541NUHRO213TE6L",
    hostedZoneName: "pauldev.io",
    certificateArn:
      "arn:aws:acm:us-east-1:435432815368:certificate/e2fec70c-b80c-4143-b853-105c118d4749",
  });
  template = Template.fromStack(stack);
});

const ALL_PUBLIC_ACCESS_BLOCKED = {
  BlockPublicAcls: true,
  BlockPublicPolicy: true,
  IgnorePublicAcls: true,
  RestrictPublicBuckets: true,
};

const S3_MANAGED_ENCRYPTION = {
  ServerSideEncryptionConfiguration: [
    { ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } },
  ],
};

describe("Files bucket", () => {
  it("blocks all public access", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      CorsConfiguration: Match.objectLike({
        CorsRules: Match.arrayWith([
          Match.objectLike({
            AllowedOrigins: ["https://transfer.pauldev.io", "http://localhost:5173"],
          }),
        ]),
      }),
      PublicAccessBlockConfiguration: ALL_PUBLIC_ACCESS_BLOCKED,
    });
  });

  it("uses S3-managed server-side encryption", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      CorsConfiguration: Match.anyValue(),
      BucketEncryption: S3_MANAGED_ENCRYPTION,
    });
  });

  it("is retained on stack deletion (holds user data)", () => {
    template.hasResource("AWS::S3::Bucket", {
      Properties: Match.objectLike({ CorsConfiguration: Match.anyValue() }),
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
    });
  });

  it("denies non-TLS requests via its bucket policy", () => {
    template.hasResourceProperties("AWS::S3::BucketPolicy", {
      Bucket: Match.objectLike({ Ref: Match.stringLikeRegexp("FilesBucket") }),
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: "Deny",
            Action: "s3:*",
            Condition: { Bool: { "aws:SecureTransport": "false" } },
          }),
        ]),
      }),
    });
  });
});

describe("Site bucket", () => {
  it("blocks all public access and is encrypted", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      Tags: Match.arrayWith([{ Key: "aws-cdk:auto-delete-objects", Value: "true" }]),
      PublicAccessBlockConfiguration: ALL_PUBLIC_ACCESS_BLOCKED,
      BucketEncryption: S3_MANAGED_ENCRYPTION,
    });
  });

  it("is destroyed on stack deletion with auto-delete (holds no user data)", () => {
    template.hasResource("AWS::S3::Bucket", {
      Properties: Match.objectLike({
        Tags: Match.arrayWith([{ Key: "aws-cdk:auto-delete-objects", Value: "true" }]),
      }),
      DeletionPolicy: "Delete",
      UpdateReplacePolicy: "Delete",
    });
    template.resourceCountIs("Custom::S3AutoDeleteObjects", 1);
  });
});

describe("DynamoDB table", () => {
  it("is on-demand billed with a GSI1 index and retained", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      BillingMode: "PAY_PER_REQUEST",
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({
          IndexName: "GSI1",
          KeySchema: [
            { AttributeName: "gsi1pk", KeyType: "HASH" },
            { AttributeName: "gsi1sk", KeyType: "RANGE" },
          ],
        }),
      ]),
    });
    template.hasResource("AWS::DynamoDB::Table", {
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
    });
  });
});

describe("Cognito user pool", () => {
  it("disables self-signup and signs in by email alias", () => {
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
      UsernameAttributes: ["email"],
    });
  });

  it("defines an Admins group", () => {
    template.hasResourceProperties("AWS::Cognito::UserPoolGroup", {
      GroupName: "Admins",
    });
  });

  it("issues 1-hour access/ID tokens and a 30-day refresh token", () => {
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      AccessTokenValidity: 60,
      IdTokenValidity: 60,
      RefreshTokenValidity: 43200,
      TokenValidityUnits: {
        AccessToken: "minutes",
        IdToken: "minutes",
        RefreshToken: "minutes",
      },
    });
  });
});

describe("HTTP API", () => {
  it("has a JWT authorizer bound to the user pool and SPA client", () => {
    template.hasResourceProperties("AWS::ApiGatewayV2::Authorizer", {
      AuthorizerType: "JWT",
      JwtConfiguration: {
        Audience: [{ Ref: Match.stringLikeRegexp("UserPoolSpaClient") }],
        Issuer: {
          "Fn::Join": [
            "",
            [
              "https://cognito-idp.us-east-1.amazonaws.com/",
              { Ref: Match.stringLikeRegexp("UserPool") },
            ],
          ],
        },
      },
    });
  });

  it("protects the /api/{proxy+} route with the JWT authorizer", () => {
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "ANY /api/{proxy+}",
      AuthorizationType: "JWT",
      AuthorizerId: { Ref: Match.stringLikeRegexp("JwtAuthorizer") },
    });
  });
});

describe("CloudFront distribution", () => {
  it("redirects HTTP to HTTPS on the default behavior", () => {
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          ViewerProtocolPolicy: "redirect-to-https",
        }),
      }),
    });
  });

  it("serves /api/* from an HTTPS-only origin with caching disabled", () => {
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({
            PathPattern: "/api/*",
            ViewerProtocolPolicy: "redirect-to-https",
            // Managed CachePolicy "CachingDisabled".
            CachePolicyId: "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
          }),
        ]),
        Origins: Match.arrayWith([
          Match.objectLike({
            CustomOriginConfig: Match.objectLike({ OriginProtocolPolicy: "https-only" }),
            DomainName: {
              "Fn::Join": [
                "",
                [
                  { Ref: Match.stringLikeRegexp("HttpApi") },
                  ".execute-api.us-east-1.amazonaws.com",
                ],
              ],
            },
          }),
        ]),
      }),
    });
  });
});

describe("API Lambda IAM policy", () => {
  it("scopes Cognito admin actions to the user pool ARN", () => {
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: "Allow",
            Action: Match.arrayWith([
              "cognito-idp:AdminCreateUser",
              "cognito-idp:AdminUpdateUserAttributes",
              "cognito-idp:AdminDeleteUser",
            ]),
            Resource: { "Fn::GetAtt": [Match.stringLikeRegexp("UserPool"), "Arn"] },
          }),
        ]),
      }),
    });
  });

  it("scopes SES send actions to the specific SES identity ARN", () => {
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: "Allow",
            Action: ["ses:SendEmail", "ses:SendRawEmail"],
            Resource: "arn:aws:ses:us-east-1:435432815368:identity/pauldev.io",
          }),
        ]),
      }),
    });
  });
});

describe("GitHub OIDC deploy role", () => {
  it("restricts the trust policy to the configured repo and audience", () => {
    template.hasResourceProperties("AWS::IAM::Role", {
      RoleName: "secure-transfer-github-deploy",
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: "sts:AssumeRoleWithWebIdentity",
            Condition: {
              StringEquals: {
                "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
              },
              StringLike: {
                "token.actions.githubusercontent.com:sub": [
                  "repo:pschluet/secure-transfer:*",
                  "repo:pschluet@*/secure-transfer@*:*",
                ],
              },
            },
          }),
        ]),
      }),
    });
  });
});
