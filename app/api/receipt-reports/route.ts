import { NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { getPortalSession } from "../../portal-auth";
import { findRosterEmployee, getRosterEmployee, type RosterEmployee } from "../../employee-roster";
import { authorityFor, HEAD_OF_ACCOUNTS_EMAIL } from "../../workflow-policy";

async function context() {
  const session = await getPortalSession();
  const { env } = await import("cloudflare:workers");
  const actor=session?await getRosterEmployee(env.DB,session.email):null;
  if (!session || !actor) return null;
  return { actor, db: env.DB, bucket: env.BUCKET };
}

function maySee(actor: RosterEmployee, requesterEmail: string) {
  const authority = authorityFor(actor), requester = findRosterEmployee(requesterEmail);
  if (actor.email === requesterEmail || actor.role === "admin" || authority.isExecutiveManagement || authority.isGeneralManager || authority.isHeadOfAccounts || authority.isHeadOfSales) return true;
  return authority.isSalesSupervisor && requester?.managerName === actor.name;
}

export async function GET(request: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(request.url), downloadId = url.searchParams.get("download");
  if (downloadId) {
    const report = await ctx.db.prepare("SELECT * FROM external_receipt_reports WHERE id=?").bind(downloadId).first<Record<string, unknown>>();
    if (!report || !maySee(ctx.actor, String(report.requester_email))) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const object = await ctx.bucket.get(String(report.pdf_storage_key));
    if (!object) return NextResponse.json({ error: "file_not_found" }, { status: 404 });
    return new Response(object.body, { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${downloadId}.pdf"`, "cache-control": "private, no-store" } });
  }
  const rows = await ctx.db.prepare("SELECT r.*,a.name AS association_name,e.name AS requester_name FROM external_receipt_reports r LEFT JOIN associations a ON a.id=r.association_id LEFT JOIN employees e ON e.email=r.requester_email ORDER BY r.created_at DESC LIMIT 100").all<Record<string, unknown>>();
  return NextResponse.json({ reports: (rows.results ?? []).filter(row => maySee(ctx.actor, String(row.requester_email))), canCreate: authorityFor(ctx.actor).isSalesSpecialist });
}

export async function POST(request: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!authorityFor(ctx.actor).isSalesSpecialist) return NextResponse.json({ error: "not_allowed" }, { status: 403 });
  const form = await request.formData(), files = form.getAll("files").filter((item): item is File => item instanceof File && item.size > 0);
  const period = String(form.get("period") || "").trim(), associationId = String(form.get("associationId") || "") || null;
  if (!period || !files.length || files.length > 30) return NextResponse.json({ error: "invalid_report" }, { status: 400 });
  if (files.some(file => file.size > 12 * 1024 * 1024)) return NextResponse.json({ error: "file_too_large" }, { status: 400 });
  const allowed = new Set(["application/pdf", "image/jpeg", "image/png"]);
  if (files.some(file => file.type && !allowed.has(file.type))) return NextResponse.json({ error: "unsupported_file_type" }, { status: 400 });
  const reportId = `RCP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, now = new Date().toISOString(), pdf = await PDFDocument.create();
  const statements = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer()), fileId = crypto.randomUUID(), safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const key = `external-receipts/${reportId}/${fileId}-${safeName}`;
    await ctx.bucket.put(key, bytes, { httpMetadata: { contentType: file.type || "application/octet-stream" } });
    statements.push(ctx.db.prepare("INSERT INTO external_receipts (id,report_id,name,storage_key,content_type,size,created_at) VALUES (?,?,?,?,?,?,?)")
      .bind(fileId, reportId, file.name, key, file.type || null, file.size, now));
    if (file.type === "application/pdf") {
      const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = await pdf.copyPages(source, source.getPageIndices());
      for (const page of pages) pdf.addPage(page);
    } else {
      const image = file.type === "image/png" ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
      const page = pdf.addPage([595.28, 841.89]), margin = 28, maxW = 595.28 - margin * 2, maxH = 841.89 - margin * 2;
      const scale = Math.min(maxW / image.width, maxH / image.height);
      page.drawImage(image, { x: (595.28 - image.width * scale) / 2, y: (841.89 - image.height * scale) / 2, width: image.width * scale, height: image.height * scale });
    }
  }
  if (!pdf.getPageCount()) return NextResponse.json({ error: "empty_pdf" }, { status: 400 });
  const merged = await pdf.save(), pdfKey = `external-receipts/${reportId}/${reportId}.pdf`, totalAmount = Math.max(0, Number(form.get("totalAmount")) || 0);
  await ctx.bucket.put(pdfKey, merged, { httpMetadata: { contentType: "application/pdf" } });
  statements.unshift(ctx.db.prepare("INSERT INTO external_receipt_reports (id,requester_email,association_id,period,total_amount,receipt_count,pdf_storage_key,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind(reportId, ctx.actor.email, associationId, period, totalAmount, files.length, pdfKey, "pending_accounts", now));
  statements.push(
    ctx.db.prepare("INSERT INTO notifications (id,employee_id,title,body,created_at) SELECT ?,id,?,?,? FROM employees WHERE email=?")
      .bind(crypto.randomUUID(), "تقرير إيصالات خارجية جديد", `${ctx.actor.name} — ${period} — ${files.length} إيصالات`, now, HEAD_OF_ACCOUNTS_EMAIL),
    ctx.db.prepare("INSERT INTO audit_logs (id,actor_email,action,entity_type,entity_id,payload,created_at) VALUES (?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), ctx.actor.email, "submit", "external_receipt_report", reportId, JSON.stringify({ period, receiptCount: files.length, totalAmount }), now),
  );
  await ctx.db.batch(statements);
  return NextResponse.json({ ok: true, id: reportId }, { status: 201 });
}
