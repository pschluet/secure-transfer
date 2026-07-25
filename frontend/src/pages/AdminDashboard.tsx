import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { triggerBrowserDownload } from "../lib/upload";
import { downloadAllAsZip } from "../lib/zip";
import { formatBytes, formatDate, formatTimeLeft, zipFilename } from "../lib/format";
import { CreateUserForm } from "../components/CreateUserForm";
import { ShareFilesForm } from "../components/ShareFilesForm";
import { Modal } from "../components/Modal";
import { FileItem } from "../components/FileItem";
import { StatusPill } from "../components/StatusPill";
import { RefreshButton } from "../components/RefreshButton";
import type { AdminUserRow, ShareGroupWithRecipient, UploadGroupWithSender, UserProfile } from "../types";

type Tab = "users" | "shares" | "uploads";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong";
}

export function AdminDashboard() {
  const [tab, setTab] = useState<Tab>("users");
  const [users, setUsers] = useState<AdminUserRow[] | null>(null);
  const [shares, setShares] = useState<ShareGroupWithRecipient[] | null>(null);
  const [uploads, setUploads] = useState<UploadGroupWithSender[] | null>(null);
  const [shareTarget, setShareTarget] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zippingId, setZippingId] = useState<string | null>(null);

  async function loadUsers() {
    try {
      setUsers(await api.adminListUsers());
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  async function loadShares() {
    try {
      setShares(await api.adminListShares());
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  async function loadUploads() {
    try {
      setUploads(await api.adminListUploads());
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  useEffect(() => {
    void loadUsers();
    void loadShares();
    void loadUploads();
  }, []);

  async function handleDeleteShare(s: ShareGroupWithRecipient) {
    if (!confirm("Delete this share? This removes the files permanently.")) return;
    try {
      await api.adminDeleteShare(s.recipientSub, s.id);
      void loadShares();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleDeleteUpload(u: UploadGroupWithSender) {
    if (!confirm("Delete these files permanently?")) return;
    try {
      await api.adminDeleteUpload(u.senderSub, u.id);
      void loadUploads();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleDownload(u: UploadGroupWithSender, fileId: string) {
    try {
      const { url } = await api.adminDownloadUploadFile(u.senderSub, u.id, fileId);
      triggerBrowserDownload(url);
      void loadUploads();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleDownloadAll(u: UploadGroupWithSender) {
    setZippingId(u.id);
    setError(null);
    try {
      const readyFiles = u.files.filter((f) => f.status === "ready");
      const withUrls = await Promise.all(
        readyFiles.map(async (f) => ({
          name: f.name,
          url: (await api.adminDownloadUploadFile(u.senderSub, u.id, f.fileId)).url,
        }))
      );
      await downloadAllAsZip(withUrls, zipFilename("secure-transfer", u.createdAt));
      void loadUploads();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setZippingId(null);
    }
  }

  return (
    <div className="dashboard">
      <nav className="tabs">
        <button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}>
          Users
        </button>
        <button className={tab === "shares" ? "active" : ""} onClick={() => setTab("shares")}>
          Shares sent
        </button>
        <button className={tab === "uploads" ? "active" : ""} onClick={() => setTab("uploads")}>
          Files received
        </button>
      </nav>
      {error && <p className="error">{error}</p>}

      {tab === "users" && (
        <section>
          <h2>Add a user</h2>
          <CreateUserForm onCreated={() => void loadUsers()} />
          <h2>Users</h2>
          {!users ? (
            <p className="hint">Loading…</p>
          ) : users.length === 0 ? (
            <div className="empty-state">No users yet — add one above.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Downloaded?</th>
                  <th>Sent files?</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.sub}>
                    <td>
                      {u.firstName} {u.lastName}
                    </td>
                    <td>{u.email}</td>
                    <td>
                      <StatusPill tone={u.hasDownloaded ? "success" : "neutral"}>
                        {u.hasDownloaded ? "Yes" : "No"}
                      </StatusPill>
                    </td>
                    <td>
                      <StatusPill tone={u.hasSent ? "success" : "neutral"}>
                        {u.hasSent ? "Yes" : "No"}
                      </StatusPill>
                    </td>
                    <td>
                      <button className="secondary small" onClick={() => setShareTarget(u)}>
                        Share files
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {tab === "shares" && (
        <section>
          <div className="section-header">
            <h2>Files you&rsquo;ve shared</h2>
            <RefreshButton onRefresh={loadShares} label="Refresh shares" />
          </div>
          {!shares ? (
            <p className="hint">Loading…</p>
          ) : shares.length === 0 ? (
            <div className="empty-state">Nothing shared yet.</div>
          ) : (
            <ul className="card-list">
              {shares.map((s) => (
                <li key={s.id} className="card">
                  <div className="card-header">
                    <span>
                      {s.recipient ? `${s.recipient.firstName} ${s.recipient.lastName}` : "Unknown"} —{" "}
                      {formatDate(s.createdAt)}
                    </span>
                    <span className="mono">
                      {s.status === "ready" ? formatTimeLeft(s.expiresAt) : "Uploading…"}
                    </span>
                  </div>
                  <ul className="file-items">
                    {s.files.map((f) => (
                      <FileItem
                        key={f.fileId}
                        name={f.name}
                        size={f.size}
                        right={
                          f.downloadedAt ? (
                            <StatusPill tone="success">Downloaded</StatusPill>
                          ) : (
                            <StatusPill tone="neutral">Not downloaded</StatusPill>
                          )
                        }
                      />
                    ))}
                  </ul>
                  <div className="card-actions">
                    <button className="danger small" onClick={() => void handleDeleteShare(s)}>
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "uploads" && (
        <section>
          <div className="section-header">
            <h2>Files sent to you</h2>
            <RefreshButton onRefresh={loadUploads} label="Refresh uploads" />
          </div>
          {!uploads ? (
            <p className="hint">Loading…</p>
          ) : uploads.length === 0 ? (
            <div className="empty-state">Nothing received yet.</div>
          ) : (
            <ul className="card-list">
              {uploads.map((u) => {
                const readyCount = u.files.filter((f) => f.status === "ready").length;
                return (
                  <li key={u.id} className="card">
                    <div className="card-header">
                      <span>
                        {u.sender ? `${u.sender.firstName} ${u.sender.lastName}` : "Unknown"} —{" "}
                        {formatDate(u.createdAt)}
                      </span>
                      <span>{formatBytes(u.totalSize)}</span>
                    </div>
                    <ul className="file-items">
                      {u.files.map((f) => (
                        <FileItem
                          key={f.fileId}
                          name={f.name}
                          size={f.size}
                          right={
                            f.status === "ready" ? (
                              <button
                                className="secondary small"
                                onClick={() => void handleDownload(u, f.fileId)}
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
                    <div className="card-actions" style={{ justifyContent: "space-between" }}>
                      {readyCount > 1 ? (
                        <button
                          className="secondary small"
                          disabled={zippingId === u.id}
                          onClick={() => void handleDownloadAll(u)}
                        >
                          {zippingId === u.id ? "Zipping…" : `Download all as .zip (${readyCount})`}
                        </button>
                      ) : (
                        <span />
                      )}
                      <button className="danger small" onClick={() => void handleDeleteUpload(u)}>
                        Delete
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {shareTarget && (
        <Modal title="Share files" onClose={() => setShareTarget(null)}>
          <ShareFilesForm
            recipient={shareTarget}
            onDone={() => {
              setShareTarget(null);
              void loadShares();
              void loadUsers();
            }}
          />
        </Modal>
      )}
    </div>
  );
}
