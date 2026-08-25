import { NextResponse } from "next/server";
import { getPortalSession } from "../../portal-auth";
import { getRosterEmployee } from "../../employee-roster";

export async function GET() {
  const session = await getPortalSession();
  const { env } = await import("cloudflare:workers");
  const actor = session ? await getRosterEmployee(env.DB,session.email) : null;
  if (!session || !actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (actor.role !== "admin") return NextResponse.json({ error: "not_allowed" }, { status: 403 });
  const rows = await env.DB.prepare("SELECT s.*,e.name AS requester_name FROM support_requests s JOIN employees e ON e.email=s.requester_email ORDER BY s.created_at DESC LIMIT 100").all();
  return NextResponse.json({ requests: rows.results ?? [] });
}

export async function POST(request: Request) {
  const session = await getPortalSession();
  const { env } = await import("cloudflare:workers");
  const actor = session ? await getRosterEmployee(env.DB,session.email) : null;
  if (!session || !actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json() as Record<string, unknown>;
  const category = String(body.category || "").trim(), subject = String(body.subject || "").trim(), message = String(body.message || "").trim();
  if (!category || !subject || !message) return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  const id = `SUP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO support_requests (id,requester_email,category,subject,message,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
      .bind(id, actor.email, category, subject, message, "open", now, now),
    env.DB.prepare("INSERT INTO notifications (id,employee_id,title,body,created_at) SELECT ?,id,?,?,? FROM employees WHERE email=?")
      .bind(crypto.randomUUID(), `طلب مساندة: ${category}`, `${actor.name}: ${subject}`, now, "baitaltamkeen@gmail.com"),
    env.DB.prepare("INSERT INTO audit_logs (id,actor_email,action,entity_type,entity_id,payload,created_at) VALUES (?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), actor.email, "submit", "support_request", id, JSON.stringify({ category, subject }), now),
  ]);
  return NextResponse.json({ ok: true, id }, { status: 201 });
}
