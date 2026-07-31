import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/api";
import { db, resetDb } from "./helpers/fakeDb";
import { adminClaims, env, jsonReq, userClaims } from "./helpers/request";

vi.mock("../src/db", async () => {
  const { db } = await import("./helpers/fakeDb");
  return { db };
});

vi.mock("ulid", async () => await import("./helpers/ulid"));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn().mockResolvedValue("https://signed.example/fake-url"),
}));

beforeEach(() => {
  resetDb();
  vi.restoreAllMocks();
});

const adminRoutes: [string, string][] = [
  ["GET", "/api/admin/users"],
  ["POST", "/api/admin/users"],
  ["PATCH", "/api/admin/users/some-sub"],
  ["DELETE", "/api/admin/users/some-sub"],
  ["GET", "/api/admin/shares"],
  ["POST", "/api/admin/users/some-sub/shares"],
  ["DELETE", "/api/admin/users/some-sub/shares/some-id"],
  ["GET", "/api/admin/uploads"],
  ["GET", "/api/admin/users/s/uploads/i/files/f/download"],
  ["DELETE", "/api/admin/users/some-sub/uploads/some-id"],
  ["GET", "/api/admin/audit"],
];

describe("admin authorization", () => {
  for (const [method, path] of adminRoutes) {
    it(`403s ${method} ${path} for a non-admin`, async () => {
      const res = await app.request(path, jsonReq(method), env(userClaims()));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "Forbidden" });
    });
  }

  it("lets an admin reach the handler", async () => {
    const res = await app.request("/api/admin/users", { method: "GET" }, env(adminClaims()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

describe("error mapping", () => {
  it("maps a Zod validation failure to 400 with details", async () => {
    const res = await app.request(
      "/api/admin/users",
      jsonReq("POST", { firstName: "", lastName: "Doe", email: "not-an-email" }),
      env(adminClaims())
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; details: unknown[] };
    expect(body.error).toBe("Invalid request");
    expect(Array.isArray(body.details)).toBe(true);
    expect(body.details.length).toBeGreaterThan(0);
  });

  it("maps an unexpected error to 500", async () => {
    vi.spyOn(db, "queryGsi1").mockRejectedValueOnce(new Error("boom"));
    const res = await app.request("/api/admin/users", { method: "GET" }, env(adminClaims()));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal error" });
  });
});
