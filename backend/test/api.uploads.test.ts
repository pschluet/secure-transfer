import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/api";
import { deleteObject, presignDownload } from "../src/s3";
import type { AuditLog, UploadGroup, UserProfile } from "../src/types";
import { db, resetDb, seed } from "./helpers/fakeDb";
import { adminClaims, env } from "./helpers/request";

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

function senderProfile(sub: string): UserProfile {
  return {
    pk: `USER#${sub}`,
    sk: "PROFILE",
    sub,
    email: `${sub}@example.com`,
    firstName: "Sam",
    lastName: "Sender",
    createdAt: "2026-01-01T00:00:00.000Z",
    gsi1pk: "USERS",
    gsi1sk: `${sub}@example.com`,
  };
}

function upload(over: Partial<UploadGroup> & { id: string; senderSub: string }): UploadGroup {
  return {
    pk: `USER#${over.senderSub}`,
    sk: `UPLOAD#${over.createdAt ?? "2026-06-01T00:00:00.000Z"}#${over.id}`,
    files: [{ fileId: "f1", name: "a.txt", size: 5, s3Key: "uploads/s/g/f1", status: "ready" }],
    fileCount: 1,
    readyCount: 1,
    totalSize: 5,
    createdAt: "2026-06-01T00:00:00.000Z",
    status: "ready",
    gsi1pk: "UPLOADS",
    gsi1sk: "2026-06-01T00:00:00.000Z",
    ...over,
  };
}

beforeEach(() => {
  resetDb();
  vi.mocked(deleteObject).mockClear();
  vi.mocked(presignDownload).mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-30T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /admin/uploads", () => {
  it("enriches with the sender profile (null when missing) and sorts newest-first", async () => {
    seed(senderProfile("s1"));
    seed(upload({ id: "u1", senderSub: "s1", createdAt: "2026-01-01T00:00:00.000Z" }));
    seed(upload({ id: "u2", senderSub: "ghost", createdAt: "2026-02-01T00:00:00.000Z" }));

    const res = await app.request("/api/admin/uploads", { method: "GET" }, env(adminClaims()));
    const body = (await res.json()) as (UploadGroup & { sender: UserProfile | null })[];

    expect(body.map((u) => u.id)).toEqual(["u2", "u1"]);
    expect(body.find((u) => u.id === "u1")?.sender?.sub).toBe("s1");
    expect(body.find((u) => u.id === "u2")?.sender).toBeNull();
  });
});

describe("GET /admin/users/:sub/uploads/:id/files/:fileId/download", () => {
  it("404s when the group is missing", async () => {
    const res = await app.request(
      "/api/admin/users/s1/uploads/nope/files/f1/download",
      { method: "GET" },
      env(adminClaims())
    );
    expect(res.status).toBe(404);
  });

  it("404s when the file is not ready", async () => {
    seed(
      upload({
        id: "u1",
        senderSub: "s1",
        files: [
          { fileId: "f1", name: "a.txt", size: 5, s3Key: "uploads/s/g/f1", status: "pending" },
        ],
      })
    );
    const res = await app.request(
      "/api/admin/users/s1/uploads/u1/files/f1/download",
      { method: "GET" },
      env(adminClaims())
    );
    expect(res.status).toBe(404);
  });

  it("returns a url, sets adminDownloadedAt on first download, and audits it", async () => {
    seed(senderProfile("s1"));
    seed(upload({ id: "u1", senderSub: "s1" }));

    const res = await app.request(
      "/api/admin/users/s1/uploads/u1/files/f1/download",
      { method: "GET" },
      env(adminClaims())
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { url: string }).url).toContain("https://download/");

    const stored = await db.get<UploadGroup>("USER#s1", "UPLOAD#2026-06-01T00:00:00.000Z#u1");
    expect(stored?.adminDownloadedAt).toBe("2026-07-30T12:00:00.000Z");

    const [audit] = await db.queryGsi1<AuditLog>("AUDIT");
    expect(audit).toMatchObject({
      action: "download",
      context: "upload",
      fileName: "a.txt",
      fileId: "f1",
      actorSub: "admin-1",
      actorEmail: "admin@test.example",
    });
  });

  it("does not overwrite adminDownloadedAt on a later download", async () => {
    seed(senderProfile("s1"));
    seed(upload({ id: "u1", senderSub: "s1" }));

    await app.request(
      "/api/admin/users/s1/uploads/u1/files/f1/download",
      { method: "GET" },
      env(adminClaims())
    );

    vi.setSystemTime(new Date("2026-08-01T00:00:00.000Z"));
    await app.request(
      "/api/admin/users/s1/uploads/u1/files/f1/download",
      { method: "GET" },
      env(adminClaims())
    );

    const stored = await db.get<UploadGroup>("USER#s1", "UPLOAD#2026-06-01T00:00:00.000Z#u1");
    expect(stored?.adminDownloadedAt).toBe("2026-07-30T12:00:00.000Z");
  });
});

describe("DELETE /admin/users/:sub/uploads/:id", () => {
  it("404s when the upload is missing", async () => {
    const res = await app.request(
      "/api/admin/users/s1/uploads/nope",
      { method: "DELETE" },
      env(adminClaims())
    );
    expect(res.status).toBe(404);
  });

  it("removes S3 objects and the DDB item", async () => {
    seed(
      upload({
        id: "u1",
        senderSub: "s1",
        files: [
          {
            fileId: "f1",
            name: "a.txt",
            size: 5,
            s3Key: "uploads/s1/u1/f1-a.txt",
            status: "ready",
          },
        ],
      })
    );
    const res = await app.request(
      "/api/admin/users/s1/uploads/u1",
      { method: "DELETE" },
      env(adminClaims())
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(deleteObject).mock.calls.map((c) => c[0])).toEqual(["uploads/s1/u1/f1-a.txt"]);
    expect(await db.get("USER#s1", "UPLOAD#2026-06-01T00:00:00.000Z#u1")).toBeUndefined();
  });
});
