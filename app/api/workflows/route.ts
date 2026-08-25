import { NextResponse } from "next/server";
import { getPortalSession } from "../../portal-auth";
import { employeeRoster, getRosterEmployee, type RosterEmployee } from "../../employee-roster";
import { authorityFor, canActAtStage, initialStage, nextStage, workflowLabels, type WorkflowKind, HEAD_OF_ACCOUNTS_EMAIL } from "../../workflow-policy";

type WorkflowRow = {
  id: string; kind: WorkflowKind; title: string; summary: string | null; period: string | null; amount: string | null;
  channel: string | null; publish_date: string | null; department: string; requester_email: string; requester_name: string;
  current_stage: string; status: string; gm_requested: number; decision_note: string | null; created_at: string; updated_at: string;
};

async function runtime() {
  const session = await getPortalSession();
  if (!session) return null;
  const { env } = await import("cloudflare:workers");
  const actor=await getRosterEmployee(env.DB,session.email);
  if (!actor) return null;
  return { session, actor, db: env.DB };
}

function visibleTo(row: WorkflowRow, actor: RosterEmployee) {
  const a = authorityFor(actor);
  if (row.requester_email === actor.email || a.isGeneralManager || actor.role === "admin") return true;
  if (a.isExecutiveManagement && (row.current_stage === "executive_management" || row.kind === "department_report" || row.kind === "budget_request")) return true;
  if (a.isHeadOfAccounts && row.status === "approved" && ["sales_target", "commission_policy", "budget_request"].includes(row.kind)) return true;
  if (a.isSalesSupervisor && row.department === "المبيعات" && ["content_approval", "sales_monthly_plan", "sales_monthly_report"].includes(row.kind)) return true;
  if (a.isHeadOfSales && row.department === "المبيعات") return true;
  if (actor.role === "department_head" && row.department === actor.department) return true;
  return canActAtStage(actor, row.current_stage);
}

export async function GET() {
  const ctx = await runtime();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await ctx.db.prepare("SELECT * FROM workflow_items ORDER BY created_at DESC LIMIT 120").all<WorkflowRow>();
  const items = (rows.results ?? []).filter((row) => visibleTo(row, ctx.actor)).map((row) => ({
    ...row,
    kind_label: workflowLabels[row.kind] ?? row.kind,
    can_act: row.status === "pending" && canActAtStage(ctx.actor, row.current_stage),
    can_resubmit: row.status === "returned" && row.requester_email === ctx.actor.email,
    is_approved_copy: authorityFor(ctx.actor).isHeadOfAccounts && row.status === "approved" && ["sales_target", "commission_policy", "budget_request"].includes(row.kind),
  }));
  const authority = authorityFor(ctx.actor);
  return NextResponse.json({ items, authority: { ...authority, createKinds: authority.createKinds.map((kind) => ({ kind, label: workflowLabels[kind] })) } });
}

