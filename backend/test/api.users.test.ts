import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminUpdateUserAttributesCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/api";
import { deleteObject } from "../src/s3";
import type { ShareGroup, UploadGroup, UserProfile } from "../src/types";
import { db, resetDb, seed } from "./helpers/fakeDb";
import { adminClaims, env, jsonReq } from "./helpers/request";

vi.mock("../src/db", async () => {
  const { db } = await import("./helpers/fakeDb");
  return { db };
});

vi.mock("../src/s3", async () => {
  const actual = await vi.importActual<typeof import("../src/s3")>("../src/s3");
  return {
    ...actual,
    presignUpload: vi.fn(async (key: string) => `https://upload/${key}`),
    presignDownload: vi.fn(
      async (key: string, name: string) => `https://download/${key}?n=${name}`
    ),
    deleteObject: vi.fn(async () => {}),
  };
});

vi.mock("ulid", async () => await import("./helpers/ulid"));

const cognitoMock = mockClient(CognitoIdentityProviderClient);
const sesMock = mockClient(SESv2Client);

function profile(over: Partial<UserProfile> & { sub: string }): UserProfile {
  return {
    pk: `USER#${over.sub}`,
    sk: "PROFILE",
    email: `${over.sub}@example.com`,
    firstName: "First",
    lastName: "Last",
    createdAt: "2026-01-01T00:00:00.000Z",
    gsi1pk: "USERS",
    gsi1sk: `${over.sub}@example.com`,
    ...over,
  };
}

