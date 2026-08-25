import { NextResponse } from "next/server";
import { ensureRoster } from "../../../employee-roster";
import { createPortalAccess, getPortalSession } from "../../../portal-auth";

type NewEmployee = {
  name?: string; email?: string; jobTitle?: string; department?: string; managerName?: string;
  role?: string; organization?: string; associationName?: string; salesSupervisor?: string;
};

async function context() {
  const session=await getPortalSession();
  if(!session||session.role!=="admin")return null;
  const {env}=await import("cloudflare:workers");
  await ensureRoster(env.DB);
  return {session,db:env.DB};
}

export async function GET(){
  const ctx=await context();
  if(!ctx)return NextResponse.json({error:"not_allowed"},{status:403});
  const rows=await ctx.db.prepare(`SELECT e.id,e.email,e.employee_no,e.name,e.job_title,e.department,e.manager_name,e.role,e.status,e.performance_score,
    COALESCE(p.organization,'بيت التمكين') AS organization,p.association_name,p.sales_supervisor
    FROM employees e LEFT JOIN employee_profiles p ON p.employee_email=e.email
    WHERE e.status='active' ORDER BY organization,e.name`).all();
  return NextResponse.json({employees:rows.results??[]});
}

export async function POST(request:Request){
  const ctx=await context();
  if(!ctx)return NextResponse.json({error:"not_allowed"},{status:403});
  const body=await request.json() as NewEmployee;
  const name=String(body.name||"").trim(),email=String(body.email||"").trim().toLowerCase(),jobTitle=String(body.jobTitle||"").trim(),department=String(body.department||"").trim();
  const managerName=String(body.managerName||"").trim(),organization=body.organization==="مؤسسة معين"?"مؤسسة معين":"بيت التمكين";
  const role=["admin","executive","department_head","supervisor","employee"].includes(String(body.role))?String(body.role):"employee";
  if(!name||!/^\S+@\S+\.\S+$/.test(email)||!jobTitle||!department||!managerName)return NextResponse.json({error:"missing_fields"},{status:400});
  const exists=await ctx.db.prepare("SELECT 1 FROM employees WHERE email=? LIMIT 1").bind(email).first();
  if(exists)return NextResponse.json({error:"email_exists"},{status:409});
  const sequence=await ctx.db.prepare("SELECT MAX(CAST(substr(employee_no,4) AS INTEGER)) AS last_no FROM employees WHERE employee_no LIKE 'BT-%'").first<{last_no:number|null}>();
  const employeeNo=`BT-${String(Number(sequence?.last_no||0)+1).padStart(3,"0")}`,id=`employee-${crypto.randomUUID()}`,now=new Date().toISOString();
  const code=String(crypto.getRandomValues(new Uint32Array(1))[0]%1000000).padStart(6,"0");
  const associationName=String(body.associationName||"").trim()||null,salesSupervisor=String(body.salesSupervisor||"").trim()||null;
  await ctx.db.batch([
    ctx.db.prepare("INSERT INTO employees (id,email,employee_no,name,job_title,department,manager_name,branch,role,status,leave_balance,performance_score,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id,email,employeeNo,name,jobTitle,department,managerName,"المقر الرئيسي",role,"active",21,0,now),
    ctx.db.prepare("INSERT INTO employee_profiles (employee_email,organization,association_name,sales_supervisor,updated_at) VALUES (?,?,?,?,?)")
      .bind(email,organization,associationName,salesSupervisor,now),
    ctx.db.prepare("INSERT INTO audit_logs (id,actor_email,action,entity_type,entity_id,payload,created_at) VALUES (?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(),ctx.session.email,"create","employee",id,JSON.stringify({employeeNo,email,organization}),now),
  ]);
  if(department==="المبيعات"&&associationName){
    const associationId=`assoc-${crypto.randomUUID().slice(0,10)}`;
    await ctx.db.batch([
      ctx.db.prepare("INSERT INTO associations (id,name,branch,status,created_at) VALUES (?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET status='active'").bind(associationId,associationName,organization,"active",now),
      ctx.db.prepare(`INSERT INTO sales_assignments (id,employee_email,association_id,year,status,created_at)
        SELECT ?,?,id,?,'active',? FROM associations WHERE name=?
        ON CONFLICT(employee_email,year) DO UPDATE SET association_id=excluded.association_id,status='active'`)
        .bind(crypto.randomUUID(),email,new Date().getFullYear(),now,associationName),
    ]);
  }
  await createPortalAccess(ctx.db,email,code);
  return NextResponse.json({ok:true,employee:{id,email,employee_no:employeeNo,name,job_title:jobTitle,department,manager_name:managerName,role,status:"active",organization,association_name:associationName,sales_supervisor:salesSupervisor},temporaryCode:code},{status:201});
}
