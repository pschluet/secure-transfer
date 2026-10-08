import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../lib/api";
import { triggerBrowserDownload, uploadFiles } from "../lib/upload";
import { downloadAllAsZip } from "../lib/zip";
import { pollAfterDelays } from "../lib/poll";
import { formatDate, formatTimeLeft, zipFilename } from "../lib/format";
import { FilePicker } from "../components/FilePicker";
import { FileItem } from "../components/FileItem";
import { MessageBox } from "../components/MessageBox";
import { SentMessage } from "../components/SentMessage";
import { ProgressBar } from "../components/ProgressBar";
import { StatusPill } from "../components/StatusPill";
import { RefreshButton } from "../components/RefreshButton";
import type { PresignedFileUpload, ShareGroup, UploadGroup } from "../types";

type Tab = "shares" | "send" | "uploads";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong";
}

export function RecipientDashboard() {
  const [tab, setTab] = useState<Tab>("shares");
  const [shares, setShares] = useState<ShareGroup[] | null>(null);
  const [uploads, setUploads] = useState<UploadGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [presigned, setPresigned] = useState<PresignedFileUpload[] | null>(null);
  const [progress, setProgress] = useState<Record<string, number> | null>(null);
  const [busy, setBusy] = useState(false);
  const [zippingId, setZippingId] = useState<string | null>(null);

  async function loadShares(options?: { silent?: boolean }) {
    try {
      setShares(await api.meShares());
    } catch (err) {
      // A refresh failure here shouldn't surface as an error when it's a
      // best-effort refresh after a download that already succeeded —
      // mobile Safari can abort this background fetch with a "Load failed"
      // TypeError when it hands off to the OS download manager. Callers
      // that want visible failures (initial load, the manual Refresh
      // button) omit `silent`.
      if (!options?.silent) setError(errorMessage(err));
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

  async function handleViewMessage(shareId: string) {
    setError(null);
    try {
      await api.meViewShareMessage(shareId);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleDownload(shareId: string, fileId: string) {
    setError(null);
    try {
      const { url } = await api.meDownloadShareFile(shareId, fileId);
      triggerBrowserDownload(url);
      void loadShares({ silent: true });
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
      void loadShares({ silent: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setZippingId(null);
    }
  }

  const canSend = files.length > 0 || message.trim() !== "";

  async function handleUploadSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    setBusy(true);
    setError(null);
    try {
      const { uploads: created } = await api.meCreateUpload({
        files: files.map((f) => ({ name: f.name, size: f.size })),
        message: message.trim() || undefined,
      });
      if (created.length > 0) {
        setPresigned(created);
        setProgress(Object.fromEntries(created.map((u) => [u.fileId, 0])));
        await uploadFiles(files, created, setProgress);
      }
      setMessage("");
      setFiles([]);
      setPresigned(null);
      setProgress(null);
      void loadUploads();
      // The upload flips to "ready" once the S3 event handler processes it
      // a few seconds later — poll a couple more times so it shows up
      // without a manual refresh.
      pollAfterDelays(() => void loadUploads());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dashboard">
      <nav className="tabs">
        <button className={tab === "shares" ? "active" : ""} onClick={() => setTab("shares")}>
          Shared with you
        </button>
        <button className={tab === "send" ? "active" : ""} onClick={() => setTab("send")}>
          Send
        </button>
        <button className={tab === "uploads" ? "active" : ""} onClick={() => setTab("uploads")}>
          Sent history
        </button>
      </nav>
      {error && <p className="error">{error}</p>}

      {tab === "shares" && (
        <section>
          <div className="section-header">
            <h2>Shared with you</h2>
            <RefreshButton onRefresh={loadShares} label="Refresh shared with you" />
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
                    {s.message && (
                      <MessageBox
                        message={s.message}
                        viewedAt={s.messageViewedAt}
                        onView={() => void handleViewMessage(s.id)}
                      />
                    )}
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
      )}

      {tab === "send" && (
        <section>
          <h2>Send</h2>
          <form onSubmit={handleUploadSubmit}>
            {!presigned && (
              <>
                <label htmlFor="send-message">Message (optional)</label>
                <textarea
                  id="send-message"
                  value={message}
                  maxLength={10_000}
                  disabled={busy}
                  onChange={(e) => setMessage(e.target.value)}
                />
                <FilePicker files={files} onChange={setFiles} disabled={busy} />
              </>
            )}

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

            <button type="submit" disabled={busy || !canSend}>
              {busy ? (files.length > 0 ? "Uploading…" : "Sending…") : "Send"}
            </button>
          </form>
        </section>
      )}

      {tab === "uploads" && (
        <section>
          <div className="section-header">
            <h2>Sent history</h2>
            <RefreshButton onRefresh={loadUploads} label="Refresh sent history" />
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
                  {u.message && <SentMessage message={u.message} viewedAt={u.messageViewedAt} />}
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
      )}
    </div>
  );
}
