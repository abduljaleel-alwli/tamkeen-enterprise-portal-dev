import { NextResponse } from "next/server";
import { getPortalSession } from "../../portal-auth";
import { employeeRoster, getAuthorizedEmployee, getManagementSnapshot } from "../../employee-roster";
import { authorityFor } from "../../workflow-policy";
import { jobGuideFor } from "../../job-guides";

type D1Result<T> = { results?: T[] };

export async function GET() {
  const user = await getPortalSession();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { env } = await import("cloudflare:workers");
    const access = await getAuthorizedEmployee(env.DB, user.email);
    if (!access?.employee) return NextResponse.json({ error: "employee_not_authorized" }, { status: 403 });

    const employeeId = String(access.employee.id);
    const [requestRows, taskRows, documentRows, notificationRows, management] = await Promise.all([
      env.DB.prepare(`SELECT r.*,(SELECT COUNT(*) FROM request_files f WHERE f.request_id=r.id) AS file_count,
        (SELECT recipient_scope FROM request_routing rr WHERE rr.request_id=r.id) AS recipient_scope
        FROM requests r WHERE r.employee_id = ? ORDER BY r.created_at DESC`).bind(employeeId).all() as Promise<D1Result<Record<string, unknown>>>,
      env.DB.prepare("SELECT * FROM tasks WHERE employee_id = ? ORDER BY due_date ASC").bind(employeeId).all() as Promise<D1Result<Record<string, unknown>>>,
      env.DB.prepare("SELECT id,name,content_type,size,category,uploaded_at FROM documents WHERE employee_id = ? ORDER BY uploaded_at DESC").bind(employeeId).all() as Promise<D1Result<Record<string, unknown>>>,
      env.DB.prepare("SELECT * FROM notifications WHERE employee_id = ? ORDER BY created_at DESC LIMIT 20").bind(employeeId).all() as Promise<D1Result<Record<string, unknown>>>,
      access.permissions.canManageTeam ? getManagementSnapshot(env.DB, access.rosterEmployee) : Promise.resolve({ team: [], pendingRequests: [] }),
    ]);

    return NextResponse.json({
      employee: access.employee,
      requests: requestRows.results ?? [],
      tasks: taskRows.results ?? [],
      documents: documentRows.results ?? [],
      notifications: notificationRows.results ?? [],
      permissions: {
        ...access.permissions,
        canAccessSales: access.rosterEmployee.department === "المبيعات" || access.rosterEmployee.role === "admin" || access.rosterEmployee.role === "executive" || authorityFor(access.rosterEmployee).isGeneralManager || authorityFor(access.rosterEmployee).isHeadOfAccounts,
      },
      team: management.team,
      teamRequests: management.pendingRequests,
      jobGuide: jobGuideFor(access.rosterEmployee),
    });
  } catch (error) {
    return NextResponse.json({ error: "database_unavailable", detail: String(error) }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const user = await getPortalSession();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { env } = await import("cloudflare:workers");
    const access = await getAuthorizedEmployee(env.DB, user.email);
    if (!access?.employee || !access.permissions.canSubmitRequests) {
      return NextResponse.json({ error: "employee_not_authorized" }, { status: 403 });
    }

    const contentType = request.headers.get("content-type") || "";
    const form = contentType.includes("multipart/form-data") ? await request.formData() : null;
    const body = form ? Object.fromEntries(form.entries()) : await request.json() as Record<string, string | File>;
    const selectedType = String(body.type || "").trim();
    const type = selectedType === "أخرى" ? String(body.customType || "").trim() : selectedType;
    const title = String(body.title || "").trim();
    const recipientScope = String(body.recipientScope || "manager");
    if (!type || !title || !["manager","hr","executive","general_manager"].includes(recipientScope)) return NextResponse.json({ error: "missing_fields" }, { status: 400 });

    const now = new Date().toISOString();
    const id = `REQ-${new Date().getFullYear().toString().slice(-2)}${String(new Date().getMonth() + 1).padStart(2, "0")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    const manager = employeeRoster.find((employee) => employee.name === access.rosterEmployee.managerName);
    const route = recipientScope === "hr"
      ? { status: "pending_hr", step: "الموارد البشرية", recipients: employeeRoster.filter((employee)=>employee.department === "الموارد البشرية" || employee.role === "admin") }
      : recipientScope === "executive"
        ? { status: "pending_executive", step: "الإدارة التنفيذية", recipients: employeeRoster.filter((employee)=>employee.department === "الإدارة التنفيذية" || employee.role === "admin") }
        : recipientScope === "general_manager"
          ? { status: "pending_general_manager", step: "المدير العام", recipients: employeeRoster.filter((employee)=>employee.jobTitle === "المدير العام") }
          : { status: "pending_manager", step: access.rosterEmployee.managerName || "المدير المباشر", recipients: manager ? [manager] : [] };
    const statements = [
      env.DB.prepare("INSERT INTO requests (id,employee_id,type,title,details,value,priority,status,current_step,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
        .bind(id, String(access.employee.id), type, title, String(body.details || "") || null, String(body.value || "") || null, String(body.priority || "normal"), route.status, route.step, now, now),
      env.DB.prepare("INSERT INTO request_routing (request_id,recipient_scope,recipient_email,created_at) VALUES (?,?,?,?)")
        .bind(id, recipientScope, route.recipients[0]?.email || null, now),
      env.DB.prepare("INSERT INTO audit_logs (id,actor_email,action,entity_type,entity_id,payload,created_at) VALUES (?,?,?,?,?,?,?)")
        .bind(crypto.randomUUID(), user.email.toLowerCase(), "create", "request", id, JSON.stringify({ type, title, recipientScope }), now),
    ];
    const file = form?.get("file");
    if (file instanceof File && file.size > 0) {
      if (file.size > 15 * 1024 * 1024) return NextResponse.json({ error: "file_too_large" }, { status: 400 });
      const allowed = ["application/pdf","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","image/jpeg","image/png"];
      if (file.type && !allowed.includes(file.type)) return NextResponse.json({ error: "file_type_not_allowed" }, { status: 400 });
      const fileId=crypto.randomUUID(), key=`requests/${id}/${fileId}-${file.name.replace(/[^a-zA-Z0-9._-]/g,"_")}`;
      await env.BUCKET.put(key,await file.arrayBuffer(),{httpMetadata:{contentType:file.type||"application/octet-stream"}});
      statements.push(env.DB.prepare("INSERT INTO request_files (id,request_id,uploader_email,name,storage_key,content_type,size,created_at) VALUES (?,?,?,?,?,?,?,?)")
        .bind(fileId,id,user.email.toLowerCase(),file.name,key,file.type||null,file.size,now));
    }
    for (const recipient of [...new Map(route.recipients.map((item)=>[item.email,item])).values()]) statements.push(env.DB.prepare("INSERT INTO notifications (id,employee_id,title,body,created_at) SELECT ?,id,?,?,? FROM employees WHERE email = ?")
      .bind(crypto.randomUUID(), "طلب جديد بانتظارك", `${access.rosterEmployee.name}: ${title}`, now, recipient.email));
    await env.DB.batch(statements);

    return NextResponse.json({ ok: true, id, createdAt: now }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "database_unavailable", detail: String(error) }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const user = await getPortalSession();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const { env } = await import("cloudflare:workers");
    const access = await getAuthorizedEmployee(env.DB, user.email);
    if (!access?.employee || !access.permissions.canApproveRequests) return NextResponse.json({ error: "not_allowed" }, { status: 403 });
    const body = await request.json() as { id?: string; action?: "approve" | "return"; note?: string };
    if (!body.id || !body.action || !["approve", "return"].includes(body.action)) return NextResponse.json({ error: "invalid_action" }, { status: 400 });
    const row = await env.DB.prepare(`SELECT r.*,e.email AS employee_email,e.name AS employee_name,e.department AS employee_department,e.manager_name AS employee_manager
      FROM requests r JOIN employees e ON e.id=r.employee_id WHERE r.id=? LIMIT 1`).bind(body.id).first<Record<string, unknown>>();
    if (!row || !String(row.status).startsWith("pending")) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const actor = access.rosterEmployee;
    const permitted = actor.role === "admin" || actor.role === "executive" ||
      (actor.role === "supervisor" && row.status === "pending_manager" && row.employee_manager === actor.name) ||
      (actor.role === "department_head" && row.employee_department === actor.department);
    if (!permitted) return NextResponse.json({ error: "not_allowed" }, { status: 403 });
    const now = new Date().toISOString();
    let status = "returned", currentStep = "مقدم الطلب";
    if (body.action === "approve") {
      if (actor.role === "supervisor") { status = "pending_department_head"; currentStep = "رئيس القسم"; }
      else if (actor.role === "department_head") {
        const hrTypes = ["طلب إجازة", "طلب استئذان", "طلب تعريف وظيفي", "تعديل بيانات"];
        status = hrTypes.includes(String(row.type)) ? "pending_hr" : "pending_executive";
        currentStep = hrTypes.includes(String(row.type)) ? "الموارد البشرية" : "الإدارة التنفيذية";
      } else { status = "approved"; currentStep = "مكتمل"; }
    }
    const statements = [
      env.DB.prepare("UPDATE requests SET status=?,current_step=?,updated_at=? WHERE id=?").bind(status, currentStep, now, body.id),
      env.DB.prepare("INSERT INTO audit_logs (id,actor_email,action,entity_type,entity_id,payload,created_at) VALUES (?,?,?,?,?,?,?)")
        .bind(crypto.randomUUID(), actor.email, body.action, "request", body.id, JSON.stringify({ note: body.note || null, status, currentStep }), now),
      env.DB.prepare("INSERT INTO notifications (id,employee_id,title,body,created_at) SELECT ?,id,?,?,? FROM employees WHERE email=?")
        .bind(crypto.randomUUID(), body.action === "return" ? "أعيد طلبك للتعديل" : status === "approved" ? "تم اعتماد طلبك" : "انتقل طلبك للمرحلة التالية", `${row.title} — ${currentStep}${body.note ? ` — ${body.note}` : ""}`, now, row.employee_email),
    ];
    const nextRecipients = status === "pending_department_head"
      ? employeeRoster.filter((e) => e.role === "department_head" && e.department === row.employee_department)
      : status === "pending_hr"
        ? employeeRoster.filter((e) => e.role === "admin")
        : status === "pending_executive"
          ? employeeRoster.filter((e) => e.role === "executive" || e.role === "admin")
          : [];
    for (const recipient of nextRecipients) statements.push(env.DB.prepare("INSERT INTO notifications (id,employee_id,title,body,created_at) SELECT ?,id,?,?,? FROM employees WHERE email=?")
      .bind(crypto.randomUUID(), "طلب بانتظار إجراءك", `${row.employee_name}: ${row.title}`, now, recipient.email));
    await env.DB.batch(statements);
    return NextResponse.json({ ok: true, status, currentStep });
  } catch (error) {
    return NextResponse.json({ error: "database_unavailable", detail: String(error) }, { status: 503 });
  }
}
