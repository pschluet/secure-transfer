import type { Context } from "hono";
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";

export interface Claims {
  sub: string;
  email: string;
  groups: string[];
}

/**
 * Hono's aws-lambda adapter exposes the raw Lambda event/context via `c.env`
 * when the handler is created with `handle(app)`. The HTTP API JWT authorizer
 * (configured against the Cognito user pool, validating ID tokens) populates
 * `requestContext.authorizer.jwt.claims`.
 */
export function getClaims(c: Context): Claims {
  const event = (c.env as { event: APIGatewayProxyEventV2WithJWTAuthorizer })
    .event;
  const claims = event.requestContext.authorizer.jwt.claims as Record<
    string,
    unknown
  >;
  const rawGroups = claims["cognito:groups"];
  const groups = Array.isArray(rawGroups)
    ? (rawGroups as string[])
    : typeof rawGroups === "string"
      ? rawGroups.split(",")
      : [];
  return {
    sub: String(claims.sub),
    email: String(claims.email ?? ""),
    groups,
  };
}

export function isAdmin(claims: Claims): boolean {
  return claims.groups.includes("Admins");
}