beforeEach(() => {
  resetDb();
  cognitoMock.reset();
  sesMock.reset();
  sesMock.on(SendEmailCommand).resolves({});
  vi.mocked(deleteObject).mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-30T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /admin/users", () => {
  it("creates a user (Cognito suppressed, lowercased email, profile, invite)", async () => {
    cognitoMock
      .on(AdminCreateUserCommand)
      .resolves({ User: { Attributes: [{ Name: "sub", Value: "new-sub" }] } });

    const res = await app.request(
      "/api/admin/users",
      jsonReq("POST", { firstName: "Ada", lastName: "Byron", email: "Ada@Example.COM" }),
      env(adminClaims())
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      pk: "USER#new-sub",
      sk: "PROFILE",
      sub: "new-sub",
      email: "ada@example.com",
      firstName: "Ada",
      lastName: "Byron",
      createdAt: "2026-07-30T12:00:00.000Z",
      gsi1pk: "USERS",
      gsi1sk: "ada@example.com",
    });

    const createInput = cognitoMock.commandCalls(AdminCreateUserCommand)[0].args[0].input;
    expect(createInput.MessageAction).toBe("SUPPRESS");
    expect(createInput.Username).toBe("ada@example.com");
    expect(createInput.UserAttributes).toContainEqual({ Name: "email", Value: "ada@example.com" });

    const stored = await db.get<UserProfile>("USER#new-sub", "PROFILE");
    expect(stored?.email).toBe("ada@example.com");

    const emailInput = sesMock.commandCalls(SendEmailCommand)[0].args[0].input;
    expect(emailInput.Destination?.ToAddresses).toEqual(["ada@example.com"]);
    expect(emailInput.Content?.Simple?.Subject?.Data).toBe("You've been added to Secure Transfer");
  });

  it("returns 500 when Cognito response has no sub", async () => {
    cognitoMock.on(AdminCreateUserCommand).resolves({ User: { Attributes: [] } });
    const res = await app.request(
      "/api/admin/users",
      jsonReq("POST", { firstName: "Ada", lastName: "Byron", email: "ada@example.com" }),
      env(adminClaims())
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to create user" });
  });

  it("400s on an empty name", async () => {
    const res = await app.request(
      "/api/admin/users",
      jsonReq("POST", { firstName: "", lastName: "Byron", email: "ada@example.com" }),
      env(adminClaims())
    );
    expect(res.status).toBe(400);
  });

  it("400s on a bad email", async () => {
    const res = await app.request(
      "/api/admin/users",
      jsonReq("POST", { firstName: "Ada", lastName: "Byron", email: "nope" }),
      env(adminClaims())
    );
    expect(res.status).toBe(400);
  });

  it("400s when a name exceeds 100 chars", async () => {
    const res = await app.request(
      "/api/admin/users",
      jsonReq("POST", { firstName: "a".repeat(101), lastName: "Byron", email: "ada@example.com" }),
      env(adminClaims())
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /admin/users", () => {
  it("enriches with hasDownloaded/hasSent and sorts newest-first", async () => {
    seed(profile({ sub: "a", createdAt: "2026-01-01T00:00:00.000Z" }));
    seed(profile({ sub: "b", createdAt: "2026-02-01T00:00:00.000Z" }));

    seed({
      pk: "USER#a",
      sk: "SHARE#2026-03-01#s1",
      id: "s1",
      recipientSub: "a",
      firstDownloadAt: "2026-03-02T00:00:00.000Z",
      files: [],
      fileCount: 0,
      readyCount: 0,
      totalSize: 0,
      createdAt: "2026-03-01T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
      status: "ready",
      gsi1pk: "SHARES",
      gsi1sk: "2026-03-01",
    } satisfies ShareGroup);

    seed({
      pk: "USER#b",
      sk: "UPLOAD#2026-03-01#u1",
      id: "u1",
      senderSub: "b",
      files: [],
      fileCount: 0,
      readyCount: 0,
      totalSize: 0,
      createdAt: "2026-03-01T00:00:00.000Z",
      status: "ready",
      gsi1pk: "UPLOADS",
      gsi1sk: "2026-03-01",
    } satisfies UploadGroup);

    const res = await app.request("/api/admin/users", { method: "GET" }, env(adminClaims()));
    const body = (await res.json()) as (UserProfile & {
      hasDownloaded: boolean;
      hasSent: boolean;
    })[];

    expect(body.map((p) => p.sub)).toEqual(["b", "a"]);
    const a = body.find((p) => p.sub === "a")!;
    const b = body.find((p) => p.sub === "b")!;
    expect(a.hasDownloaded).toBe(true);
    expect(a.hasSent).toBe(false);
    expect(b.hasDownloaded).toBe(false);
    expect(b.hasSent).toBe(true);
  });
});

describe("PATCH /admin/users/:sub", () => {
  it("404s when the profile is missing", async () => {
    const res = await app.request(
      "/api/admin/users/ghost",
      jsonReq("PATCH", { firstName: "New", lastName: "Name" }),
      env(adminClaims())
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "User not found" });
  });

  it("updates Cognito attributes and the DDB profile", async () => {
    seed(profile({ sub: "a", email: "a@example.com", firstName: "Old", lastName: "Name" }));
    const res = await app.request(
      "/api/admin/users/a",
      jsonReq("PATCH", { firstName: "New", lastName: "Person" }),
      env(adminClaims())
    );
    expect(res.status).toBe(200);

    const updateInput = cognitoMock.commandCalls(AdminUpdateUserAttributesCommand)[0].args[0].input;
    expect(updateInput.Username).toBe("a@example.com");
    expect(updateInput.UserAttributes).toEqual([
      { Name: "given_name", Value: "New" },
      { Name: "family_name", Value: "Person" },
    ]);

    const stored = await db.get<UserProfile>("USER#a", "PROFILE");
    expect(stored?.firstName).toBe("New");
    expect(stored?.lastName).toBe("Person");
  });
});

describe("DELETE /admin/users/:sub", () => {
  it("404s when the profile is missing", async () => {
    const res = await app.request(
      "/api/admin/users/ghost",
      { method: "DELETE" },
      env(adminClaims())
    );
    expect(res.status).toBe(404);
  });

  it("cascades S3 objects, DDB groups, Cognito user, and the profile", async () => {
    seed(profile({ sub: "a", email: "a@example.com" }));
    seed({
      pk: "USER#a",
      sk: "SHARE#2026-03-01#s1",
      id: "s1",
      recipientSub: "a",
      files: [
        { fileId: "f1", name: "1.txt", size: 1, s3Key: "shares/a/s1/f1-1.txt", status: "ready" },
        { fileId: "f2", name: "2.txt", size: 1, s3Key: "shares/a/s1/f2-2.txt", status: "ready" },
      ],
      fileCount: 2,
      readyCount: 2,
      totalSize: 2,
      createdAt: "2026-03-01T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
      status: "ready",
      gsi1pk: "SHARES",
      gsi1sk: "2026-03-01",
    } satisfies ShareGroup);
    seed({
      pk: "USER#a",
      sk: "UPLOAD#2026-03-01#u1",
      id: "u1",
      senderSub: "a",
      files: [
        { fileId: "f3", name: "3.txt", size: 1, s3Key: "uploads/a/u1/f3-3.txt", status: "ready" },
      ],
      fileCount: 1,
      readyCount: 1,
      totalSize: 1,
      createdAt: "2026-03-01T00:00:00.000Z",
      status: "ready",
      gsi1pk: "UPLOADS",
      gsi1sk: "2026-03-01",
    } satisfies UploadGroup);

    const res = await app.request("/api/admin/users/a", { method: "DELETE" }, env(adminClaims()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const deleted = vi.mocked(deleteObject).mock.calls.map((c) => c[0]);
    expect(deleted.sort()).toEqual([
      "shares/a/s1/f1-1.txt",
      "shares/a/s1/f2-2.txt",
      "uploads/a/u1/f3-3.txt",
    ]);

    expect(cognitoMock.commandCalls(AdminDeleteUserCommand)[0].args[0].input.Username).toBe(
      "a@example.com"
    );
    expect(await db.get("USER#a", "PROFILE")).toBeUndefined();
    expect(await db.get("USER#a", "SHARE#2026-03-01#s1")).toBeUndefined();
    expect(await db.get("USER#a", "UPLOAD#2026-03-01#u1")).toBeUndefined();
  });
});
