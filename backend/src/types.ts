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

/** Something the admin shared with a recipient: a message, files, or both. */
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
  /** Optional text message sent along with (or instead of) files. */
  message?: string;
  /** Set the first time the other party opens the message. */
  messageViewedAt?: string;
  firstDownloadAt?: string;
  lastDownloadAt?: string;
  /** The admin who created this share — not necessarily `recipientSub`'s
   * counterpart, since multiple admins may exist. Optional for backward
   * compatibility with items written before this field existed. */
  createdBySub?: string;
  createdByEmail?: string;
  gsi1pk: "SHARES";
  gsi1sk: string; // createdAt
}

/** Something a recipient sent to the admin: a message, files, or both. */
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
  /** Optional text message sent along with (or instead of) files. */
  message?: string;
  /** Set the first time the other party opens the message. */
  messageViewedAt?: string;
  adminDownloadedAt?: string;
  gsi1pk: "UPLOADS";
  gsi1sk: string; // createdAt
}

export interface PresignedFileUpload {
  fileId: string;
  name: string;
  uploadUrl: string;
}

/** An append-only record of a file being uploaded (landed in S3) or
 * downloaded, or a message being sent or viewed, for the admin-facing audit
 * log. Message entries use `fileName: "Message"` and the group id as `fileId`. */
export interface AuditLog {
  pk: string; // AUDIT#<id>
  sk: "AUDIT";
  id: string;
  action: "upload" | "download" | "view";
  context: "share" | "upload";
  fileName: string;
  fileId: string;
  size?: number;
  actorSub: string;
  actorEmail: string;
  actorName?: string;
  timestamp: string; // ISO
  gsi1pk: "AUDIT";
  gsi1sk: string; // `${timestamp}#${id}` — unique + chronological
}
