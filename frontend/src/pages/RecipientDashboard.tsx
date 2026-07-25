import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../lib/api";
import { triggerBrowserDownload, uploadFiles } from "../lib/upload";
import { formatBytes, formatDate, formatTimeLeft } from "../lib/format";
import type { PresignedFileUpload, ShareGroup, UploadGroup } from "../types";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong";
}

export function RecipientDashboard() {
  const [shares, setShares] = useState<ShareGroup[] | null>(null);
  const [uploads, setUploads] = useState<UploadGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [presigned, setPresigned] = useState<PresignedFileUpload[] | null>(null);
  const [progress, setProgress] = useState<Record<string, number> | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadShares() {
    try {
      setShares(await api.meShares());
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  async function loadUploads() {
    try {
      setUploads(await api.meUploads());
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  useEffect(() => {
    void loadShares();
    void loadUploads();
  }, []);

  async function handleDownload(shareId: string, fileId: string) {
    try {
      const { url } = await api.meDownloadShareFile(shareId, fileId);
      triggerBrowserDownload(url);
      void loadShares();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleUploadSubmit(e: FormEvent) {
    e.preventDefault();
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const { uploads: created } = await api.meCreateUpload(
        files.map((f) => ({ name: f.name, size: f.size }))
      );
      setPresigned(created);
      setProgress(Object.fromEntries(created.map((u) => [u.fileId, 0])));
      await uploadFiles(files, created, setProgress);
      setFiles([]);
      void loadUploads();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dashboard">
      {error && <p className="error">{error}</p>}

      <section>
        <h2>Files shared with you</h2>
        {!shares ? (
          <p>Loading…</p>
        ) : shares.length === 0 ? (
          <p className="hint">Nothing here yet.</p>
        ) : (
          <ul className="card-list">
            {shares.map((s) => (
              <li key={s.id} className="card">
                <div className="card-header">
                  <span>{formatDate(s.createdAt)}</span>
                  <span className="badge">{formatTimeLeft(s.expiresAt)}</span>
                </div>
                <ul className="file-list">
                  {s.files.map((f) => (
                    <li key={f.fileId}>
                      <span className="file-name">{f.name}</span>
                      <span className="file-size">{formatBytes(f.size)}</span>
                      {f.status === "ready" ? (
                        <button onClick={() => void handleDownload(s.id, f.fileId)}>Download</button>
                      ) : (
                        <span className="badge badge-pending">uploading…</span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Send files</h2>
        <form onSubmit={handleUploadSubmit}>
          <input
            type="file"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
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
          <button type="submit" disabled={busy || files.length === 0}>
            {busy ? "Uploading…" : `Send ${files.length || ""} file${files.length === 1 ? "" : "s"}`}
          </button>
        </form>
      </section>

      <section>
        <h2>Your upload history</h2>
        {!uploads ? (
          <p>Loading…</p>
        ) : uploads.length === 0 ? (
          <p className="hint">You haven&rsquo;t sent anything yet.</p>
        ) : (
          <ul className="card-list">
            {uploads.map((u) => (
              <li key={u.id} className="card">
                <div className="card-header">
                  <span>{formatDate(u.createdAt)}</span>
                  <span className="badge">
                    {u.status === "ready"
                      ? u.adminDownloadedAt
                        ? "Downloaded"
                        : "Delivered"
                      : "Uploading…"}
                  </span>
                </div>
                <ul className="file-list">
                  {u.files.map((f) => (
                    <li key={f.fileId}>
                      <span className="file-name">{f.name}</span>
                      <span className="file-size">{formatBytes(f.size)}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
