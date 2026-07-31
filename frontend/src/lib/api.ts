import { fetchAuthSession } from "aws-amplify/auth";
import type {
  AdminUserRow,
  AuditPage,
  AuditQuery,
  PresignedFileUpload,
  ShareGroup,
  ShareGroupWithRecipient,
  UploadGroup,
  UploadGroupWithSender,
  UserProfile,
} from "../types";

const BASE_URL = import.meta.env.VITE_API_URL ?? "/api";

async function authHeader(): Promise<Record<string, string>> {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = {
    "Content-Type": "application/json",
    ...(await authHeader()),
    ...(init.headers ?? {}),
  };
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface FileMeta {
  name: string;
  size: number;
}

function toQueryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export const api = {
  me: () => request<UserProfile | null>("/me"),

  adminListUsers: () => request<AdminUserRow[]>("/admin/users"),
  adminCreateUser: (body: { firstName: string; lastName: string; email: string }) =>
    request<UserProfile>("/admin/users", { method: "POST", body: JSON.stringify(body) }),
  adminUpdateUser: (sub: string, body: { firstName: string; lastName: string }) =>
    request<UserProfile>(`/admin/users/${sub}`, { method: "PATCH", body: JSON.stringify(body) }),
  adminDeleteUser: (sub: string) => request<void>(`/admin/users/${sub}`, { method: "DELETE" }),

  adminListShares: () => request<ShareGroupWithRecipient[]>("/admin/shares"),
  adminCreateShare: (recipientSub: string, files: FileMeta[], expiresInHours: number) =>
    request<{ group: ShareGroup; uploads: PresignedFileUpload[] }>(
      `/admin/users/${recipientSub}/shares`,
      { method: "POST", body: JSON.stringify({ files, expiresInHours }) }
    ),
  adminDeleteShare: (recipientSub: string, id: string) =>
    request<void>(`/admin/users/${recipientSub}/shares/${id}`, { method: "DELETE" }),

  adminListUploads: () => request<UploadGroupWithSender[]>("/admin/uploads"),

  adminListAudit: (query: AuditQuery = {}) =>
    request<AuditPage>(
      `/admin/audit${toQueryString({
        page: query.page,
        pageSize: query.pageSize,
        sort: query.sort,
        fileName: query.fileName,
        from: query.from,
        to: query.to,
        actorSub: query.actorSub,
      })}`
    ),
  adminDownloadUploadFile: (senderSub: string, id: string, fileId: string) =>
    request<{ url: string }>(`/admin/users/${senderSub}/uploads/${id}/files/${fileId}/download`),
  adminDeleteUpload: (senderSub: string, id: string) =>
    request<void>(`/admin/users/${senderSub}/uploads/${id}`, { method: "DELETE" }),

  meShares: () => request<ShareGroup[]>("/me/shares"),
  meDownloadShareFile: (id: string, fileId: string) =>
    request<{ url: string }>(`/me/shares/${id}/files/${fileId}/download`),

  meUploads: () => request<UploadGroup[]>("/me/uploads"),
  meCreateUpload: (files: FileMeta[]) =>
    request<{ group: UploadGroup; uploads: PresignedFileUpload[] }>("/me/uploads", {
      method: "POST",
      body: JSON.stringify({ files }),
    }),
};
