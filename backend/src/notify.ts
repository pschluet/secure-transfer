import { db } from "./db";
import { recordAudit, type AuditEvent } from "./audit";
import { sendShareReadyEmail, sendUploadReadyEmail } from "./email";
import type { ShareGroup, UploadGroup, UserProfile } from "./types";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL!;

/** Audit "upload" entries for everything in a group that just became ready:
 * one per file, plus one for the message if there is one. */
function auditGroupReady(
  group: ShareGroup | UploadGroup,
  context: AuditEvent["context"],
  actor: Pick<AuditEvent, "actorSub" | "actorEmail" | "actorName">
): Promise<unknown> {
  const items: Pick<AuditEvent, "fileName" | "fileId" | "size">[] = group.files.map((f) => ({
    fileName: f.name,
    fileId: f.fileId,
    size: f.size,
  }));
  if (group.message) items.push({ fileName: "Message", fileId: group.id });
  return Promise.all(
    items.map((item) =>
      recordAudit({ action: "upload", context, ...item, ...actor }).catch((err) =>
        console.error("audit log write failed", err)
      )
    )
  );
}

/**
 * Called once a share is fully ready — from the S3 event handler when its last
 * file lands, or straight from the API for a message-only share (no files, so
 * no S3 event will ever arrive). Emails the recipient and writes audit entries.
 */
export async function notifyShareReady(group: ShareGroup): Promise<void> {
  const recipient = await db.get<UserProfile>(`USER#${group.recipientSub}`, "PROFILE");
  if (recipient) {
    await sendShareReadyEmail(
      recipient.email,
      recipient.firstName,
      group.files.map((f) => f.name),
      group.expiresAt,
      !!group.message
    );
  }
  // Attribute the upload to whichever admin created the share, not the
  // recipient — the S3 key only encodes the recipient's sub, so this was
  // captured on the group at creation time (see POST /admin/users/:sub/shares).
  if (group.createdBySub && group.createdByEmail) {
    await auditGroupReady(group, "share", {
      actorSub: group.createdBySub,
      actorEmail: group.createdByEmail,
    });
  }
}

/** Upload-direction counterpart of `notifyShareReady`: emails the admin. */
export async function notifyUploadReady(group: UploadGroup): Promise<void> {
  const sender = await db.get<UserProfile>(`USER#${group.senderSub}`, "PROFILE");
  await sendUploadReadyEmail(
    ADMIN_EMAIL,
    sender ? `${sender.firstName} ${sender.lastName}` : "A user",
    group.files.map((f) => f.name),
    !!group.message
  );
  // The uploader's sub is the group owner for this direction, so no extra
  // attribution needs to be stored at creation.
  await auditGroupReady(group, "upload", {
    actorSub: group.senderSub,
    actorEmail: sender?.email ?? "",
    actorName: sender ? `${sender.firstName} ${sender.lastName}` : undefined,
  });
}
