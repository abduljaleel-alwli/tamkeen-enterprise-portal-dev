import { NextResponse } from "next/server";
import { getPortalSession } from "../../portal-auth";
import { getAuthorizedEmployee } from "../../employee-roster";

export async function GET(request: Request) {
  const user=await getPortalSession();
  if(!user)return NextResponse.json({error:"unauthorized"},{status:401});
  try{
    const { env }=await import("cloudflare:workers");
    const access=await getAuthorizedEmployee(env.DB,user.email),employee=access?.employee;
    if(!employee)return NextResponse.json({error:"employee_not_authorized"},{status:403});
    const url=new URL(request.url),id=url.searchParams.get("id");
    if(!id)return NextResponse.json({error:"missing_id"},{status:400});
    const document=await env.DB.prepare("SELECT id,employee_id,name,storage_key,content_type FROM documents WHERE id=?").bind(id).first<{id:string;employee_id:string;name:string;storage_key:string;content_type:string|null}>();
    if(!document)return NextResponse.json({error:"not_found"},{status:404});
    const canRead=document.employee_id===String(employee.id)||Boolean(access?.permissions.canAccessAdmin);
    if(!canRead)return NextResponse.json({error:"forbidden"},{status:403});
    const object=await env.BUCKET.get(document.storage_key);
    if(!object)return NextResponse.json({error:"file_not_found"},{status:404});
    const download=url.searchParams.get("download")==="1";
    return new Response(object.body,{headers:{"content-type":document.content_type||"application/octet-stream","content-disposition":`${download?"attachment":"inline"}; filename*=UTF-8''${encodeURIComponent(document.name)}`,"cache-control":"private, no-store"}});
  }catch(error){return NextResponse.json({error:"download_failed",detail:String(error)},{status:503})}
}

export async function POST(request: Request) {
  const user=await getPortalSession();
  if(!user)return NextResponse.json({error:"unauthorized"},{status:401});
  try{
    const { env }=await import("cloudflare:workers");
    const form=await request.formData(),file=form.get("file"),category=String(form.get("category")||"other");
    if(!(file instanceof File)||file.size===0)return NextResponse.json({error:"missing_file"},{status:400});
    if(file.size>10*1024*1024)return NextResponse.json({error:"file_too_large"},{status:400});
    const allowed=new Set(["application/pdf","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","image/jpeg","image/png"]);
    if(file.type&&!allowed.has(file.type))return NextResponse.json({error:"unsupported_file_type"},{status:400});
    const access=await getAuthorizedEmployee(env.DB,user.email);
    const employee=access?.employee;
    if(!employee||!access.permissions.canUploadDocuments)return NextResponse.json({error:"employee_not_authorized"},{status:403});
    const id=crypto.randomUUID(),key=`employees/${String(employee.id)}/${id}-${file.name.replace(/[^a-zA-Z0-9._-]/g,"_")}`,now=new Date().toISOString();
    await env.BUCKET.put(key,await file.arrayBuffer(),{httpMetadata:{contentType:file.type||"application/octet-stream"}});
    await env.DB.batch([
      env.DB.prepare("INSERT INTO documents (id,employee_id,name,storage_key,content_type,size,category,uploaded_at) VALUES (?,?,?,?,?,?,?,?)").bind(id,String(employee.id),file.name,key,file.type||null,file.size,category,now),
      env.DB.prepare("INSERT INTO audit_logs (id,actor_email,action,entity_type,entity_id,payload,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),user.email,"upload","document",id,JSON.stringify({name:file.name,size:file.size}),now),
    ]);
    return NextResponse.json({ok:true,id,name:file.name,size:file.size,category,uploadedAt:now},{status:201});
  }catch(error){return NextResponse.json({error:"upload_failed",detail:String(error)},{status:503})}
}
