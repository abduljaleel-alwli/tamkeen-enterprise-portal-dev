import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { employeeRoster, ensureRoster, getRosterEmployee, permissionsForRole, type PortalRole } from "./employee-roster";
import { INITIAL_ACCESS_CODE_DIGESTS, ROTATED_ACCESS_CODE_DIGESTS } from "./initial-access-codes";

export const PORTAL_SESSION_COOKIE = "tamkeen_portal_session";
export const PORTAL_SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export type PortalSession = {
  email: string;
  name: string;
  employeeNo: string;
  jobTitle: string;
  department: string;
  role: PortalRole;
  expiresAt: string;
};

type AccessRow = {
  email: string;
  code_digest: string;
  failed_attempts: number;
  locked_until: string | null;
  is_active: number;
};

type SessionRow = {
  email: string;
  expires_at: string;
  employee_no: string;
  name: string;
  job_title: string;
  department: string;
  role: PortalRole;
};

export type PortalLoginResult =
  | { ok: true; token: string; redirectTo: "/" | "/employee"; name: string }
  | { ok: false; reason: "invalid" | "locked" | "inactive"; retryAfterMinutes?: number };

async function getRuntime() {
  const { env } = await import("cloudflare:workers");
  const pepper = String((env as unknown as { PORTAL_LOGIN_PEPPER?: string }).PORTAL_LOGIN_PEPPER ?? "");
  if (!pepper) throw new Error("PORTAL_LOGIN_PEPPER is not configured");
  return { db: env.DB, pepper };
}

export async function ensurePortalAuthSchema(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS portal_access (
      email TEXT PRIMARY KEY NOT NULL,
      code_digest TEXT NOT NULL,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_login_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS portal_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      FOREIGN KEY (email) REFERENCES employees(email) ON DELETE CASCADE
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS portal_sessions_email_idx ON portal_sessions(email)"),
    db.prepare("CREATE INDEX IF NOT EXISTS portal_sessions_expires_at_idx ON portal_sessions(expires_at)"),
  ]);
}

async function seedPortalAccess(db: D1Database): Promise<void> {
  const now = new Date().toISOString();
  const statements = employeeRoster.map((employee) => db.prepare(`
    INSERT INTO portal_access (email, code_digest, failed_attempts, is_active, created_at, updated_at)
    VALUES (?, ?, 0, 1, ?, ?)
    ON CONFLICT(email) DO NOTHING
  `).bind(employee.email, INITIAL_ACCESS_CODE_DIGESTS[employee.email], now, now));
  await db.batch(statements);
  const rotated = Object.entries(ROTATED_ACCESS_CODE_DIGESTS).map(([email,digest]) => db.prepare(`
    INSERT INTO portal_access (email, code_digest, failed_attempts, is_active, created_at, updated_at)
    VALUES (?, ?, 0, 1, ?, ?)
    ON CONFLICT(email) DO UPDATE SET code_digest=excluded.code_digest,is_active=1,updated_at=excluded.updated_at
  `).bind(email, digest, now, now));
  if (rotated.length) await db.batch(rotated);
}

