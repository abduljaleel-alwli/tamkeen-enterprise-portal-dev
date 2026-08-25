import { NextResponse } from "next/server";
import { getPortalSession } from "../../portal-auth";
import { employeeRoster, getRosterEmployee, type RosterEmployee } from "../../employee-roster";
import { authorityFor, HEAD_OF_ACCOUNTS_EMAIL } from "../../workflow-policy";
import { salesDirectory } from "../../sales-directory";

type D1 = D1Database;

async function context() {
  const session = await getPortalSession();
  if (!session) return null;
  const { env } = await import("cloudflare:workers");
  const actor = await getRosterEmployee(env.DB,session.email);
  if (!actor) return null;
  return { session, actor, db: env.DB, bucket: env.BUCKET };
}

async function salesScope(db:D1,actor: RosterEmployee) {
  const authority = authorityFor(actor);
  const allSales = actor.role === "admin" || authority.isExecutiveManagement || authority.isGeneralManager || authority.isHeadOfSales || authority.isHeadOfAccounts;
  const rows=await db.prepare(`SELECT e.employee_no,e.email,e.name,e.job_title,e.department,e.manager_name,e.role,p.organization,p.association_name,p.sales_supervisor
    FROM employees e LEFT JOIN employee_profiles p ON p.employee_email=e.email WHERE e.status='active' AND e.department='المبيعات' AND e.role='employee' ORDER BY e.name`).all<Record<string,unknown>>();
  const specialists=(rows.results??[]).map(row=>({employeeNo:String(row.employee_no),email:String(row.email),name:String(row.name),jobTitle:String(row.job_title),department:String(row.department),managerName:String(row.manager_name||""),role:"employee",organization:row.organization==="مؤسسة معين"?"مؤسسة معين":"بيت التمكين",associationName:String(row.association_name||"")||undefined,salesSupervisor:String(row.sales_supervisor||"")||undefined} as RosterEmployee));
  if (allSales) return specialists;
  if (authority.isSalesSupervisor) return specialists.filter((employee) => employee.managerName === actor.name);
  if (authority.isSalesSpecialist) return specialists.filter((employee) => employee.email === actor.email);
  return [];
}

function placeholders(count: number) { return Array.from({ length: count }, () => "?").join(","); }
function asNumber(value: unknown) { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : 0; }
function canConfigure(actor: RosterEmployee) {
  const authority = authorityFor(actor);
  return actor.role === "admin" || authority.isGeneralManager || authority.isExecutiveManagement || authority.isHeadOfSales || authority.isSalesSupervisor;
}

async function notify(db: D1, emails: string[], title: string, body: string, now: string) {
  if (!emails.length) return;
  await db.batch(emails.map((email) => db.prepare("INSERT INTO notifications (id,employee_id,title,body,created_at) SELECT ?,id,?,?,? FROM employees WHERE email=?")
    .bind(crypto.randomUUID(), title, body, now, email)));
}

