import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { triggerBrowserDownload } from "../lib/upload";
import { formatBytes, formatDate, formatTimeLeft } from "../lib/format";
import { CreateUserForm } from "../components/CreateUserForm";
import { ShareFilesForm } from "../components/ShareFilesForm";
import { Modal } from "../components/Modal";
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
            <p>Loading…</p>
          ) : users.length === 0 ? (
            <p className="hint">No users yet.</p>
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
                    <td>{u.hasDownloaded ? "Yes" : "No"}</td>
                    <td>{u.hasSent ? "Yes" : "No"}</td>
                    <td>
                      <button onClick={() => setShareTarget(u)}>Share files</button>
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
          <h2>Files you&rsquo;ve shared</h2>
          {!shares ? (
            <p>Loading…</p>
          ) : shares.length === 0 ? (
            <p className="hint">Nothing shared yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Recipient</th>
                  <th>Files</th>
                  <th>Size</th>
                  <th>Created</th>
                  <th>Status</th>
                  <th>Downloaded?</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {shares.map((s) => (
                  <tr key={s.id}>
                    <td>
                      {s.recipient ? `${s.recipient.firstName} ${s.recipient.lastName}` : "Unknown"}
                    </td>
                    <td>{s.files.map((f) => f.name).join(", ")}</td>
                    <td>{formatBytes(s.totalSize)}</td>
                    <td>{formatDate(s.createdAt)}</td>
                    <td>{s.status === "ready" ? formatTimeLeft(s.expiresAt) : "Uploading…"}</td>
                    <td>{s.firstDownloadAt ? `Yes (${formatDate(s.firstDownloadAt)})` : "No"}</td>
                    <td>
                      <button className="danger" onClick={() => void handleDeleteShare(s)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {tab === "uploads" && (
        <section>
          <h2>Files sent to you</h2>
          {!uploads ? (
            <p>Loading…</p>
          ) : uploads.length === 0 ? (
            <p className="hint">Nothing received yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>From</th>
                  <th>Files</th>
                  <th>Size</th>
                  <th>Received</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {uploads.map((u) => (
                  <tr key={u.id}>
                    <td>{u.sender ? `${u.sender.firstName} ${u.sender.lastName}` : "Unknown"}</td>
                    <td>
                      {u.files.map((f) => (
                        <div key={f.fileId} className="file-row">
                          <span>{f.name}</span>
                          {f.status === "ready" && (
                            <button onClick={() => void handleDownload(u, f.fileId)}>Download</button>
                          )}
                        </div>
                      ))}
                    </td>
                    <td>{formatBytes(u.totalSize)}</td>
                    <td>{formatDate(u.createdAt)}</td>
                    <td>
                      {u.status === "ready"
                        ? u.adminDownloadedAt
                          ? "Downloaded"
                          : "New"
                        : "Uploading…"}
                    </td>
                    <td>
                      <button className="danger" onClick={() => void handleDeleteUpload(u)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
