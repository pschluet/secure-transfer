import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "../lib/api";
import { uploadFiles } from "../lib/upload";
import type { PresignedFileUpload, UserProfile } from "../types";
import { FilePicker } from "./FilePicker";
import { FileItem } from "./FileItem";
import { ProgressBar } from "./ProgressBar";

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

      {!presigned && <FilePicker files={files} onChange={setFiles} />}

      {presigned && progress && (
        <ul className="file-items" style={{ width: "100%" }}>
          {presigned.map((u) => (
            <FileItem
              key={u.fileId}
              name={u.name}
              size={files.find((f) => f.name === u.name)?.size ?? 0}
              right={<ProgressBar value={progress[u.fileId] ?? 0} />}
            />
          ))}
        </ul>
      )}

      {!presigned && (
        <>
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
        </>
      )}

      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy || files.length === 0 || !!presigned}>
        {busy ? "Uploading…" : `Share ${files.length || ""} file${files.length === 1 ? "" : "s"}`}
      </button>
    </form>
  );
}
