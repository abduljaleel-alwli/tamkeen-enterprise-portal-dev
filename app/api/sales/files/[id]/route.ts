import { NextResponse } from "next/server";
import { getPortalSession } from "../../../../portal-auth";
import { getRosterEmployee } from "../../../../employee-roster";
import { authorityFor } from "../../../../workflow-policy";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getPortalSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { env } = await import("cloudflare:workers");
  const actor=await getRosterEmployee(env.DB,session.email);
  if (!actor) return NextResponse.json({ error: "not_allowed" }, { status: 403 });
  const { id } = await context.params;
  const file = await env.DB.prepare(`SELECT f.*,c.requester_email,c.current_stage,c.kind
    FROM sales_case_files f JOIN sales_cases c ON c.id=f.case_id WHERE f.id=? LIMIT 1`).bind(id).first<Record<string, unknown>>();
  if (!file) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const authority = authorityFor(actor);
  const allowed = file.requester_email === actor.email || actor.role === "admin" || authority.isExecutiveManagement || authority.isGeneralManager || authority.isHeadOfSales || authority.isSalesSupervisor || authority.isHeadOfAccounts;
  if (!allowed) return NextResponse.json({ error: "not_allowed" }, { status: 403 });
  const object = await env.BUCKET.get(String(file.storage_key));
  if (!object) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return new NextResponse(object.body, {
    headers: {
      "content-type": String(file.content_type || "application/octet-stream"),
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(String(file.name))}`,
      "cache-control": "private, no-store",
    },
  });
}
