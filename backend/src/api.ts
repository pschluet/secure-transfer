import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import { cors } from "hono/cors";
import { ulid } from "ulid";
import { z } from "zod";
import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminUpdateUserAttributesCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import { db } from "./db";
import { getClaims, isAdmin } from "./auth";
import { recordAudit } from "./audit";
import {
  presignUpload,
  presignDownload,
  deleteObject,
  shareKey,
  uploadKey,
} from "./s3";
import { sendUserInvitedEmail } from "./email";
import type {
  AuditLog,
  FileEntry,
  ShareGroup,
  UploadGroup,
  UserProfile,
  PresignedFileUpload,
} from "./types";

const USER_POOL_ID = process.env.USER_POOL_ID!;
const cognito = new CognitoIdentityProviderClient({});

// Mounted under /api so CloudFront can route /api/* to this API's origin as
// same-origin traffic (no CORS needed between the SPA and the API in prod).
const app = new Hono().basePath("/api");

app.use(
  "*",
  cors({
    origin: process.env.ALLOWED_ORIGIN ?? "*",
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  })
);

app.use("/admin/*", async (c, next) => {
  const claims = getClaims(c);
  if (!isAdmin(claims)) return c.json({ error: "Forbidden" }, 403);
  await next();
});

function newFilesAndUploads(
  files: { name: string; size: number }[],
  keyFn: (fileId: string, name: string) => string
): { entries: FileEntry[]; uploads: Promise<PresignedFileUpload>[] } {
  const entries: FileEntry[] = [];
  const uploads = files.map(async (f) => {
    const fileId = ulid();
    const key = keyFn(fileId, f.name);
    entries.push({ fileId, name: f.name, size: f.size, s3Key: key, status: "pending" });
    return { fileId, name: f.name, uploadUrl: await presignUpload(key) };
  });
  return { entries, uploads };
}

async function recordShareDownload(group: ShareGroup, fileId: string): Promise<void> {
  const idx = group.files.findIndex((f) => f.fileId === fileId);
  const now = new Date().toISOString();
  let expr = "SET lastDownloadAt = :now";
  const values: Record<string, unknown> = { ":now": now };
  const names: Record<string, string> = {};
  if (!group.firstDownloadAt) expr += ", firstDownloadAt = :now";
  if (idx >= 0) {
    names["#files"] = "files";
    expr += `, #files[${idx}].downloadedAt = :now`;
  }
  await db.update(group.pk, group.sk, expr, values, Object.keys(names).length ? names : undefined);
}

// ---------------------------------------------------------------------------
// Admin: users
// ---------------------------------------------------------------------------

const createUserSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email(),
});

app.post("/admin/users", async (c) => {
  const body = createUserSchema.parse(await c.req.json());
  const email = body.email.toLowerCase();

  const created = await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      UserAttributes: [
        { Name: "email", Value: email },
        { Name: "email_verified", Value: "true" },
        { Name: "given_name", Value: body.firstName },
        { Name: "family_name", Value: body.lastName },
      ],
      MessageAction: "SUPPRESS",
    })
  );

  const sub = created.User?.Attributes?.find((a) => a.Name === "sub")?.Value;
  if (!sub) return c.json({ error: "Failed to create user" }, 500);

  const now = new Date().toISOString();
  const profile: UserProfile = {
    pk: `USER#${sub}`,
    sk: "PROFILE",
    sub,
    email,
    firstName: body.firstName,
    lastName: body.lastName,
    createdAt: now,
    gsi1pk: "USERS",
    gsi1sk: email,
  };
  await db.put(profile);
  await sendUserInvitedEmail(email, body.firstName);
  return c.json(profile, 201);
});

