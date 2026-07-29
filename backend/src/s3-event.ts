import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import type { S3Handler } from "aws-lambda";
import { db } from "./db";
import { recordAudit } from "./audit";
import { sendShareReadyEmail, sendUploadReadyEmail } from "./email";
import type { ShareGroup, UploadGroup, UserProfile } from "./types";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL!;

/**
 * Marks the file matching `key` as ready within its group. If this was the
 * last pending file in the group, flips the group to `ready` and returns the
 * (locally updated) group so the caller can send a single notification.
 * Returns null if there's nothing to notify about (unknown group/file, the
 * file was already marked ready by a prior/duplicate S3 event, or the group
 * isn't fully ready yet).
 *
 * `readyCount` is incremented with an atomic `ADD`, not a read-modify-write —
 * S3 can deliver ObjectCreated events for a multi-file group within
 * milliseconds of each other, and a plain "read current count, write count+1"
 * loses updates when two invocations run concurrently (both read the same
 * starting value). The conditional check on the file's own status makes the
 * whole thing idempotent against duplicate event delivery.
 */
async function markFileReady<T extends ShareGroup | UploadGroup>(
  items: T[],
  groupId: string,
  key: string
): Promise<T | null> {
  const group = items.find((i) => i.id === groupId);
  if (!group) return null;
  const fileIdx = group.files.findIndex((f) => f.s3Key === key);
  if (fileIdx === -1) return null;

  const names = { "#files": "files", "#status": "status" };
  let attributes: Record<string, unknown> | undefined;
  try {
    attributes = await db.update(
      group.pk,
      group.sk,
      `SET #files[${fileIdx}].#status = :ready ADD readyCount :one`,
      { ":ready": "ready", ":one": 1 },
      names,
      {
        condition: `#files[${fileIdx}].#status <> :ready`,
        returnValues: "ALL_NEW",
      }
    );
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return null;
    throw err;
  }

  const newReadyCount = Number(attributes?.readyCount);
  const fileCount = Number(attributes?.fileCount);
  if (!(newReadyCount >= fileCount)) return null;

  await db.update(
    group.pk,
    group.sk,
    "SET #status = :ready",
    { ":ready": "ready" },
    { "#status": "status" }
  );
  return { ...group, status: "ready" as const, readyCount: newReadyCount };
}

export const handler: S3Handler = async (event) => {
  for (const record of event.Records) {
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
    const [prefix, ownerSub, groupId] = key.split("/");
    if (!prefix || !ownerSub || !groupId) continue;

    if (prefix === "shares") {
      const items = await db.queryByPk<ShareGroup>(`USER#${ownerSub}`, "SHARE#");
      const completed = await markFileReady(items, groupId, key);
      if (completed) {
        const recipient = await db.get<UserProfile>(`USER#${ownerSub}`, "PROFILE");
        if (recipient) {
          await sendShareReadyEmail(
            recipient.email,
            recipient.firstName,
            completed.files.map((f) => f.name),
            completed.expiresAt
          );
        }
        // Attribute the upload to whichever admin created the share, not the
        // recipient — the S3 key only encodes the recipient's sub, so this
        // was captured on the group at creation time (see POST /admin/users/:sub/shares).
        if (completed.createdBySub && completed.createdByEmail) {
          await Promise.all(
            completed.files.map((f) =>
              recordAudit({
                action: "upload",
                context: "share",
                fileName: f.name,
                fileId: f.fileId,
                size: f.size,
                actorSub: completed.createdBySub!,
                actorEmail: completed.createdByEmail!,
              }).catch((err) => console.error("audit log write failed", err))
            )
          );
        }
      }
    } else if (prefix === "uploads") {
      const items = await db.queryByPk<UploadGroup>(`USER#${ownerSub}`, "UPLOAD#");
      const completed = await markFileReady(items, groupId, key);
      if (completed) {
        const sender = await db.get<UserProfile>(`USER#${ownerSub}`, "PROFILE");
        await sendUploadReadyEmail(
          ADMIN_EMAIL,
          sender ? `${sender.firstName} ${sender.lastName}` : "A user",
          completed.files.map((f) => f.name)
        );
        // The uploader's sub is the group owner (`ownerSub`) for this
        // direction, so no extra attribution needs to be stored at creation.
        await Promise.all(
          completed.files.map((f) =>
            recordAudit({
              action: "upload",
              context: "upload",
              fileName: f.name,
              fileId: f.fileId,
              size: f.size,
              actorSub: ownerSub,
              actorEmail: sender?.email ?? "",
              actorName: sender ? `${sender.firstName} ${sender.lastName}` : undefined,
            }).catch((err) => console.error("audit log write failed", err))
          )
        );
      }
    }
  }
};
