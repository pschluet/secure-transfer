import { beforeEach, describe, expect, it, vi } from "vitest";
import { handler } from "../src/s3-event";
import { sendShareReadyEmail, sendUploadReadyEmail } from "../src/email";
import type { AuditLog, ShareGroup, UploadGroup, UserProfile } from "../src/types";
import { db, resetDb, seed } from "./helpers/fakeDb";

vi.mock("../src/db", async () => {
  const { db } = await import("./helpers/fakeDb");
  return { db };
});

vi.mock("../src/email", () => ({
  sendShareReadyEmail: vi.fn(async () => {}),
  sendUploadReadyEmail: vi.fn(async () => {}),
}));

vi.mock("ulid", async () => await import("./helpers/ulid"));

const invoke = handler as unknown as (event: unknown) => Promise<void>;

function s3Event(...keys: string[]) {
  return { Records: keys.map((key) => ({ s3: { object: { key } } })) };
}

function profile(sub: string): UserProfile {
  return {
    pk: `USER#${sub}`,
    sk: "PROFILE",
    sub,
    email: `${sub}@example.com`,
    firstName: "Fee",
    lastName: "Lastname",
    createdAt: "2026-01-01T00:00:00.000Z",
    gsi1pk: "USERS",
    gsi1sk: `${sub}@example.com`,
  };
}

async function audits(): Promise<AuditLog[]> {
  return db.queryGsi1<AuditLog>("AUDIT");
}

beforeEach(() => {
  resetDb();
  vi.mocked(sendShareReadyEmail).mockClear();
  vi.mocked(sendUploadReadyEmail).mockClear();
});

describe("shares completion", () => {
  it("flips a single-file group to ready, emails the recipient, and audits per file", async () => {
    seed(profile("recipA"));
    seed({
      pk: "USER#recipA",
      sk: "SHARE#2026-06-01#g1",
      id: "g1",
      recipientSub: "recipA",
      files: [
        {
          fileId: "fa",
          name: "a.txt",
          size: 5,
          s3Key: "shares/recipA/g1/a.txt",
          status: "pending",
        },
      ],
      fileCount: 1,
      readyCount: 0,
      totalSize: 5,
      createdAt: "2026-06-01T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
      status: "pending",
      createdBySub: "admin-9",
      createdByEmail: "admin9@test.example",
      gsi1pk: "SHARES",
      gsi1sk: "2026-06-01",
    } satisfies ShareGroup);

    await invoke(s3Event("shares/recipA/g1/a.txt"));

    const stored = await db.get<ShareGroup>("USER#recipA", "SHARE#2026-06-01#g1");
    expect(stored?.status).toBe("ready");
    expect(stored?.files[0].status).toBe("ready");

    expect(sendShareReadyEmail).toHaveBeenCalledTimes(1);
    expect(sendShareReadyEmail).toHaveBeenCalledWith(
      "recipA@example.com",
      "Fee",
      ["a.txt"],
      "2099-01-01T00:00:00.000Z"
    );

    const rows = await audits();
    expect(rows).toHaveLength(1);
    // Attributed to the creating admin, not the recipient.
    expect(rows[0]).toMatchObject({
      action: "upload",
      context: "share",
      actorSub: "admin-9",
      actorEmail: "admin9@test.example",
    });
  });

  it("only flips a multi-file group once the last file lands", async () => {
    seed(profile("recipA"));
    seed({
      pk: "USER#recipA",
      sk: "SHARE#2026-06-01#g2",
      id: "g2",
      recipientSub: "recipA",
      files: [
        {
          fileId: "fa",
          name: "a.txt",
          size: 1,
          s3Key: "shares/recipA/g2/a.txt",
          status: "pending",
        },
        {
          fileId: "fb",
          name: "b.txt",
          size: 1,
          s3Key: "shares/recipA/g2/b.txt",
          status: "pending",
        },
      ],
      fileCount: 2,
      readyCount: 0,
      totalSize: 2,
      createdAt: "2026-06-01T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
      status: "pending",
      createdBySub: "admin-9",
      createdByEmail: "admin9@test.example",
      gsi1pk: "SHARES",
      gsi1sk: "2026-06-01",
    } satisfies ShareGroup);

    await invoke(s3Event("shares/recipA/g2/a.txt"));
    expect(sendShareReadyEmail).not.toHaveBeenCalled();
    expect(await audits()).toHaveLength(0);
    expect((await db.get<ShareGroup>("USER#recipA", "SHARE#2026-06-01#g2"))?.status).toBe(
      "pending"
    );

    await invoke(s3Event("shares/recipA/g2/b.txt"));
    expect(sendShareReadyEmail).toHaveBeenCalledTimes(1);
    expect(await audits()).toHaveLength(2);
    expect((await db.get<ShareGroup>("USER#recipA", "SHARE#2026-06-01#g2"))?.status).toBe("ready");
  });

  it("is idempotent for duplicate events on an already-ready file", async () => {
    seed(profile("recipA"));
    seed({
      pk: "USER#recipA",
      sk: "SHARE#2026-06-01#g3",
      id: "g3",
      recipientSub: "recipA",
      files: [
        {
          fileId: "fa",
          name: "a.txt",
          size: 1,
          s3Key: "shares/recipA/g3/a.txt",
          status: "pending",
        },
      ],
      fileCount: 1,
      readyCount: 0,
      totalSize: 1,
      createdAt: "2026-06-01T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
      status: "pending",
      createdBySub: "admin-9",
      createdByEmail: "admin9@test.example",
      gsi1pk: "SHARES",
      gsi1sk: "2026-06-01",
    } satisfies ShareGroup);

    await invoke(s3Event("shares/recipA/g3/a.txt"));
    await invoke(s3Event("shares/recipA/g3/a.txt"));

    expect(sendShareReadyEmail).toHaveBeenCalledTimes(1);
    expect(await audits()).toHaveLength(1);
  });
});

