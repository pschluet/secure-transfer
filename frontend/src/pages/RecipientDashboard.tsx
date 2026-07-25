import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../lib/api";
import { triggerBrowserDownload, uploadFiles } from "../lib/upload";
import { downloadAllAsZip } from "../lib/zip";
import { formatDate, formatTimeLeft, zipFilename } from "../lib/format";
import { FilePicker } from "../components/FilePicker";
import { FileItem } from "../components/FileItem";
import { ProgressBar } from "../components/ProgressBar";
import { StatusPill } from "../components/StatusPill";
import { RefreshButton } from "../components/RefreshButton";
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
  const [zippingId, setZippingId] = useState<string | null>(null);

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

  async function handleDownloadAll(share: ShareGroup) {
    setZippingId(share.id);
    setError(null);
    try {
      const readyFiles = share.files.filter((f) => f.status === "ready");
      const withUrls = await Promise.all(
        readyFiles.map(async (f) => ({
          name: f.name,
          url: (await api.meDownloadShareFile(share.id, f.fileId)).url,
        }))
      );
      await downloadAllAsZip(withUrls, zipFilename("secure-transfer", share.createdAt));
      void loadShares();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setZippingId(null);
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
      setPresigned(null);
      setProgress(null);
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
        <div className="section-header">
          <h2>Files shared with you</h2>
          <RefreshButton onRefresh={loadShares} label="Refresh shared files" />
        </div>
        {!shares ? (
          <p className="hint">Loading…</p>
        ) : shares.length === 0 ? (
          <div className="empty-state">Nothing shared with you yet.</div>
        ) : (
          <ul className="card-list">
            {shares.map((s) => {
              const readyCount = s.files.filter((f) => f.status === "ready").length;
              return (
                <li key={s.id} className="card">
                  <div className="card-header">
                    <span>{formatDate(s.createdAt)}</span>
                    <span className="mono">{formatTimeLeft(s.expiresAt)}</span>
                  </div>
                  <ul className="file-items">
                    {s.files.map((f) => (
                      <FileItem
                        key={f.fileId}
                        name={f.name}
                        size={f.size}
                        right={
                          f.status === "ready" ? (
                            <button
                              className="secondary small"
                              onClick={() => void handleDownload(s.id, f.fileId)}
                            >
                              Download
                            </button>
                          ) : (
                            <StatusPill tone="pending">Uploading…</StatusPill>
                          )
                        }
                      />
                    ))}
                  </ul>
                  {readyCount > 1 && (
                    <div className="card-actions">
                      <button
                        className="secondary small"
                        disabled={zippingId === s.id}
                        onClick={() => void handleDownloadAll(s)}
                      >
                        {zippingId === s.id ? "Zipping…" : `Download all as .zip (${readyCount})`}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2>Send files</h2>
        <form onSubmit={handleUploadSubmit}>
          {!presigned && <FilePicker files={files} onChange={setFiles} disabled={busy} />}

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

          <button type="submit" disabled={busy || files.length === 0}>
            {busy ? "Uploading…" : `Send ${files.length || ""} file${files.length === 1 ? "" : "s"}`}
          </button>
        </form>
      </section>

      <section>
        <div className="section-header">
          <h2>Your upload history</h2>
          <RefreshButton onRefresh={loadUploads} label="Refresh upload history" />
        </div>
        {!uploads ? (
          <p className="hint">Loading…</p>
        ) : uploads.length === 0 ? (
          <div className="empty-state">You haven&rsquo;t sent anything yet.</div>
        ) : (
          <ul className="card-list">
            {uploads.map((u) => (
              <li key={u.id} className="card">
                <div className="card-header">
                  <span>{formatDate(u.createdAt)}</span>
                  {u.status === "ready" ? (
                    <StatusPill tone={u.adminDownloadedAt ? "success" : "neutral"}>
                      {u.adminDownloadedAt ? "Downloaded" : "Delivered"}
                    </StatusPill>
                  ) : (
                    <StatusPill tone="pending">Uploading…</StatusPill>
                  )}
                </div>
                <ul className="file-items">
                  {u.files.map((f) => (
                    <FileItem key={f.fileId} name={f.name} size={f.size} />
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
