// Mirrors the shapes returned by the backend (backend/src/types.ts), trimmed
// to what the UI needs. Kept separate since the frontend bundle can't import
// server-only code.

export interface FileEntry {
  fileId: string;
  name: string;
  size: number;
  status: "pending" | "ready";
  downloadedAt?: string;
}

export type GroupStatus = "pending" | "ready";

export interface UserProfile {
  sub: string;
  email: string;
  firstName: string;
  lastName: string;
  createdAt: string;
}

export interface AdminUserRow extends UserProfile {
  hasDownloaded: boolean;
  hasSent: boolean;
}

export interface ShareGroup {
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
}

export interface ShareGroupWithRecipient extends ShareGroup {
  recipient: UserProfile | null;
}

export interface UploadGroup {
  id: string;
  senderSub: string;
  files: FileEntry[];
  fileCount: number;
  readyCount: number;
  totalSize: number;
  createdAt: string;
  status: GroupStatus;
  adminDownloadedAt?: string;
}

export interface UploadGroupWithSender extends UploadGroup {
  sender: UserProfile | null;
}

export interface PresignedFileUpload {
  fileId: string;
  name: string;
  uploadUrl: string;
}

export interface AuditLog {
  id: string;
  action: "upload" | "download";
  context: "share" | "upload";
  fileName: string;
  fileId: string;
  size?: number;
  actorSub: string;
  actorEmail: string;
  actorName?: string;
  timestamp: string;
}

export interface AuditPage {
  entries: AuditLog[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AuditQuery {
  page?: number;
  pageSize?: number;
  sort?: "asc" | "desc";
  fileName?: string;
  from?: string;
  to?: string;
  actorSub?: string;
}
