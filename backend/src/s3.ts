import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const BUCKET = process.env.FILES_BUCKET!;
const UPLOAD_URL_TTL_SECONDS = 15 * 60; // 15 minutes to complete a PUT
const DOWNLOAD_URL_TTL_SECONDS = 5 * 60; // 5 minutes to start a GET

const s3 = new S3Client({});

export async function presignUpload(key: string, contentType?: string): Promise<string> {
  return getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ...(contentType ? { ContentType: contentType } : {}),
    }),
    { expiresIn: UPLOAD_URL_TTL_SECONDS }
  );
}

export async function presignDownload(key: string, downloadFilename: string): Promise<string> {
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${downloadFilename.replace(/"/g, "")}"`,
    }),
    { expiresIn: DOWNLOAD_URL_TTL_SECONDS }
  );
}

export async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

export function shareKey(recipientSub: string, groupId: string, filename: string): string {
  return `shares/${recipientSub}/${groupId}/${filename}`;
}

export function uploadKey(senderSub: string, groupId: string, filename: string): string {
  return `uploads/${senderSub}/${groupId}/${filename}`;
}
