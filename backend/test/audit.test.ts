import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordAudit } from "../src/audit";
import type { AuditLog } from "../src/types";
import { db, resetDb } from "./helpers/fakeDb";
import { resetUlid } from "./helpers/ulid";

vi.mock("../src/db", async () => {
  const { db } = await import("./helpers/fakeDb");
  return { db };
});

vi.mock("ulid", async () => await import("./helpers/ulid"));

beforeEach(() => {
  resetDb();
  resetUlid();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-30T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("recordAudit", () => {
  it("writes an audit item with the expected keys and passes through event fields", async () => {
    await recordAudit({
      action: "download",
      context: "share",
      fileName: "report.pdf",
      fileId: "file-1",
      size: 2048,
      actorSub: "actor-sub",
      actorEmail: "actor@example.com",
      actorName: "Actor Name",
    });

    const [entry] = await db.queryGsi1<AuditLog>("AUDIT");
    expect(entry).toEqual({
      pk: "AUDIT#ulid-1",
      sk: "AUDIT",
      id: "ulid-1",
      timestamp: "2026-07-30T12:00:00.000Z",
      gsi1pk: "AUDIT",
      gsi1sk: "2026-07-30T12:00:00.000Z#ulid-1",
      action: "download",
      context: "share",
      fileName: "report.pdf",
      fileId: "file-1",
      size: 2048,
      actorSub: "actor-sub",
      actorEmail: "actor@example.com",
      actorName: "Actor Name",
    });
  });

  it("omits optional fields that were not provided", async () => {
    await recordAudit({
      action: "upload",
      context: "upload",
      fileName: "a.txt",
      fileId: "f",
      actorSub: "s",
      actorEmail: "e@example.com",
    });

    const [entry] = await db.queryGsi1<AuditLog>("AUDIT");
    expect(entry.size).toBeUndefined();
    expect(entry.actorName).toBeUndefined();
  });
});