describe("uploads completion", () => {
  it("emails the admin and attributes the audit to the sender", async () => {
    seed(profile("sendB"));
    seed({
      pk: "USER#sendB",
      sk: "UPLOAD#2026-06-01#u1",
      id: "u1",
      senderSub: "sendB",
      files: [
        {
          fileId: "fa",
          name: "a.txt",
          size: 3,
          s3Key: "uploads/sendB/u1/a.txt",
          status: "pending",
        },
      ],
      fileCount: 1,
      readyCount: 0,
      totalSize: 3,
      createdAt: "2026-06-01T00:00:00.000Z",
      status: "pending",
      gsi1pk: "UPLOADS",
      gsi1sk: "2026-06-01",
    } satisfies UploadGroup);

    await invoke(s3Event("uploads/sendB/u1/a.txt"));

    expect(sendUploadReadyEmail).toHaveBeenCalledTimes(1);
    expect(sendUploadReadyEmail).toHaveBeenCalledWith("admin@test.example", "Fee Lastname", [
      "a.txt",
    ]);

    const rows = await audits();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "upload",
      context: "upload",
      actorSub: "sendB",
      actorEmail: "sendB@example.com",
      actorName: "Fee Lastname",
    });
  });

  it("only notifies once the last upload file lands", async () => {
    seed(profile("sendB"));
    seed({
      pk: "USER#sendB",
      sk: "UPLOAD#2026-06-01#u2",
      id: "u2",
      senderSub: "sendB",
      files: [
        {
          fileId: "fa",
          name: "a.txt",
          size: 1,
          s3Key: "uploads/sendB/u2/a.txt",
          status: "pending",
        },
        {
          fileId: "fb",
          name: "b.txt",
          size: 1,
          s3Key: "uploads/sendB/u2/b.txt",
          status: "pending",
        },
      ],
      fileCount: 2,
      readyCount: 0,
      totalSize: 2,
      createdAt: "2026-06-01T00:00:00.000Z",
      status: "pending",
      gsi1pk: "UPLOADS",
      gsi1sk: "2026-06-01",
    } satisfies UploadGroup);

    await invoke(s3Event("uploads/sendB/u2/a.txt"));
    expect(sendUploadReadyEmail).not.toHaveBeenCalled();

    await invoke(s3Event("uploads/sendB/u2/b.txt"));
    expect(sendUploadReadyEmail).toHaveBeenCalledTimes(1);
    expect(await audits()).toHaveLength(2);
  });
});

describe("silent no-ops", () => {
  it("ignores an unrecognized key prefix", async () => {
    await invoke(s3Event("other/x/y/z.txt"));
    expect(sendShareReadyEmail).not.toHaveBeenCalled();
    expect(sendUploadReadyEmail).not.toHaveBeenCalled();
    expect(await audits()).toHaveLength(0);
  });

  it("ignores an unknown group", async () => {
    await invoke(s3Event("shares/recipA/missing/a.txt"));
    expect(sendShareReadyEmail).not.toHaveBeenCalled();
    expect(await audits()).toHaveLength(0);
  });

  it("ignores a key that matches no file in the group", async () => {
    seed({
      pk: "USER#recipA",
      sk: "SHARE#2026-06-01#g4",
      id: "g4",
      recipientSub: "recipA",
      files: [
        {
          fileId: "fa",
          name: "a.txt",
          size: 1,
          s3Key: "shares/recipA/g4/a.txt",
          status: "pending",
        },
      ],
      fileCount: 1,
      readyCount: 0,
      totalSize: 1,
      createdAt: "2026-06-01T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
      status: "pending",
      gsi1pk: "SHARES",
      gsi1sk: "2026-06-01",
    } satisfies ShareGroup);

    await invoke(s3Event("shares/recipA/g4/does-not-exist.txt"));
    expect(sendShareReadyEmail).not.toHaveBeenCalled();
    expect(await audits()).toHaveLength(0);
  });
});