export async function authenticatePortalCode(rawEmail: string, code: string): Promise<PortalLoginResult> {
  const email = rawEmail.trim().toLowerCase();
  const { db, pepper } = await getRuntime();

  await ensureRoster(db);
  await ensurePortalAuthSchema(db);
  await seedPortalAccess(db);
  const roster = await getRosterEmployee(db, email);

  if (!roster || !/^\d{6}$/.test(code)) {
    await hmacDigest(pepper, `${email}:${code}`);
    return { ok: false, reason: "invalid" };
  }

  const access = await db.prepare("SELECT * FROM portal_access WHERE email = ? LIMIT 1").bind(email).first<AccessRow>();
  if (!access || access.is_active !== 1) return { ok: false, reason: "inactive" };

  const now = new Date();
  if (access.locked_until && new Date(access.locked_until) > now) {
    const minutes = Math.max(1, Math.ceil((new Date(access.locked_until).getTime() - now.getTime()) / 60000));
    return { ok: false, reason: "locked", retryAfterMinutes: minutes };
  }

  const actualDigest = await hmacDigest(pepper, `${email}:${code}`);
  if (!constantTimeEqual(actualDigest, access.code_digest)) {
    const previousAttempts = access.locked_until ? 0 : Number(access.failed_attempts || 0);
    const attempts = previousAttempts + 1;
    const lockedUntil = attempts >= MAX_FAILED_ATTEMPTS
      ? new Date(now.getTime() + LOCK_MINUTES * 60000).toISOString()
      : null;
    await db.prepare("UPDATE portal_access SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE email = ?")
      .bind(attempts >= MAX_FAILED_ATTEMPTS ? 0 : attempts, lockedUntil, now.toISOString(), email).run();
    await writeAudit(db, email, "login_failed", { attempts, locked: Boolean(lockedUntil) });
    return lockedUntil
      ? { ok: false, reason: "locked", retryAfterMinutes: LOCK_MINUTES }
      : { ok: false, reason: "invalid" };
  }

  const token = randomHex(32);
  const tokenHash = await sha256(token);
  const expiresAt = new Date(now.getTime() + PORTAL_SESSION_MAX_AGE_SECONDS * 1000).toISOString();
  await db.batch([
    db.prepare("UPDATE portal_access SET failed_attempts = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE email = ?")
      .bind(now.toISOString(), now.toISOString(), email),
    db.prepare("DELETE FROM portal_sessions WHERE email = ? OR expires_at <= ?").bind(email, now.toISOString()),
    db.prepare("INSERT INTO portal_sessions (id, token_hash, email, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), tokenHash, email, now.toISOString(), expiresAt, now.toISOString()),
    db.prepare("INSERT INTO audit_logs (id,actor_email,action,entity_type,entity_id,payload,created_at) VALUES (?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), email, "login_success", "session", email, JSON.stringify({ role: roster.role }), now.toISOString()),
  ]);

  return { ok: true, token, redirectTo: roster.role === "admin" ? "/" : "/employee", name: roster.name };
}

export async function getPortalSession(): Promise<PortalSession | null> {
  const token = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  if (!token) return null;
  const { db } = await getRuntime();
  await ensurePortalAuthSchema(db);
  const tokenHash = await sha256(token);
  const row = await db.prepare(`
    SELECT s.email, s.expires_at, e.employee_no, e.name, e.job_title, e.department, e.role
    FROM portal_sessions s
    JOIN employees e ON e.email = s.email
    JOIN portal_access a ON a.email = s.email
    WHERE s.token_hash = ? AND s.expires_at > ? AND e.status = 'active' AND a.is_active = 1
    LIMIT 1
  `).bind(tokenHash, new Date().toISOString()).first<SessionRow>();
  if (!row) return null;
  return {
    email: row.email,
    name: row.name,
    employeeNo: row.employee_no,
    jobTitle: row.job_title,
    department: row.department,
    role: row.role,
    expiresAt: row.expires_at,
  };
}

export async function createPortalAccess(db: D1Database, email: string, code: string): Promise<void> {
  if (!/^\d{6}$/.test(code)) throw new Error("invalid_access_code");
  const { pepper } = await getRuntime();
  await ensurePortalAuthSchema(db);
  const normalized = email.trim().toLowerCase(), now = new Date().toISOString();
  const digest = await hmacDigest(pepper, `${normalized}:${code}`);
  await db.prepare(`INSERT INTO portal_access (email,code_digest,failed_attempts,locked_until,is_active,created_at,updated_at)
    VALUES (?,?,0,NULL,1,?,?) ON CONFLICT(email) DO UPDATE SET code_digest=excluded.code_digest,failed_attempts=0,locked_until=NULL,is_active=1,updated_at=excluded.updated_at`)
    .bind(normalized,digest,now,now).run();
}

export async function requirePortalSession(returnTo: string): Promise<PortalSession> {
  const session = await getPortalSession();
  if (session) return session;
  redirect(`/login?return_to=${encodeURIComponent(safeReturnPath(returnTo))}`);
}

export async function revokeCurrentPortalSession(): Promise<void> {
  const token = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  if (!token) return;
  try {
    const { db } = await getRuntime();
    await ensurePortalAuthSchema(db);
    await db.prepare("DELETE FROM portal_sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  } catch {
    // Cookie invalidation remains authoritative even if durable cleanup fails.
  }
}

export function permissionsForSession(session: PortalSession) {
  return permissionsForRole(session.role);
}

function safeReturnPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/login") || value.startsWith("/api/")) return "/employee";
  return value;
}

async function writeAudit(db: D1Database, email: string, action: string, payload: Record<string, unknown>) {
  await db.prepare("INSERT INTO audit_logs (id,actor_email,action,entity_type,entity_id,payload,created_at) VALUES (?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), email, action, "authentication", email, JSON.stringify(payload), new Date().toISOString()).run();
}

async function hmacDigest(pepper: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

async function sha256(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

function randomHex(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}
