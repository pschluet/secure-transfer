import { describe, expect, it } from "vitest";
import type { Context } from "hono";
import { getClaims, isAdmin } from "../src/auth";

function ctx(claims: Record<string, unknown>): Context {
  return {
    env: { event: { requestContext: { authorizer: { jwt: { claims } } } } },
  } as unknown as Context;
}

// `parseGroups` isn't exported, so it's exercised through `getClaims`, which is
// the only production caller.
describe("getClaims group parsing", () => {
  it("parses a single bracketed non-JSON group string", () => {
    expect(getClaims(ctx({ sub: "s", "cognito:groups": "[Admins]" })).groups).toEqual(["Admins"]);
  });

  it("parses a multi-group bracketed string", () => {
    expect(getClaims(ctx({ sub: "s", "cognito:groups": "[Admins, Users]" })).groups).toEqual([
      "Admins",
      "Users",
    ]);
  });

  it("accepts a real JSON array", () => {
    expect(getClaims(ctx({ sub: "s", "cognito:groups": ["Admins", "Users"] })).groups).toEqual([
      "Admins",
      "Users",
    ]);
  });

  it("parses a bare unbracketed string", () => {
    expect(getClaims(ctx({ sub: "s", "cognito:groups": "Admins" })).groups).toEqual(["Admins"]);
  });

  it("returns [] for undefined groups", () => {
    expect(getClaims(ctx({ sub: "s" })).groups).toEqual([]);
  });

  it("returns [] for an empty string", () => {
    expect(getClaims(ctx({ sub: "s", "cognito:groups": "" })).groups).toEqual([]);
  });

  it("returns [] for an empty bracket string", () => {
    expect(getClaims(ctx({ sub: "s", "cognito:groups": "[]" })).groups).toEqual([]);
  });
});

describe("getClaims field extraction", () => {
  it("extracts sub and email", () => {
    const claims = getClaims(ctx({ sub: "user-1", email: "a@b.com" }));
    expect(claims.sub).toBe("user-1");
    expect(claims.email).toBe("a@b.com");
  });

  it("defaults email to empty string when absent", () => {
    expect(getClaims(ctx({ sub: "user-1" })).email).toBe("");
  });
});

describe("isAdmin", () => {
  it("is true when groups include Admins", () => {
    expect(isAdmin({ sub: "s", email: "e", groups: ["Users", "Admins"] })).toBe(true);
  });

  it("is false when groups do not include Admins", () => {
    expect(isAdmin({ sub: "s", email: "e", groups: ["Users"] })).toBe(false);
  });

  it("is false for empty groups", () => {
    expect(isAdmin({ sub: "s", email: "e", groups: [] })).toBe(false);
  });
});
