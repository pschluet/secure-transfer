import type { S3Handler } from "aws-lambda";
import { db } from "./db";
import { sendShareReadyEmail, sendUploadReadyEmail } from "./email";
import type { ShareGroup, UploadGroup, UserProfile } from "./types";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL!;

/**
 * Marks the file matching `key` as ready within its group. If this was the
 * last pending file in the group, flips the group to `ready` and returns the
 * (locally updated) group so the caller can send a single notification.
 * Returns null if there's nothing to notify about (unknown group/file, or
 * the group isn't fully ready yet).
 */
async function markFileReady<T extends ShareGroup | UploadGroup>(
  items: T[],
  groupId: string,
  key: string
): Promise<T | null> {
  const group = items.find((i) => i.id === groupId);
  if (!group) return null;
  const fileIdx = group.files.findIndex((f) => f.s3Key === key);
  if (fileIdx === -1 || group.files[fileIdx].status === "ready") return null;

  const readyCount = group.readyCount + 1;
  const allReady = readyCount >= group.fileCount;
  const names = { "#files": "files", "#status": "status" };
  let expr = `SET #files[${fileIdx}].#status = :ready, readyCount = :readyCount`;
  if (allReady) expr += ", #status = :ready";
  await db.update(
    group.pk,
    group.sk,
    expr,
    { ":ready": "ready", ":readyCount": readyCount },
    names
  );

  return allReady ? { ...group, status: "ready" as const } : null;
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
            completed.fileCount,
            completed.expiresAt
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
          completed.fileCount
        );
      }
    }
  }
};
