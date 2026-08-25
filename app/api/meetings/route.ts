import { NextResponse } from "next/server";
import { getPortalSession } from "../../portal-auth";
import { employeeRoster, getRosterEmployee } from "../../employee-roster";

async function context() {
  const session = await getPortalSession();
  const { env } = await import("cloudflare:workers");
  const actor=session?await getRosterEmployee(env.DB,session.email):null;
  if (!session || !actor) return null;
  return { actor, db: env.DB };
}

const canManage = (role: string) => ["admin", "executive", "department_head", "supervisor"].includes(role);

export async function GET() {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const globalView = ctx.actor.role === "admin" || ctx.actor.role === "executive";
  const meetings = globalView
    ? await ctx.db.prepare("SELECT * FROM meetings ORDER BY meeting_date DESC,start_time DESC LIMIT 120").all()
    : await ctx.db.prepare("SELECT DISTINCT m.* FROM meetings m LEFT JOIN meeting_attendees a ON a.meeting_id=m.id WHERE m.audience='all' OR m.organizer_email=? OR a.employee_email=? ORDER BY m.meeting_date DESC,m.start_time DESC LIMIT 60").bind(ctx.actor.email,ctx.actor.email).all();
  const ids = (meetings.results ?? []).map((row: Record<string, unknown>) => String(row.id));
  const markers = ids.map(() => "?").join(",");
  const attendees = ids.length ? await ctx.db.prepare(`SELECT a.*,e.name,e.job_title FROM meeting_attendees a JOIN employees e ON e.email=a.employee_email WHERE a.meeting_id IN (${markers})`).bind(...ids).all() : { results: [] };
  const decisions = ids.length ? await ctx.db.prepare(`SELECT d.*,e.name AS owner_name FROM meeting_decisions d LEFT JOIN employees e ON e.email=d.owner_email WHERE d.meeting_id IN (${markers}) ORDER BY d.created_at`).bind(...ids).all() : { results: [] };
  return NextResponse.json({ meetings: meetings.results ?? [], attendees: attendees.results ?? [], decisions: decisions.results ?? [], employees: employeeRoster.map(e => ({ email: e.email, name: e.name, jobTitle: e.jobTitle })), canManage: canManage(ctx.actor.role) });
}

export async function POST(request: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canManage(ctx.actor.role)) return NextResponse.json({ error: "not_allowed" }, { status: 403 });
  const body = await request.json() as Record<string, unknown>;
  const title = String(body.title || "").trim(), date = String(body.meetingDate || ""), startTime = String(body.startTime || "");
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(startTime)) return NextResponse.json({ error: "invalid_meeting" }, { status: 400 });
  const attendeeEmails = Array.isArray(body.attendeeEmails) ? body.attendeeEmails.map(String).filter(email => employeeRoster.some(e => e.email === email)) : [];
  const id = `MTG-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, now = new Date().toISOString();
  const statements = [
    ctx.db.prepare("INSERT INTO meetings (id,title,agenda,meeting_date,start_time,end_time,location,organizer_email,audience,results_destination,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id, title, String(body.agenda || "") || null, date, startTime, String(body.endTime || "") || null, String(body.location || "") || null, ctx.actor.email, String(body.audience || "management"), String(body.resultsDestination || "") || null, "scheduled", now, now),
    ctx.db.prepare("INSERT INTO audit_logs (id,actor_email,action,entity_type,entity_id,payload,created_at) VALUES (?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), ctx.actor.email, "create", "meeting", id, JSON.stringify({ date, startTime }), now),
  ];
  for (const email of attendeeEmails) {
    statements.push(ctx.db.prepare("INSERT INTO meeting_attendees (id,meeting_id,employee_email,attendance_status) VALUES (?,?,?,?)").bind(crypto.randomUUID(), id, email, "invited"));
    statements.push(ctx.db.prepare("INSERT INTO notifications (id,employee_id,title,body,created_at) SELECT ?,id,?,?,? FROM employees WHERE email=?")
      .bind(crypto.randomUUID(), "دعوة اجتماع جديدة", `${title} — ${date} ${startTime}`, now, email));
  }
  await ctx.db.batch(statements);
  return NextResponse.json({ ok: true, id }, { status: 201 });
}

export async function PATCH(request: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canManage(ctx.actor.role)) return NextResponse.json({ error: "not_allowed" }, { status: 403 });
  const body = await request.json() as Record<string, unknown>, action = String(body.action || ""), now = new Date().toISOString();
  const meetingId = String(body.meetingId || "");
  const meeting = await ctx.db.prepare("SELECT * FROM meetings WHERE id=?").bind(meetingId).first<Record<string, unknown>>();
  if (!meeting) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const mayEdit = ctx.actor.role === "admin" || ctx.actor.role === "executive" || meeting.organizer_email === ctx.actor.email;
  if (!mayEdit) return NextResponse.json({ error: "not_allowed" }, { status: 403 });
  if (action === "minutes") {
    const minutes = String(body.minutes || "").trim(), destination = String(body.resultsDestination || "").trim();
    if (!minutes) return NextResponse.json({ error: "minutes_required" }, { status: 400 });
    await ctx.db.batch([
      ctx.db.prepare("UPDATE meetings SET minutes=?,results_destination=?,status='completed',updated_at=? WHERE id=?").bind(minutes, destination || null, now, meetingId),
      ctx.db.prepare("INSERT INTO audit_logs (id,actor_email,action,entity_type,entity_id,created_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(), ctx.actor.email, "record_minutes", "meeting", meetingId, now),
    ]);
  } else if (action === "decision") {
    const title = String(body.title || "").trim(), ownerEmail = String(body.ownerEmail || "");
    if (!title || !employeeRoster.some(e => e.email === ownerEmail)) return NextResponse.json({ error: "invalid_decision" }, { status: 400 });
    const id = `DEC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    await ctx.db.batch([
      ctx.db.prepare("INSERT INTO meeting_decisions (id,meeting_id,title,owner_email,due_date,status,notes,created_at) VALUES (?,?,?,?,?,?,?,?)")
        .bind(id, meetingId, title, ownerEmail, String(body.dueDate || "") || null, "open", String(body.notes || "") || null, now),
      ctx.db.prepare("INSERT INTO notifications (id,employee_id,title,body,created_at) SELECT ?,id,?,?,? FROM employees WHERE email=?")
        .bind(crypto.randomUUID(), "قرار اجتماع مسند إليك", title, now, ownerEmail),
    ]);
  } else if (action === "attendance") {
    const records = Array.isArray(body.records) ? body.records as Array<Record<string, unknown>> : [];
    if (!records.length) return NextResponse.json({ error: "records_required" }, { status: 400 });
    await ctx.db.batch(records.map(record => ctx.db.prepare("UPDATE meeting_attendees SET attendance_status=? WHERE meeting_id=? AND employee_email=?")
      .bind(String(record.status || "absent"), meetingId, String(record.email || ""))));
  } else if (action === "decision_status") {
    await ctx.db.prepare("UPDATE meeting_decisions SET status=? WHERE id=? AND meeting_id=?").bind(String(body.status || "open"), String(body.decisionId || ""), meetingId).run();
  } else return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
