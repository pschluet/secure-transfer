import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/api";
import type { AuditLog } from "../src/types";
import { resetDb, seed } from "./helpers/fakeDb";
import { adminClaims, env } from "./helpers/request";

vi.mock("../src/db", async () => {
  const { db } = await import("./helpers/fakeDb");
  return { db };
});

function auditRow(over: Partial<AuditLog> & { id: string; timestamp: string }): AuditLog {
  return {
    pk: `AUDIT#${over.id}`,
    sk: "AUDIT",
    action: "download",
    context: "share",
    fileName: "file.txt",
    fileId: "f1",
    actorSub: "actor",
    actorEmail: "actor@example.com",
    gsi1pk: "AUDIT",
    gsi1sk: `${over.timestamp}#${over.id}`,
    ...over,
  };
}

type Page = { entries: AuditLog[]; total: number; page: number; pageSize: number };

async function getAudit(query: string): Promise<Page> {
  const res = await app.request(`/api/admin/audit${query}`, { method: "GET" }, env(adminClaims()));
  expect(res.status).toBe(200);
  return (await res.json()) as Page;
}

beforeEach(() => {
  resetDb();
});

describe("GET /admin/audit filtering", () => {
  it("applies a case-insensitive fileName substring filter", async () => {
    seed(auditRow({ id: "1", timestamp: "2026-07-01T00:00:00.000Z", fileName: "Report.PDF" }));
    seed(auditRow({ id: "2", timestamp: "2026-07-02T00:00:00.000Z", fileName: "photo.jpg" }));

    const page = await getAudit("?fileName=report");
    expect(page.total).toBe(1);
    expect(page.entries.map((e) => e.id)).toEqual(["1"]);
  });

  it("treats `to` as inclusive through 23:59:59.999Z UTC of that day", async () => {
    seed(auditRow({ id: "before", timestamp: "2026-06-30T12:00:00.000Z" }));
    seed(auditRow({ id: "boundary", timestamp: "2026-07-01T23:59:59.999Z" }));
    seed(auditRow({ id: "after", timestamp: "2026-07-02T00:00:00.000Z" }));

    const page = await getAudit("?to=2026-07-01&sort=asc");
    expect(page.entries.map((e) => e.id)).toEqual(["before", "boundary"]);
    expect(page.total).toBe(2);
  });

  it("applies a `from` lower bound", async () => {
    seed(auditRow({ id: "before", timestamp: "2026-06-30T12:00:00.000Z" }));
    seed(auditRow({ id: "on", timestamp: "2026-07-01T23:59:59.999Z" }));
    seed(auditRow({ id: "after", timestamp: "2026-07-02T00:00:00.000Z" }));

    const page = await getAudit("?from=2026-07-01&sort=asc");
    expect(page.entries.map((e) => e.id)).toEqual(["on", "after"]);
  });

  it("applies an exact actorSub filter", async () => {
    seed(
      auditRow({
        id: "1",
        timestamp: "2026-07-01T00:00:00.000Z",
        actorSub: "user-a",
        actorEmail: "a@example.com",
      })
    );
    seed(
      auditRow({
        id: "2",
        timestamp: "2026-07-02T00:00:00.000Z",
        actorSub: "user-b",
        actorEmail: "b@example.com",
      })
    );

    const page = await getAudit("?actorSub=user-b");
    expect(page.total).toBe(1);
    expect(page.entries.map((e) => e.id)).toEqual(["2"]);
  });
});

describe("GET /admin/audit sorting", () => {
  beforeEach(() => {
    seed(auditRow({ id: "a", timestamp: "2026-07-01T00:00:00.000Z" }));
    seed(auditRow({ id: "b", timestamp: "2026-07-02T00:00:00.000Z" }));
    seed(auditRow({ id: "c", timestamp: "2026-07-03T00:00:00.000Z" }));
  });

  it("defaults to newest-first (desc)", async () => {
    const page = await getAudit("");
    expect(page.entries.map((e) => e.id)).toEqual(["c", "b", "a"]);
  });

  it("supports ascending order", async () => {
    const page = await getAudit("?sort=asc");
    expect(page.entries.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });
});

describe("GET /admin/audit pagination", () => {
  beforeEach(() => {
    for (let i = 0; i < 30; i++) {
      const n = String(i).padStart(2, "0");
      seed(auditRow({ id: `r${n}`, timestamp: `2026-07-01T00:00:${n}.000Z` }));
    }
  });

  it("defaults to page 1 with pageSize 25 and reports the full total", async () => {
    const page = await getAudit("");
    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(25);
    expect(page.total).toBe(30);
    expect(page.entries.length).toBe(25);
  });

  it("returns the remainder on page 2", async () => {
    const page = await getAudit("?page=2");
    expect(page.page).toBe(2);
    expect(page.entries.length).toBe(5);
  });

  it("clamps pageSize above 100 down to 100", async () => {
    const page = await getAudit("?pageSize=500");
    expect(page.pageSize).toBe(100);
  });

  it("clamps a negative pageSize up to 1", async () => {
    const page = await getAudit("?pageSize=-5");
    expect(page.pageSize).toBe(1);
    expect(page.entries.length).toBe(1);
  });

  it("clamps page below 1 up to 1", async () => {
    const page = await getAudit("?page=-3");
    expect(page.page).toBe(1);
  });
});
