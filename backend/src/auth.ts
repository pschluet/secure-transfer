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
/**
 * HTTP API JWT authorizers flatten every claim to a string, since the
 * authorizer context is a Map<string,string>. Cognito's `cognito:groups`
 * claim is a JSON array in the token itself, but API Gateway renders it here
 * as `"[Admins]"` / `"[Admins, Users]"` — bracketed but *not* valid JSON
 * (unquoted values) — rather than a JSON string or a bare comma list.
 */
function parseGroups(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw !== "string" || raw.length === 0) return [];
  let inner = raw.trim();
  if (inner.startsWith("[") && inner.endsWith("]")) {
    inner = inner.slice(1, -1);
  }
  if (inner.length === 0) return [];
  const parts = inner.includes(",") ? inner.split(",") : inner.split(/\s+/);
  return parts.map((g) => g.trim()).filter(Boolean);
}

export function getClaims(c: Context): Claims {
  const event = (c.env as { event: APIGatewayProxyEventV2WithJWTAuthorizer }).event;
  const claims = event.requestContext.authorizer.jwt.claims as Record<string, unknown>;
  return {
    sub: String(claims.sub),
    email: String(claims.email ?? ""),
    groups: parseGroups(claims["cognito:groups"]),
  };
}

export function isAdmin(claims: Claims): boolean {
  return claims.groups.includes("Admins");
}
