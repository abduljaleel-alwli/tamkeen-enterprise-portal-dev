import { NextResponse } from "next/server";
import { getPortalSession } from "../../portal-auth";
import { getRosterEmployee } from "../../employee-roster";
import { HEAD_OF_SALES_EMAIL } from "../../workflow-policy";

async function context() {
  const session = await getPortalSession();
  const { env } = await import("cloudflare:workers");
  const actor=session?await getRosterEmployee(env.DB,session.email):null;
  if (!session || !actor) return null;
  return { session, actor, db: env.DB };
}

function permissions(email: string) {
  const publishers = new Set(["m.s.g.sh.93@gmail.com", "mr.isaac.es@gmail.com", "baitaltamkeen@gmail.com", HEAD_OF_SALES_EMAIL]);
  return { canPublish: publishers.has(email), canAdmin: email === "baitaltamkeen@gmail.com" };
}

export async function GET() {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const access = permissions(ctx.actor.email), now = new Date().toISOString();
  const rows = access.canAdmin
    ? await ctx.db.prepare("SELECT * FROM announcements ORDER BY created_at DESC LIMIT 100").all()
    : await ctx.db.prepare("SELECT * FROM announcements WHERE status='published' AND starts_at<=? AND expires_at>? AND (department_scope='all' OR department_scope=?) ORDER BY created_at DESC LIMIT 10").bind(now, now, ctx.actor.department).all();
  return NextResponse.json({ announcements: rows.results ?? [], permissions: access });
}

export async function POST(request: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!permissions(ctx.actor.email).canPublish) return NextResponse.json({ error: "not_allowed" }, { status: 403 });
  const body = await request.json() as Record<string, unknown>;
  const title = String(body.title || "").trim(), text = String(body.body || "").trim();
  if (!title || !text) return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  const now = new Date(), startsAt = String(body.startsAt || now.toISOString());
  const duration = Math.min(24 * 30, Math.max(1, Number(body.durationHours) || 24));
  const expiresAt = body.expiresAt ? String(body.expiresAt) : new Date(now.getTime() + duration * 3600000).toISOString();
  const departmentScope = ctx.actor.email === HEAD_OF_SALES_EMAIL ? "المبيعات" : String(body.departmentScope || "all");
  const id = `ANN-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, createdAt = now.toISOString();
  const targetEmployees = departmentScope === "all"
    ? await ctx.db.prepare("SELECT email FROM employees WHERE status='active'").all<{email:string}>()
    : await ctx.db.prepare("SELECT email FROM employees WHERE status='active' AND department=?").bind(departmentScope).all<{email:string}>();
  const statements = [
    ctx.db.prepare("INSERT INTO announcements (id,author_email,author_name,title,body,department_scope,starts_at,expires_at,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(id, ctx.actor.email, ctx.actor.name, title, text, departmentScope, startsAt, expiresAt, "published", createdAt),
    ctx.db.prepare("INSERT INTO audit_logs (id,actor_email,action,entity_type,entity_id,payload,created_at) VALUES (?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), ctx.actor.email, "publish", "announcement", id, JSON.stringify({ departmentScope, expiresAt }), createdAt),
  ];
  for (const employee of targetEmployees.results ?? []) statements.push(ctx.db.prepare("INSERT INTO notifications (id,employee_id,title,body,created_at) SELECT ?,id,?,?,? FROM employees WHERE email=?")
    .bind(crypto.randomUUID(), title, text.slice(0, 160), createdAt, employee.email));
  await ctx.db.batch(statements);
  return NextResponse.json({ ok: true, id }, { status: 201 });
}

export async function PATCH(request: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!permissions(ctx.actor.email).canAdmin) return NextResponse.json({ error: "not_allowed" }, { status: 403 });
  const body = await request.json() as { id?: string; action?: string };
  if (!body.id || body.action !== "archive") return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  const now = new Date().toISOString();
  await ctx.db.batch([
    ctx.db.prepare("UPDATE announcements SET status='archived',archived_at=? WHERE id=?").bind(now, body.id),
    ctx.db.prepare("INSERT INTO audit_logs (id,actor_email,action,entity_type,entity_id,created_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(), ctx.actor.email, "archive", "announcement", body.id, now),
  ]);
  return NextResponse.json({ ok: true });
}
