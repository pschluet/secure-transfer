import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "../lib/api";
import { uploadFiles } from "../lib/upload";
import type { PresignedFileUpload, UserProfile } from "../types";

const EXPIRY_OPTIONS = [
  { label: "1 hour", hours: 1 },
  { label: "24 hours", hours: 24 },
  { label: "3 days", hours: 72 },
  { label: "7 days", hours: 24 * 7 },
  { label: "30 days", hours: 24 * 30 },
];

export function ShareFilesForm({
  recipient,
  onDone,
}: {
  recipient: UserProfile;
  onDone: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [expiresInHours, setExpiresInHours] = useState(24);
  const [presigned, setPresigned] = useState<PresignedFileUpload[] | null>(null);
  const [progress, setProgress] = useState<Record<string, number> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const { uploads } = await api.adminCreateShare(
        recipient.sub,
        files.map((f) => ({ name: f.name, size: f.size })),
        expiresInHours
      );
      setPresigned(uploads);
      setProgress(Object.fromEntries(uploads.map((u) => [u.fileId, 0])));
      await uploadFiles(files, uploads, setProgress);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to share files");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <p className="hint">
        Sharing with {recipient.firstName} {recipient.lastName} ({recipient.email})
      </p>
      <input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
      <label htmlFor="expiry">Expires in</label>
      <select
        id="expiry"
        value={expiresInHours}
        onChange={(e) => setExpiresInHours(Number(e.target.value))}
      >
        {EXPIRY_OPTIONS.map((o) => (
          <option key={o.hours} value={o.hours}>
            {o.label}
          </option>
        ))}
      </select>
      {presigned && progress && (
        <ul className="file-list">
          {presigned.map((u) => (
            <li key={u.fileId}>
              <span className="file-name">{u.name}</span>
              <span>{Math.round((progress[u.fileId] ?? 0) * 100)}%</span>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy || files.length === 0}>
        {busy ? "Uploading…" : `Share ${files.length || ""} file${files.length === 1 ? "" : "s"}`}
      </button>
    </form>
  );
}
