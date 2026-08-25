import { NextResponse } from "next/server";
import { getRosterEmployee } from "../../../employee-roster";
import { getPortalSession } from "../../../portal-auth";

export async function GET(_request:Request,context:{params:Promise<{id:string}>}){
  const session=await getPortalSession();if(!session)return NextResponse.json({error:"unauthorized"},{status:401});
  const{env}=await import("cloudflare:workers"),actor=await getRosterEmployee(env.DB,session.email);if(!actor)return NextResponse.json({error:"not_allowed"},{status:403});
  const{id}=await context.params,row=await env.DB.prepare(`SELECT f.*,e.email AS owner_email,e.department AS owner_department,e.manager_name AS owner_manager
    FROM request_files f JOIN requests r ON r.id=f.request_id JOIN employees e ON e.id=r.employee_id WHERE f.id=? LIMIT 1`).bind(id).first<Record<string,unknown>>();
  if(!row)return NextResponse.json({error:"not_found"},{status:404});
  const allowed=String(row.owner_email)===actor.email||actor.role==="admin"||actor.role==="executive"||(actor.role==="department_head"&&actor.department===row.owner_department)||(actor.role==="supervisor"&&actor.name===row.owner_manager);
  if(!allowed)return NextResponse.json({error:"not_allowed"},{status:403});const object=await env.BUCKET.get(String(row.storage_key));if(!object)return NextResponse.json({error:"not_found"},{status:404});return new NextResponse(object.body,{headers:{"content-type":String(row.content_type||"application/octet-stream"),"content-disposition":`attachment; filename*=UTF-8''${encodeURIComponent(String(row.name))}`,"cache-control":"private, no-store"}})
}
