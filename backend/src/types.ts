// Shared domain types for the secure-transfer backend.

export interface FileEntry {
  fileId: string;
  name: string;
  size: number;
  s3Key: string;
  status: "pending" | "ready";
  /** Set the first time this specific file is downloaded (shares only). */
  downloadedAt?: string;
}

export type GroupStatus = "pending" | "ready";

export interface UserProfile {
  pk: string; // USER#<sub>
  sk: "PROFILE";
  sub: string;
  email: string;
  firstName: string;
  lastName: string;
  createdAt: string;
  gsi1pk: "USERS";
  gsi1sk: string; // email
}

/** A group of files the admin shared with a recipient. */
export interface ShareGroup {
  pk: string; // USER#<recipientSub>
  sk: string; // SHARE#<createdAt>#<id>
  id: string;
  recipientSub: string;
  files: FileEntry[];
  fileCount: number;
  readyCount: number;
  totalSize: number;
  createdAt: string;
  expiresAt: string;
  status: GroupStatus;
  firstDownloadAt?: string;
  lastDownloadAt?: string;
  gsi1pk: "SHARES";
  gsi1sk: string; // createdAt
}

/** A group of files a recipient sent to the admin. */
export interface UploadGroup {
  pk: string; // USER#<senderSub>
  sk: string; // UPLOAD#<createdAt>#<id>
  id: string;
  senderSub: string;
  files: FileEntry[];
  fileCount: number;
  readyCount: number;
  totalSize: number;
  createdAt: string;
  status: GroupStatus;
  adminDownloadedAt?: string;
  gsi1pk: "UPLOADS";
  gsi1sk: string; // createdAt
}

export interface PresignedFileUpload {
  fileId: string;
  name: string;
  uploadUrl: string;
}
