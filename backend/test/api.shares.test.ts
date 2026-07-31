import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/api";
import { deleteObject } from "../src/s3";
import type { ShareGroup, UserProfile } from "../src/types";
import { db, resetDb, seed } from "./helpers/fakeDb";
import { resetUlid } from "./helpers/ulid";
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

function profile(sub: string): UserProfile {
  return {
    pk: `USER#${sub}`,
    sk: "PROFILE",
    sub,
    email: `${sub}@example.com`,
    firstName: "First",
    lastName: "Last",
    createdAt: "2026-01-01T00:00:00.000Z",
    gsi1pk: "USERS",
    gsi1sk: `${sub}@example.com`,
  };
}

beforeEach(() => {
  resetDb();
  resetUlid();
  vi.mocked(deleteObject).mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-30T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /admin/users/:sub/shares", () => {
  it("404s when the recipient is unknown", async () => {
    const res = await app.request(
      "/api/admin/users/ghost/shares",
      jsonReq("POST", { files: [{ name: "a.txt", size: 1 }], expiresInHours: 24 }),
      env(adminClaims())
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "User not found" });
  });

  it("creates a share with computed expiry, creator attribution, and presigned URLs", async () => {
    seed(profile("recip"));
    const res = await app.request(
      "/api/admin/users/recip/shares",
      jsonReq("POST", {
        files: [
          { name: "a.txt", size: 10 },
          { name: "b.txt", size: 20 },
        ],
        expiresInHours: 24,
      }),
      env(adminClaims())
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      group: ShareGroup;
      uploads: { fileId: string; name: string; uploadUrl: string }[];
    };

    expect(body.group.createdAt).toBe("2026-07-30T12:00:00.000Z");
    expect(body.group.expiresAt).toBe("2026-07-31T12:00:00.000Z");
    expect(body.group.createdBySub).toBe("admin-1");
    expect(body.group.createdByEmail).toBe("admin@test.example");
    expect(body.group.fileCount).toBe(2);
    expect(body.group.readyCount).toBe(0);
    expect(body.group.totalSize).toBe(30);
    expect(body.group.status).toBe("pending");
    expect(body.group.files.map((f) => f.status)).toEqual(["pending", "pending"]);

    expect(body.uploads).toEqual([
      {
        fileId: "ulid-2",
        name: "a.txt",
        uploadUrl: "https://upload/shares/recip/ulid-1/ulid-2-a.txt",
      },
      {
        fileId: "ulid-3",
        name: "b.txt",
        uploadUrl: "https://upload/shares/recip/ulid-1/ulid-3-b.txt",
      },
    ]);

    const stored = await db.get<ShareGroup>("USER#recip", "SHARE#2026-07-30T12:00:00.000Z#ulid-1");
    expect(stored?.id).toBe("ulid-1");
  });

  it("400s on an empty files array", async () => {
    seed(profile("recip"));
    const res = await app.request(
      "/api/admin/users/recip/shares",
      jsonReq("POST", { files: [], expiresInHours: 24 }),
      env(adminClaims())
    );
    expect(res.status).toBe(400);
  });

  it("400s when expiresInHours is not positive", async () => {
    seed(profile("recip"));
    const res = await app.request(
      "/api/admin/users/recip/shares",
      jsonReq("POST", { files: [{ name: "a.txt", size: 1 }], expiresInHours: 0 }),
      env(adminClaims())
    );
    expect(res.status).toBe(400);
  });

  it("400s when expiresInHours exceeds one year", async () => {
    seed(profile("recip"));
    const res = await app.request(
      "/api/admin/users/recip/shares",
      jsonReq("POST", { files: [{ name: "a.txt", size: 1 }], expiresInHours: 24 * 365 + 1 }),
      env(adminClaims())
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /admin/shares", () => {
  it("enriches with the recipient profile (null when missing) and sorts newest-first", async () => {
    seed(profile("a"));
    const base = {
      files: [],
      fileCount: 0,
      readyCount: 0,
      totalSize: 0,
      expiresAt: "2099-01-01T00:00:00.000Z",
      status: "ready" as const,
      gsi1pk: "SHARES" as const,
    };
    seed({
      ...base,
      pk: "USER#a",
      sk: "SHARE#2026-01-01#s1",
      id: "s1",
      recipientSub: "a",
      createdAt: "2026-01-01T00:00:00.000Z",
      gsi1sk: "2026-01-01",
    } satisfies ShareGroup);
    seed({
      ...base,
      pk: "USER#ghost",
      sk: "SHARE#2026-02-01#s2",
      id: "s2",
      recipientSub: "ghost",
      createdAt: "2026-02-01T00:00:00.000Z",
      gsi1sk: "2026-02-01",
    } satisfies ShareGroup);

    const res = await app.request("/api/admin/shares", { method: "GET" }, env(adminClaims()));
    const body = (await res.json()) as (ShareGroup & { recipient: UserProfile | null })[];

    expect(body.map((s) => s.id)).toEqual(["s2", "s1"]);
    expect(body.find((s) => s.id === "s1")?.recipient?.sub).toBe("a");
    expect(body.find((s) => s.id === "s2")?.recipient).toBeNull();
  });
});

describe("DELETE /admin/users/:sub/shares/:id", () => {
  it("404s when the share is not found", async () => {
    const res = await app.request(
      "/api/admin/users/a/shares/nope",
      { method: "DELETE" },
      env(adminClaims())
    );
    expect(res.status).toBe(404);
  });

  it("removes S3 objects and the DDB item", async () => {
    seed({
      pk: "USER#a",
      sk: "SHARE#2026-01-01#s1",
      id: "s1",
      recipientSub: "a",
      files: [
        { fileId: "f1", name: "1.txt", size: 1, s3Key: "shares/a/s1/f1-1.txt", status: "ready" },
      ],
      fileCount: 1,
      readyCount: 1,
      totalSize: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
      status: "ready",
      gsi1pk: "SHARES",
      gsi1sk: "2026-01-01",
    } satisfies ShareGroup);

    const res = await app.request(
      "/api/admin/users/a/shares/s1",
      { method: "DELETE" },
      env(adminClaims())
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(deleteObject).mock.calls.map((c) => c[0])).toEqual(["shares/a/s1/f1-1.txt"]);
    expect(await db.get("USER#a", "SHARE#2026-01-01#s1")).toBeUndefined();
  });
});
