// Builders for the Lambda-shaped `env` that Hono passes to `c.env`, plus small
// request helpers. `getClaims` reads `event.requestContext.authorizer.jwt.claims`.

export function env(claims: Record<string, unknown>) {
  return { event: { requestContext: { authorizer: { jwt: { claims } } } } };
}

export function adminClaims(over: Record<string, unknown> = {}) {
  return {
    sub: "admin-1",
    email: "admin@test.example",
    "cognito:groups": "[Admins]",
    ...over,
  };
}

export function userClaims(over: Record<string, unknown> = {}) {
  return { sub: "user-1", email: "user@example.com", ...over };
}

export function jsonReq(method: string, body?: unknown): RequestInit {
  if (body === undefined) return { method };
  return {
    method,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  };
}
