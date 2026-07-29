import { ulid } from "ulid";
import { db } from "./db";
import type { AuditLog } from "./types";

export interface AuditEvent {
  action: "upload" | "download";
  context: "share" | "upload";
  fileName: string;
  fileId: string;
  size?: number;
  actorSub: string;
  actorEmail: string;
  actorName?: string;
}

/**
 * Appends an audit-log entry. Fire-and-forget from the caller's perspective —
 * callers should `void recordAudit(...)` (or `.catch(console.error)`) so an
 * audit-write failure never breaks the actual upload/download flow.
 */
export async function recordAudit(e: AuditEvent): Promise<void> {
  const id = ulid();
  const timestamp = new Date().toISOString();
  const item: AuditLog = {
    pk: `AUDIT#${id}`,
    sk: "AUDIT",
    id,
    timestamp,
    gsi1pk: "AUDIT",
    gsi1sk: `${timestamp}#${id}`,
    ...e,
  };
  await db.put(item);
}