export async function POST(request: Request) {
  const ctx = await runtime();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json() as Record<string, unknown>;
  const kind = String(body.kind ?? "") as WorkflowKind;
  const authority = authorityFor(ctx.actor);
  if (!authority.createKinds.includes(kind) || !String(body.title ?? "").trim()) return NextResponse.json({ error: "not_allowed" }, { status: 403 });
  const gmRequested = kind === "department_report" && body.gmRequested === true;
  const stage = initialStage(kind, gmRequested);
  const id = `WF-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 7).toUpperCase()}`;
  const now = new Date().toISOString();
  const statements = [
    ctx.db.prepare("INSERT INTO workflow_items (id,kind,title,summary,period,amount,channel,publish_date,department,requester_email,requester_name,current_stage,status,gm_requested,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id, kind, String(body.title).trim(), String(body.summary ?? "").trim() || null, String(body.period ?? "").trim() || null, String(body.amount ?? "").trim() || null, String(body.channel ?? "").trim() || null, String(body.publishDate ?? "").trim() || null, ctx.actor.department, ctx.actor.email, ctx.actor.name, stage, "pending", gmRequested ? 1 : 0, now, now),
    ctx.db.prepare("INSERT INTO workflow_actions (id,workflow_id,actor_email,actor_name,action,note,from_stage,to_stage,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), id, ctx.actor.email, ctx.actor.name, "submit", null, "draft", stage, now),
    ctx.db.prepare("INSERT INTO audit_logs (id,actor_email,action,entity_type,entity_id,payload,created_at) VALUES (?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), ctx.actor.email, "submit", "workflow", id, JSON.stringify({ kind, stage }), now),
  ];
  const recipients = employeeRoster.filter((employee) => canActAtStage(employee, stage));
  for (const recipient of recipients) statements.push(ctx.db.prepare("INSERT INTO notifications (id,employee_id,title,body,created_at) SELECT ?,id,?,?,? FROM employees WHERE email=?")
    .bind(crypto.randomUUID(), "معاملة جديدة بانتظار إجراءك", `${ctx.actor.name}: ${String(body.title).trim()}`, now, recipient.email));
  await ctx.db.batch(statements);
  return NextResponse.json({ ok: true, id }, { status: 201 });
}

export async function PATCH(request: Request) {
  const ctx = await runtime();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json() as { id?: string; action?: string; note?: string };
  const row = await ctx.db.prepare("SELECT * FROM workflow_items WHERE id = ? LIMIT 1").bind(body.id ?? "").first<WorkflowRow>();
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (body.action === "resubmit") {
    if (row.status !== "returned" || row.requester_email !== ctx.actor.email) return NextResponse.json({ error: "not_allowed" }, { status: 403 });
    const stage = initialStage(row.kind, Boolean(row.gm_requested));
    const now = new Date().toISOString();
    const statements = [
      ctx.db.prepare("UPDATE workflow_items SET current_stage=?,status='pending',decision_note=NULL,updated_at=? WHERE id=?").bind(stage, now, row.id),
      ctx.db.prepare("INSERT INTO workflow_actions (id,workflow_id,actor_email,actor_name,action,note,from_stage,to_stage,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(crypto.randomUUID(), row.id, ctx.actor.email, ctx.actor.name, "resubmit", String(body.note ?? "").trim() || null, "requester_revision", stage, now),
    ];
    for (const recipient of employeeRoster.filter((employee) => canActAtStage(employee, stage))) statements.push(ctx.db.prepare("INSERT INTO notifications (id,employee_id,title,body,created_at) SELECT ?,id,?,?,? FROM employees WHERE email=?")
      .bind(crypto.randomUUID(), "معاملة معدلة بانتظارك", `${ctx.actor.name}: ${row.title}`, now, recipient.email));
    await ctx.db.batch(statements);
    return NextResponse.json({ ok: true, status: "pending", currentStage: stage });
  }
  if (row.status !== "pending" || !canActAtStage(ctx.actor, row.current_stage)) return NextResponse.json({ error: "not_allowed" }, { status: 403 });
  if (!body.action || !["approve", "return"].includes(body.action)) return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  if (body.action === "return" && !String(body.note ?? "").trim()) return NextResponse.json({ error: "note_required" }, { status: 400 });
  const toStage = body.action === "return" ? "requester_revision" : nextStage(row.kind, row.current_stage);
  const finalApproved = body.action === "approve" && toStage === "completed";
  const status = body.action === "return" ? "returned" : finalApproved ? "approved" : "pending";
  const now = new Date().toISOString();
  const statements = [
    ctx.db.prepare("UPDATE workflow_items SET current_stage = ?, status = ?, decision_note = ?, updated_at = ? WHERE id = ?")
      .bind(toStage, status, String(body.note ?? "").trim() || null, now, row.id),
    ctx.db.prepare("INSERT INTO workflow_actions (id,workflow_id,actor_email,actor_name,action,note,from_stage,to_stage,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), row.id, ctx.actor.email, ctx.actor.name, body.action, String(body.note ?? "").trim() || null, row.current_stage, toStage, now),
    ctx.db.prepare("INSERT INTO audit_logs (id,actor_email,action,entity_type,entity_id,payload,created_at) VALUES (?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), ctx.actor.email, body.action, "workflow", row.id, JSON.stringify({ from: row.current_stage, to: toStage }), now),
  ];
  if (finalApproved && ["sales_target", "commission_policy", "budget_request"].includes(row.kind)) {
    statements.push(ctx.db.prepare("INSERT INTO notifications (id,employee_id,title,body,created_at) SELECT ?,id,?,?,? FROM employees WHERE email = ?")
      .bind(crypto.randomUUID(), "نسخة اعتماد نهائي", `${workflowLabels[row.kind]}: ${row.title}`, now, HEAD_OF_ACCOUNTS_EMAIL));
  }
  await ctx.db.batch(statements);
  return NextResponse.json({ ok: true, status, currentStage: toStage });
}