export async function GET(request: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const scope = await salesScope(ctx.db,ctx.actor);
  const authority = authorityFor(ctx.actor);
  if (!scope.length && !authority.isHeadOfAccounts) return NextResponse.json({ error: "not_allowed" }, { status: 403 });
  const year = Math.min(2100, Math.max(2024, Number(new URL(request.url).searchParams.get("year")) || new Date().getFullYear()));
  const emails = scope.map((employee) => employee.email);
  const scopeSql = emails.length ? placeholders(emails.length) : "''";
  const [associations, assignments, targets, revenues, cases, dynamicDirectory] = await Promise.all([
    ctx.db.prepare("SELECT * FROM associations WHERE status='active' ORDER BY name").all(),
    ctx.db.prepare(`SELECT a.*,s.name AS association_name FROM sales_assignments a JOIN associations s ON s.id=a.association_id WHERE a.year=? AND a.employee_email IN (${scopeSql}) ORDER BY a.employee_email`).bind(year, ...emails).all(),
    ctx.db.prepare(`SELECT * FROM sales_targets WHERE year=? AND employee_email IN (${scopeSql}) ORDER BY month`).bind(year, ...emails).all(),
    ctx.db.prepare(`SELECT * FROM sales_revenue_entries WHERE substr(entry_date,1,4)=? AND employee_email IN (${scopeSql}) ORDER BY entry_date DESC`).bind(String(year), ...emails).all(),
    ctx.db.prepare("SELECT c.*,a.name AS association_name FROM sales_cases c LEFT JOIN associations a ON a.id=c.association_id ORDER BY c.created_at DESC LIMIT 200").all(),
    ctx.db.prepare(`SELECT e.name,e.email,e.job_title,p.association_name,p.sales_supervisor,p.organization
      FROM employees e JOIN employee_profiles p ON p.employee_email=e.email WHERE e.status='active' AND e.department='المبيعات' ORDER BY e.name`).all<Record<string,unknown>>(),
  ]);
  const visibleCases = (cases.results ?? []).filter((item: Record<string, unknown>) => {
    if (String(item.requester_email) === ctx.actor.email) return true;
    if (emails.includes(String(item.requester_email))) return true;
    if (authority.isHeadOfAccounts) return ["financial_report", "association_claim"].includes(String(item.kind));
    return actorCanAct(ctx.actor, String(item.current_stage));
  });
  const fileRows = visibleCases.length ? await ctx.db.prepare(`SELECT id,case_id,name,content_type,size,created_at FROM sales_case_files WHERE case_id IN (${placeholders(visibleCases.length)}) ORDER BY created_at`).bind(...visibleCases.map((item: Record<string, unknown>) => item.id)).all() : { results: [] };
  return NextResponse.json({
    year,
    actor: { email: ctx.actor.email, name: ctx.actor.name, jobTitle: ctx.actor.jobTitle },
    employees: scope.map((employee) => ({ email: employee.email, name: employee.name, jobTitle: employee.jobTitle, managerName: employee.managerName })),
    directory: mergeDirectory(dynamicDirectory.results??[]),
    associations: associations.results ?? [], assignments: assignments.results ?? [], targets: targets.results ?? [], revenues: revenues.results ?? [],
    cases: visibleCases, files: fileRows.results ?? [],
    permissions: { isSpecialist: authority.isSalesSpecialist, isSupervisor: authority.isSalesSupervisor, isHeadOfSales: authority.isHeadOfSales, isHeadOfAccounts: authority.isHeadOfAccounts, canConfigure: canConfigure(ctx.actor), canViewTeam: scope.length > 1 },
  });
}

