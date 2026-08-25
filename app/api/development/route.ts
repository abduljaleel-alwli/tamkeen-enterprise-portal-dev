import { NextResponse } from "next/server";
import { getPortalSession } from "../../portal-auth";
import { getRosterEmployee } from "../../employee-roster";

async function context() {
  const session = await getPortalSession();
  const { env } = await import("cloudflare:workers");
  const actor=session?await getRosterEmployee(env.DB,session.email):null;
  if (!session || !actor) return null;
  return { actor, db: env.DB };
}

export async function GET() {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await ctx.db.prepare("SELECT * FROM development_plans WHERE employee_email=? ORDER BY created_at DESC").bind(ctx.actor.email).all();
  return NextResponse.json({ plans: rows.results ?? [] });
}

export async function POST(request: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json() as Record<string, unknown>;
  const area = String(body.improvementArea || "").trim(), actions = String(body.actions || "").trim();
  if (!area || !actions) return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  const id = `DEV-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, now = new Date().toISOString();
  await ctx.db.batch([
    ctx.db.prepare("INSERT INTO development_plans (id,employee_email,improvement_area,actions,due_date,progress,status,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(id, ctx.actor.email, area, actions, String(body.dueDate || "") || null, 0, "active", ctx.actor.email, now, now),
    ctx.db.prepare("INSERT INTO audit_logs (id,actor_email,action,entity_type,entity_id,payload,created_at) VALUES (?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), ctx.actor.email, "create", "development_plan", id, JSON.stringify({ area }), now),
  ]);
  return NextResponse.json({ ok: true, id }, { status: 201 });
}

export async function PATCH(request: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json() as Record<string, unknown>, progress = Math.min(100, Math.max(0, Number(body.progress) || 0));
  const status = progress >= 100 ? "completed" : "active", now = new Date().toISOString();
  const result = await ctx.db.prepare("UPDATE development_plans SET progress=?,status=?,updated_at=? WHERE id=? AND employee_email=?")
    .bind(progress, status, now, String(body.id || ""), ctx.actor.email).run();
  if (!result.meta.changes) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
