import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/api";
import { presignDownload } from "../src/s3";
import type { AuditLog, ShareGroup, UploadGroup, UserProfile } from "../src/types";
import { db, resetDb, seed } from "./helpers/fakeDb";
import { resetUlid } from "./helpers/ulid";
import { env, jsonReq, userClaims } from "./helpers/request";

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

const NOW = "2026-07-30T12:00:00.000Z";

function meProfile(): UserProfile {
  return {
    pk: "USER#user-1",
    sk: "PROFILE",
    sub: "user-1",
    email: "user@example.com",
    firstName: "Uma",
    lastName: "Recipient",
    createdAt: "2026-01-01T00:00:00.000Z",
    gsi1pk: "USERS",
    gsi1sk: "user@example.com",
  };
}

function share(over: Partial<ShareGroup> & { id: string }): ShareGroup {
  return {
    pk: "USER#user-1",
    sk: `SHARE#${over.createdAt ?? "2026-06-01T00:00:00.000Z"}#${over.id}`,
    recipientSub: "user-1",
    files: [{ fileId: "f1", name: "a.txt", size: 5, s3Key: "shares/user-1/g/f1", status: "ready" }],
    fileCount: 1,
    readyCount: 1,
    totalSize: 5,
    createdAt: "2026-06-01T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    status: "ready",
    gsi1pk: "SHARES",
    gsi1sk: "2026-06-01T00:00:00.000Z",
    ...over,
  };
}

beforeEach(() => {
  resetDb();
  resetUlid();
  vi.mocked(presignDownload).mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /me", () => {
  it("returns the caller's profile", async () => {
    seed(meProfile());
    const res = await app.request("/api/me", { method: "GET" }, env(userClaims()));
    expect(res.status).toBe(200);
    expect(((await res.json()) as UserProfile).sub).toBe("user-1");
  });

  it("returns null when no profile exists", async () => {
    const res = await app.request("/api/me", { method: "GET" }, env(userClaims()));
    expect(await res.json()).toBeNull();
  });
});

describe("GET /me/shares", () => {
  it("returns only ready, unexpired shares", async () => {
    seed(share({ id: "ok", status: "ready", expiresAt: "2099-01-01T00:00:00.000Z" }));
    seed(share({ id: "expired", status: "ready", expiresAt: "2020-01-01T00:00:00.000Z" }));
    seed(share({ id: "pending", status: "pending", expiresAt: "2099-01-01T00:00:00.000Z" }));

    const res = await app.request("/api/me/shares", { method: "GET" }, env(userClaims()));
    const body = (await res.json()) as ShareGroup[];
    expect(body.map((s) => s.id)).toEqual(["ok"]);
  });
});

describe("GET /me/shares/:id/files/:fileId/download", () => {
  it("404s when the share is unknown", async () => {
    const res = await app.request(
      "/api/me/shares/nope/files/f1/download",
      { method: "GET" },
      env(userClaims())
    );
    expect(res.status).toBe(404);
  });

  it("410s when expired even if the file is ready", async () => {
    seed(share({ id: "g1", expiresAt: "2020-01-01T00:00:00.000Z" }));
    const res = await app.request(
      "/api/me/shares/g1/files/f1/download",
      { method: "GET" },
      env(userClaims())
    );
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: "Expired" });
  });

  it("404s when the file is not ready", async () => {
    seed(
      share({
        id: "g1",
        files: [
          { fileId: "f1", name: "a.txt", size: 5, s3Key: "shares/user-1/g/f1", status: "pending" },
        ],
      })
    );
    const res = await app.request(
      "/api/me/shares/g1/files/f1/download",
      { method: "GET" },
      env(userClaims())
    );
    expect(res.status).toBe(404);
  });

  it("returns a url, records download timestamps, and writes an audit row", async () => {
    seed(meProfile());
    seed(share({ id: "g1" }));

    const res = await app.request(
      "/api/me/shares/g1/files/f1/download",
      { method: "GET" },
      env(userClaims())
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { url: string }).url).toContain("https://download/");

    const stored = await db.get<ShareGroup>("USER#user-1", "SHARE#2026-06-01T00:00:00.000Z#g1");
    expect(stored?.firstDownloadAt).toBe(NOW);
    expect(stored?.lastDownloadAt).toBe(NOW);
    expect(stored?.files[0].downloadedAt).toBe(NOW);

    const [audit] = await db.queryGsi1<AuditLog>("AUDIT");
    expect(audit).toMatchObject({
      action: "download",
      context: "share",
      fileName: "a.txt",
      fileId: "f1",
      actorSub: "user-1",
      actorEmail: "user@example.com",
      actorName: "Uma Recipient",
    });
  });
});

describe("GET /me/uploads", () => {
  it("returns the caller's uploads newest-first", async () => {
    const base = {
      pk: "USER#user-1",
      senderSub: "user-1",
      files: [],
      fileCount: 0,
      readyCount: 0,
      totalSize: 0,
      status: "ready" as const,
      gsi1pk: "UPLOADS" as const,
    };
    seed({
      ...base,
      sk: "UPLOAD#2026-01-01#u1",
      id: "u1",
      createdAt: "2026-01-01T00:00:00.000Z",
      gsi1sk: "2026-01-01",
    } satisfies UploadGroup);
    seed({
      ...base,
      sk: "UPLOAD#2026-02-01#u2",
      id: "u2",
      createdAt: "2026-02-01T00:00:00.000Z",
      gsi1sk: "2026-02-01",
    } satisfies UploadGroup);

    const res = await app.request("/api/me/uploads", { method: "GET" }, env(userClaims()));
    const body = (await res.json()) as UploadGroup[];
    expect(body.map((u) => u.id)).toEqual(["u2", "u1"]);
  });
});

describe("POST /me/uploads", () => {
  it("400s on an empty files array", async () => {
    const res = await app.request(
      "/api/me/uploads",
      jsonReq("POST", { files: [] }),
      env(userClaims())
    );
    expect(res.status).toBe(400);
  });

  it("creates an upload group with presigned URLs", async () => {
    const res = await app.request(
      "/api/me/uploads",
      jsonReq("POST", { files: [{ name: "a.txt", size: 10 }] }),
      env(userClaims())
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      group: UploadGroup;
      uploads: { fileId: string; name: string; uploadUrl: string }[];
    };
    expect(body.group.senderSub).toBe("user-1");
    expect(body.group.status).toBe("pending");
    expect(body.uploads).toEqual([
      {
        fileId: "ulid-2",
        name: "a.txt",
        uploadUrl: "https://upload/uploads/user-1/ulid-1/ulid-2-a.txt",
      },
    ]);
  });
});