export async function POST(request: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const contentType = request.headers.get("content-type") || "";
  const multipart = contentType.includes("multipart/form-data");
  const form = multipart ? await request.formData() : null;
  const body = form ? Object.fromEntries(form.entries()) : await request.json() as Record<string, unknown>;
  const action = String(body.action || "");
  const authority = authorityFor(ctx.actor);
  const scope = await salesScope(ctx.db,ctx.actor);
  const scopedEmails = new Set(scope.map((employee) => employee.email));
  const now = new Date().toISOString();

  if (action === "association") {
    if (!canConfigure(ctx.actor)) return NextResponse.json({ error: "not_allowed" }, { status: 403 });
    const name = String(body.name || "").trim();
    if (!name) return NextResponse.json({ error: "missing_name" }, { status: 400 });
    const id = `assoc-${crypto.randomUUID().slice(0, 8)}`;
    await ctx.db.prepare("INSERT INTO associations (id,name,branch,status,created_at) VALUES (?,?,?,?,?)").bind(id, name, String(body.branch || "المقر الرئيسي"), "active", now).run();
    return NextResponse.json({ ok: true, id }, { status: 201 });
  }

  if (action === "assignment") {
    if (!canConfigure(ctx.actor)) return NextResponse.json({ error: "not_allowed" }, { status: 403 });
    const email = String(body.employeeEmail || "").toLowerCase(), associationId = String(body.associationId || ""), year = Number(body.year) || new Date().getFullYear();
    if (!scopedEmails.has(email) && !authority.isHeadOfSales && ctx.actor.role !== "admin" && !authority.isExecutiveManagement && !authority.isGeneralManager) return NextResponse.json({ error: "out_of_scope" }, { status: 403 });
    await ctx.db.prepare(`INSERT INTO sales_assignments (id,employee_email,association_id,year,status,created_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(employee_email,year) DO UPDATE SET association_id=excluded.association_id,status='active'`)
      .bind(crypto.randomUUID(), email, associationId, year, "active", now).run();
    return NextResponse.json({ ok: true });
  }

  if (action === "target") {
    if (!canConfigure(ctx.actor)) return NextResponse.json({ error: "not_allowed" }, { status: 403 });
    const email = String(body.employeeEmail || "").toLowerCase(), associationId = String(body.associationId || "") || null;
    const year = Number(body.year) || new Date().getFullYear(), month = Number(body.month), target = asNumber(body.targetAmount);
    if (!scopedEmails.has(email) && !authority.isHeadOfSales && ctx.actor.role !== "admin" && !authority.isExecutiveManagement && !authority.isGeneralManager) return NextResponse.json({ error: "out_of_scope" }, { status: 403 });
    if (month < 1 || month > 12) return NextResponse.json({ error: "invalid_month" }, { status: 400 });
    await ctx.db.prepare(`INSERT INTO sales_targets (id,employee_email,association_id,year,month,target_amount,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(employee_email,year,month) DO UPDATE SET target_amount=excluded.target_amount,association_id=excluded.association_id,created_by=excluded.created_by,updated_at=excluded.updated_at`)
      .bind(crypto.randomUUID(), email, associationId, year, month, target, ctx.actor.email, now, now).run();
    return NextResponse.json({ ok: true });
  }

  if (action === "revenue") {
    const email = String(body.employeeEmail || ctx.actor.email).toLowerCase();
    if (!scopedEmails.has(email)) return NextResponse.json({ error: "out_of_scope" }, { status: 403 });
    const date = String(body.entryDate || ""), amount = asNumber(body.amount);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || amount <= 0) return NextResponse.json({ error: "invalid_entry" }, { status: 400 });
    const id = `REV-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    await ctx.db.batch([
      ctx.db.prepare("INSERT INTO sales_revenue_entries (id,employee_email,association_id,entry_date,amount,donor_count,receipt_ref,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .bind(id, email, String(body.associationId || "") || null, date, amount, Math.floor(asNumber(body.donorCount)), String(body.receiptRef || "") || null, String(body.notes || "") || null, now, now),
      ctx.db.prepare("INSERT INTO audit_logs (id,actor_email,action,entity_type,entity_id,payload,created_at) VALUES (?,?,?,?,?,?,?)")
        .bind(crypto.randomUUID(), ctx.actor.email, "create", "sales_revenue", id, JSON.stringify({ email, date, amount }), now),
    ]);
    return NextResponse.json({ ok: true, id }, { status: 201 });
  }

  if (action === "case") {
    const kind = String(body.kind || "sales_request"), requestType = String(body.requestType || "طلب دعم من المشرف"), title = String(body.title || "").trim();
    if (!title || !["sales_request", "financial_report", "association_claim"].includes(kind)) return NextResponse.json({ error: "invalid_case" }, { status: 400 });
    if (kind === "association_claim" && !(authority.isSalesSupervisor || authority.isHeadOfSales)) return NextResponse.json({ error: "not_allowed" }, { status: 403 });
    if (kind !== "association_claim" && !(authority.isSalesSpecialist || authority.isSalesSupervisor || authority.isHeadOfSales)) return NextResponse.json({ error: "not_allowed" }, { status: 403 });
    const stage = kind === "association_claim" ? "head_accounts" : kind === "financial_report" ? "sales_supervisor" : "sales_supervisor";
    const id = `SAL-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const statements = [ctx.db.prepare("INSERT INTO sales_cases (id,kind,requester_email,association_id,request_type,title,details,amount,period,current_stage,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id, kind, ctx.actor.email, String(body.associationId || "") || null, requestType, title, String(body.details || "") || null, asNumber(body.amount) || null, String(body.period || "") || null, stage, "pending", now, now),
      ctx.db.prepare("INSERT INTO audit_logs (id,actor_email,action,entity_type,entity_id,payload,created_at) VALUES (?,?,?,?,?,?,?)")
        .bind(crypto.randomUUID(), ctx.actor.email, "submit", "sales_case", id, JSON.stringify({ kind, stage }), now)];
    const file = form?.get("file");
    if (file instanceof File && file.size > 0) {
      if (file.size > 15 * 1024 * 1024) return NextResponse.json({ error: "file_too_large" }, { status: 400 });
      const allowed = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "image/jpeg", "image/png"];
      if (file.type && !allowed.includes(file.type)) return NextResponse.json({ error: "file_type_not_allowed" }, { status: 400 });
      const fileId = crypto.randomUUID(), key = `sales/${id}/${fileId}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      await ctx.bucket.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type || "application/octet-stream" } });
      statements.push(ctx.db.prepare("INSERT INTO sales_case_files (id,case_id,uploader_email,name,storage_key,content_type,size,created_at) VALUES (?,?,?,?,?,?,?,?)")
        .bind(fileId, id, ctx.actor.email, file.name, key, file.type || null, file.size, now));
    }
    await ctx.db.batch(statements);
    const supervisors = employeeRoster.filter((employee) => employee.role === "supervisor" && employee.department === "المبيعات").map((employee) => employee.email);
    const recipients = stage === "head_accounts" ? [HEAD_OF_ACCOUNTS_EMAIL] : supervisors;
    if (kind === "financial_report") recipients.push(HEAD_OF_ACCOUNTS_EMAIL);
    await notify(ctx.db, [...new Set(recipients)], kind === "financial_report" ? "تقرير مالي جديد" : kind === "association_claim" ? "مطالبة جمعية جديدة" : "طلب مختص مبيعات", `${ctx.actor.name}: ${title}`, now);
    return NextResponse.json({ ok: true, id }, { status: 201 });
  }
  return NextResponse.json({ error: "unknown_action" }, { status: 400 });
}

function mergeDirectory(dynamicRows:Record<string,unknown>[]){
  const merged=[...salesDirectory];
  for(const row of dynamicRows){const email=String(row.email||"").toLowerCase(),name=String(row.name),existing=merged.find(item=>item.email?.toLowerCase()===email||item.name===name);const entry={name,email,jobTitle:String(row.job_title),association:String(row.association_name||"غير محددة"),supervisor:(String(row.sales_supervisor||"صالح بن سعد")==="محمد الراشدي"?"محمد الراشدي":"صالح بن سعد") as "محمد الراشدي"|"صالح بن سعد",organization:(row.organization==="مؤسسة معين"?"مؤسسة معين":"بيت التمكين") as "بيت التمكين"|"مؤسسة معين"};if(existing)Object.assign(existing,entry);else merged.push(entry)}
  return merged;
}

function actorCanAct(actor: RosterEmployee, stage: string) {
  const authority = authorityFor(actor);
  if (stage === "sales_supervisor") return authority.isSalesSupervisor;
  if (stage === "sales_head") return authority.isHeadOfSales;
  if (stage === "head_accounts") return authority.isHeadOfAccounts;
  return actor.role === "admin" || authority.isExecutiveManagement || authority.isGeneralManager;
}

export async function PATCH(request: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json() as { id?: string; action?: "approve" | "return"; note?: string };
  const row = await ctx.db.prepare("SELECT * FROM sales_cases WHERE id=? LIMIT 1").bind(body.id || "").first<Record<string, unknown>>();
  if (!row || row.status !== "pending" || !actorCanAct(ctx.actor, String(row.current_stage))) return NextResponse.json({ error: "not_allowed" }, { status: 403 });
  if (!body.action || !["approve", "return"].includes(body.action)) return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  if (body.action === "return" && !String(body.note || "").trim()) return NextResponse.json({ error: "note_required" }, { status: 400 });
  let status = body.action === "return" ? "returned" : "approved", stage = body.action === "return" ? "requester_revision" : "completed";
  if (body.action === "approve" && row.kind === "financial_report" && row.current_stage === "sales_supervisor") { status = "pending"; stage = "head_accounts"; }
  const now = new Date().toISOString();
  await ctx.db.batch([
    ctx.db.prepare("UPDATE sales_cases SET status=?,current_stage=?,decision_note=?,updated_at=? WHERE id=?").bind(status, stage, String(body.note || "") || null, now, row.id),
    ctx.db.prepare("INSERT INTO audit_logs (id,actor_email,action,entity_type,entity_id,payload,created_at) VALUES (?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), ctx.actor.email, body.action, "sales_case", row.id, JSON.stringify({ stage, note: body.note || null }), now),
  ]);
  await notify(ctx.db, [String(row.requester_email)], body.action === "return" ? "أعيدت معاملتك للتعديل" : status === "approved" ? "اكتملت معاملتك" : "انتقل تقريرك إلى الحسابات", `${row.title}${body.note ? ` — ${body.note}` : ""}`, now);
  if (stage === "head_accounts") await notify(ctx.db, [HEAD_OF_ACCOUNTS_EMAIL], "تقرير مالي بانتظار المراجعة", String(row.title), now);
  return NextResponse.json({ ok: true, status, currentStage: stage });
}