app.get("/admin/users", async (c) => {
  const [profiles, shares, uploads] = await Promise.all([
    db.queryGsi1<UserProfile>("USERS"),
    db.queryGsi1<ShareGroup>("SHARES"),
    db.queryGsi1<UploadGroup>("UPLOADS"),
  ]);

  const hasDownloadBySub = new Set(
    shares.filter((s) => !!s.firstDownloadAt).map((s) => s.recipientSub)
  );
  const hasSentBySub = new Set(
    uploads.filter((u) => u.status === "ready").map((u) => u.senderSub)
  );

  const result = profiles
    .map((p) => ({
      ...p,
      hasDownloaded: hasDownloadBySub.has(p.sub),
      hasSent: hasSentBySub.has(p.sub),
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return c.json(result);
});

const updateUserSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
});

app.patch("/admin/users/:sub", async (c) => {
  const sub = c.req.param("sub");
  const profile = await db.get<UserProfile>(`USER#${sub}`, "PROFILE");
  if (!profile) return c.json({ error: "User not found" }, 404);

  const body = updateUserSchema.parse(await c.req.json());

  await cognito.send(
    new AdminUpdateUserAttributesCommand({
      UserPoolId: USER_POOL_ID,
      Username: profile.email,
      UserAttributes: [
        { Name: "given_name", Value: body.firstName },
        { Name: "family_name", Value: body.lastName },
      ],
    })
  );

  const updated = await db.update(
    profile.pk,
    profile.sk,
    "SET firstName = :fn, lastName = :ln",
    { ":fn": body.firstName, ":ln": body.lastName },
    undefined,
    { returnValues: "ALL_NEW" }
  );
  return c.json(updated);
});

app.delete("/admin/users/:sub", async (c) => {
  const sub = c.req.param("sub");
  const profile = await db.get<UserProfile>(`USER#${sub}`, "PROFILE");
  if (!profile) return c.json({ error: "User not found" }, 404);

  const items = await db.queryByPk<ShareGroup | UploadGroup>(`USER#${sub}`);
  const shares = items.filter((i): i is ShareGroup => i.sk.startsWith("SHARE#"));
  const uploads = items.filter((i): i is UploadGroup => i.sk.startsWith("UPLOAD#"));

  await Promise.all(
    [...shares, ...uploads].map(async (group) => {
      await Promise.all(group.files.map((f) => deleteObject(f.s3Key)));
      await db.delete(group.pk, group.sk);
    })
  );

  await cognito.send(
    new AdminDeleteUserCommand({ UserPoolId: USER_POOL_ID, Username: profile.email })
  );
  await db.delete(profile.pk, profile.sk);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Admin: shares (admin -> recipient)
// ---------------------------------------------------------------------------

app.get("/admin/shares", async (c) => {
  const [shares, profiles] = await Promise.all([
    db.queryGsi1<ShareGroup>("SHARES"),
    db.queryGsi1<UserProfile>("USERS"),
  ]);
  const profileBySub = new Map(profiles.map((p) => [p.sub, p]));
  const enriched = shares
    .map((s) => ({ ...s, recipient: profileBySub.get(s.recipientSub) ?? null }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return c.json(enriched);
});

const createShareSchema = z.object({
  files: z.array(z.object({ name: z.string().min(1), size: z.number().nonnegative() })).min(1),
  expiresInHours: z.number().positive().max(24 * 365),
});

app.post("/admin/users/:sub/shares", async (c) => {
  const recipientSub = c.req.param("sub");
  const recipient = await db.get<UserProfile>(`USER#${recipientSub}`, "PROFILE");
  if (!recipient) return c.json({ error: "User not found" }, 404);

  const body = createShareSchema.parse(await c.req.json());
  const id = ulid();
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + body.expiresInHours * 3600_000).toISOString();
  const admin = getClaims(c);

  const { entries, uploads } = newFilesAndUploads(body.files, (fileId, name) =>
    shareKey(recipientSub, id, `${fileId}-${name}`)
  );
  const resolvedUploads = await Promise.all(uploads);

  const group: ShareGroup = {
    pk: `USER#${recipientSub}`,
    sk: `SHARE#${createdAt}#${id}`,
    id,
    recipientSub,
    files: entries,
    fileCount: entries.length,
    readyCount: 0,
    totalSize: body.files.reduce((sum, f) => sum + f.size, 0),
    createdAt,
    expiresAt,
    status: "pending",
    // Recorded at creation time (rather than derived later) because the
    // S3-completion handler that logs the eventual "upload" audit event has
    // no auth context, and the S3 key only encodes the recipient — not
    // which admin created the share.
    createdBySub: admin.sub,
    createdByEmail: admin.email,
    gsi1pk: "SHARES",
    gsi1sk: createdAt,
  };
  await db.put(group);
  return c.json({ group, uploads: resolvedUploads }, 201);
});

app.delete("/admin/users/:sub/shares/:id", async (c) => {
  const sub = c.req.param("sub");
  const id = c.req.param("id");
  const items = await db.queryByPk<ShareGroup>(`USER#${sub}`, "SHARE#");
  const group = items.find((i) => i.id === id);
  if (!group) return c.json({ error: "Not found" }, 404);
  await Promise.all(group.files.map((f) => deleteObject(f.s3Key)));
  await db.delete(group.pk, group.sk);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Admin: uploads (recipient -> admin)
// ---------------------------------------------------------------------------

app.get("/admin/uploads", async (c) => {
  const [uploads, profiles] = await Promise.all([
    db.queryGsi1<UploadGroup>("UPLOADS"),
    db.queryGsi1<UserProfile>("USERS"),
  ]);
  const profileBySub = new Map(profiles.map((p) => [p.sub, p]));
  const enriched = uploads
    .map((u) => ({ ...u, sender: profileBySub.get(u.senderSub) ?? null }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return c.json(enriched);
});

app.get("/admin/users/:sub/uploads/:id/files/:fileId/download", async (c) => {
  const sub = c.req.param("sub");
  const id = c.req.param("id");
  const fileId = c.req.param("fileId");
  const items = await db.queryByPk<UploadGroup>(`USER#${sub}`, "UPLOAD#");
  const group = items.find((i) => i.id === id);
  if (!group) return c.json({ error: "Not found" }, 404);
  const file = group.files.find((f) => f.fileId === fileId);
  if (!file || file.status !== "ready") return c.json({ error: "Not found" }, 404);

  const url = await presignDownload(file.s3Key, file.name);
  if (!group.adminDownloadedAt) {
    await db.update(group.pk, group.sk, "SET adminDownloadedAt = :now", {
      ":now": new Date().toISOString(),
    });
  }
  const admin = getClaims(c);
  void recordAudit({
    action: "download",
    context: "upload",
    fileName: file.name,
    fileId: file.fileId,
    size: file.size,
    actorSub: admin.sub,
    actorEmail: admin.email,
  }).catch((err) => console.error("audit log write failed", err));
  return c.json({ url });
});

app.delete("/admin/users/:sub/uploads/:id", async (c) => {
  const sub = c.req.param("sub");
  const id = c.req.param("id");
  const items = await db.queryByPk<UploadGroup>(`USER#${sub}`, "UPLOAD#");
  const group = items.find((i) => i.id === id);
  if (!group) return c.json({ error: "Not found" }, 404);
  await Promise.all(group.files.map((f) => deleteObject(f.s3Key)));
  await db.delete(group.pk, group.sk);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Admin: audit log
// ---------------------------------------------------------------------------

app.get("/admin/audit", async (c) => {
  const page = Math.max(1, Number(c.req.query("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize") ?? "25") || 25));
  const sort = c.req.query("sort") === "asc" ? "asc" : "desc";
  const fileName = (c.req.query("fileName") ?? "").trim().toLowerCase();
  const from = c.req.query("from"); // ISO date, e.g. "2026-07-01"
  const to = c.req.query("to");

  const entries = await db.queryGsi1<AuditLog>("AUDIT");

  const filtered = entries.filter((e) => {
    if (fileName && !e.fileName.toLowerCase().includes(fileName)) return false;
    if (from && e.timestamp < from) return false;
    // Treat `to` as inclusive of the whole day.
    if (to && e.timestamp > `${to}T23:59:59.999Z`) return false;
    return true;
  });

  filtered.sort((a, b) =>
    sort === "asc"
      ? a.timestamp < b.timestamp ? -1 : 1
      : a.timestamp < b.timestamp ? 1 : -1
  );

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const pageEntries = filtered.slice(start, start + pageSize);

  return c.json({ entries: pageEntries, total, page, pageSize });
});

// ---------------------------------------------------------------------------
// Recipient ("me") routes
// ---------------------------------------------------------------------------

app.get("/me", async (c) => {
  const { sub } = getClaims(c);
  const profile = await db.get<UserProfile>(`USER#${sub}`, "PROFILE");
  return c.json(profile ?? null);
});

app.get("/me/shares", async (c) => {
  const { sub } = getClaims(c);
  const items = await db.queryByPk<ShareGroup>(`USER#${sub}`, "SHARE#");
  const now = new Date().toISOString();
  const active = items.filter((i) => i.status === "ready" && i.expiresAt > now);
  return c.json(active.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
});

app.get("/me/shares/:id/files/:fileId/download", async (c) => {
  const { sub, email } = getClaims(c);
  const id = c.req.param("id");
  const fileId = c.req.param("fileId");
  const items = await db.queryByPk<ShareGroup>(`USER#${sub}`, "SHARE#");
  const group = items.find((i) => i.id === id);
  if (!group) return c.json({ error: "Not found" }, 404);
  if (group.expiresAt <= new Date().toISOString()) return c.json({ error: "Expired" }, 410);
  const file = group.files.find((f) => f.fileId === fileId);
  if (!file || file.status !== "ready") return c.json({ error: "Not found" }, 404);

  const url = await presignDownload(file.s3Key, file.name);
  await recordShareDownload(group, fileId);
  const profile = await db.get<UserProfile>(`USER#${sub}`, "PROFILE");
  void recordAudit({
    action: "download",
    context: "share",
    fileName: file.name,
    fileId: file.fileId,
    size: file.size,
    actorSub: sub,
    actorEmail: email,
    actorName: profile ? `${profile.firstName} ${profile.lastName}` : undefined,
  }).catch((err) => console.error("audit log write failed", err));
  return c.json({ url });
});

app.get("/me/uploads", async (c) => {
  const { sub } = getClaims(c);
  const items = await db.queryByPk<UploadGroup>(`USER#${sub}`, "UPLOAD#");
  return c.json(items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
});

const createUploadSchema = z.object({
  files: z.array(z.object({ name: z.string().min(1), size: z.number().nonnegative() })).min(1),
});

app.post("/me/uploads", async (c) => {
  const { sub } = getClaims(c);
  const body = createUploadSchema.parse(await c.req.json());
  const id = ulid();
  const createdAt = new Date().toISOString();

  const { entries, uploads } = newFilesAndUploads(body.files, (fileId, name) =>
    uploadKey(sub, id, `${fileId}-${name}`)
  );
  const resolvedUploads = await Promise.all(uploads);

  const group: UploadGroup = {
    pk: `USER#${sub}`,
    sk: `UPLOAD#${createdAt}#${id}`,
    id,
    senderSub: sub,
    files: entries,
    fileCount: entries.length,
    readyCount: 0,
    totalSize: body.files.reduce((sum, f) => sum + f.size, 0),
    createdAt,
    status: "pending",
    gsi1pk: "UPLOADS",
    gsi1sk: createdAt,
  };
  await db.put(group);
  return c.json({ group, uploads: resolvedUploads }, 201);
});

// ---------------------------------------------------------------------------

app.onError((err, c) => {
  if (err instanceof z.ZodError) {
    return c.json({ error: "Invalid request", details: err.issues }, 400);
  }
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});

export const handler = handle(app);
