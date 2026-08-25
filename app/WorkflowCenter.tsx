"use client";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { signalPortalUpdate, usePortalLiveSync } from "./live-sync";
import "./workflow-center.css";

type WorkflowItem = {
  id: string; kind: string; kind_label: string; title: string; summary?: string; period?: string; amount?: string;
  channel?: string; publish_date?: string; department: string; requester_name: string; current_stage: string; status: string;
  decision_note?: string; created_at: string; can_act: boolean; can_resubmit?: boolean; is_approved_copy?: boolean;
};
type Authority = {
  isGeneralManager?: boolean; isExecutiveManagement?: boolean; isDeputyExecutive?: boolean; isExecutiveDirector?: boolean;
  isHeadOfSales?: boolean; isHeadOfAccounts?: boolean; isSalesSupervisor?: boolean;
  createKinds: { kind: string; label: string }[];
};

const stageLabels: Record<string,string> = {
  sales_supervisor: "مشرف المبيعات", sales_head: "رئيس قسم المبيعات", executive_management: "الإدارة التنفيذية المشتركة",
  general_manager: "المدير العام", accounts_copy: "رئيس قسم الحسابات", requester_revision: "بانتظار تعديل مقدم الطلب", completed: "مكتمل",
};
const routes: Record<string,string[]> = {
  content_approval: ["مختص المبيعات", "مشرف المبيعات", "اعتماد النشر"],
  sales_monthly_plan: ["مختص المبيعات", "مشرف المبيعات", "رئيس قسم المبيعات"],
  sales_monthly_report: ["مختص المبيعات", "مشرف المبيعات", "رئيس قسم المبيعات"],
  department_report: ["رئيس القسم", "الإدارة التنفيذية", "حفظ التقرير"],
  sales_target: ["رئيس قسم المبيعات", "المدير العام", "نسخة للحسابات"],
  commission_policy: ["رئيس قسم المبيعات", "المدير العام", "نسخة للحسابات"],
  budget_request: ["رئيس القسم / سكرتير المدير العام", "الإدارة التنفيذية المشتركة", "المدير العام", "نسخة للحسابات"],
  leave_request: ["الموظف", "المدير المباشر", "الموارد البشرية", "السلطة النهائية"],
  disciplinary_action: ["المشرف يوثّق", "الموارد البشرية تتحقق", "المدير المخوّل يعتمد", "الموارد البشرية تصدر وتحفظ"],
  contract_mou: ["الإدارة التنفيذية تعدّ وتتفاوض", "مراجعة مالية وفنية", "المدير العام يوقّع"],
  payroll_cycle: ["الموارد البشرية تعدّ", "الحسابات تراجع", "السلطة المخولة تعتمد", "الصرف والحفظ"],
  association_project: ["المختص يعدّ الملف", "الإدارة التنفيذية تراجع", "الحسابات تراجع الميزانية", "المدير العام عند الحاجة"],
};
const blueprints={sales:{title:"بطاقة تشغيل رئيس قسم المبيعات",tasks:["متابعة المستهدفات وعوائق الفريق يوميًا","مراجعة المحتوى بعد اعتماد المشرف","اعتماد خطط المشرف ومراجعة تقارير المختصين","رفع ميزانية القسم والتقرير الشهري","رفع المستهدفات وسياسة العمولات للمدير العام"],kpis:["تحقيق المستهدف الشهري والسنوي","نمو الإيرادات والتحصيل","تنفيذ الخطط في موعدها","زمن معالجة عوائق الفريق","انتظام التقارير والميزانية والعمولات"]},accounts:{title:"بطاقة تشغيل رئيس قسم الحسابات",tasks:["القيود والمقبوضات والمدفوعات والمطابقات اليومية","مراجعة الرواتب والعمولات والفواتير","التقارير والإقفالات والإقرارات الدورية","التحصيل والتصعيد بعد اليوم العاشر","حفظ النسخ المعتمدة للمستهدفات والعمولات والميزانية"],kpis:["دقة القيود والمطابقات","الالتزام بمواعيد الرواتب والعمولات","نسبة التحصيل في الموعد","الالتزام بالإقفالات والتقارير","سلامة المستندات والامتثال"]}};

export default function WorkflowCenter({compact=false}:{compact?:boolean}) {
  const [items,setItems]=useState<WorkflowItem[]>([]), [authority,setAuthority]=useState<Authority>({createKinds:[]});
  const [loading,setLoading]=useState(true), [error,setError]=useState(""), [formOpen,setFormOpen]=useState(false), [noteFor,setNoteFor]=useState<string|null>(null), [busy,setBusy]=useState("");
  const [tab,setTab]=useState<"inbox"|"mine"|"copies"|"routes">("inbox");
  const load=useCallback(()=>fetch("/api/workflows",{cache:"no-store"}).then(async r=>{if(!r.ok)throw new Error("load");return r.json()}).then(d=>{setItems(d.items||[]);setAuthority(d.authority||{createKinds:[]});setError("")}).catch(()=>setError("تعذر تحميل مركز الاعتمادات الآن")).finally(()=>setLoading(false)),[]);
  useEffect(()=>{load()},[load]);
  usePortalLiveSync(load,["workflows"]);
  const shown=useMemo(()=>items.filter(x=>tab==="inbox"?x.can_act:tab==="mine"?!x.is_approved_copy:tab==="copies"?x.is_approved_copy:true),[items,tab]);
  async function decide(id:string,action:"approve"|"return"|"resubmit",note=""){
    setBusy(id+action); const r=await fetch("/api/workflows",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id,action,note})});
    setBusy(""); if(r.ok){setNoteFor(null);signalPortalUpdate("workflows");await load()} else setError("تعذر حفظ القرار. تأكد من الصلاحية والملاحظات المطلوبة.");
  }
  return <section className={`wf ${compact?"wf-compact":""}`} dir="rtl">
    <header className="wf-hero"><div><span>حوكمة قابلة للتدقيق</span><h1>مركز المعاملات والاعتمادات</h1><p>مسارات واضحة من مقدم المعاملة إلى صاحب القرار، مع نسخة تلقائية للحسابات عند الاعتماد النهائي.</p></div><div className="wf-hero-actions">{authority.isExecutiveManagement&&<em>الإدارة التنفيذية · صلاحية مشتركة</em>}{authority.createKinds.length>0&&<button onClick={()=>setFormOpen(true)}>＋ معاملة جديدة</button>}</div></header>
    <div className="wf-policy"><article><i>✓</i><div><b>اعتماد المدير العام</b><span>المستهدفات والعمولات والميزانية</span></div></article><article><i>◇</i><div><b>إدارة تنفيذية تشاركية</b><span>يظهر الوارد للمدير التنفيذي ونائبه، وأيّهما يعتمد يكمل المسار</span></div></article><article><i>▤</i><div><b>نسخة تلقائية للحسابات</b><span>بعد الاعتماد النهائي مباشرة</span></div></article></div>
    {(authority.isHeadOfSales||authority.isHeadOfAccounts)&&<RoleBlueprint data={authority.isHeadOfSales?blueprints.sales:blueprints.accounts}/>} 
    <nav className="wf-tabs"><button className={tab==="inbox"?"active":""} onClick={()=>setTab("inbox")}>صندوق قراراتي <b>{items.filter(x=>x.can_act).length}</b></button><button className={tab==="mine"?"active":""} onClick={()=>setTab("mine")}>المعاملات المرئية</button>{authority.isHeadOfAccounts&&<button className={tab==="copies"?"active":""} onClick={()=>setTab("copies")}>نسخ الاعتمادات</button>}<button className={tab==="routes"?"active":""} onClick={()=>setTab("routes")}>الدورات المعتمدة</button></nav>
    {loading?<div className="wf-empty">جاري مزامنة المعاملات…</div>:error?<div className="wf-error">{error}<button onClick={load}>إعادة المحاولة</button></div>:tab==="routes"?<Routes/>:shown.length===0?<div className="wf-empty"><i>✓</i><b>{tab==="inbox"?"لا توجد قرارات معلقة لديك":"لا توجد معاملات في هذا القسم"}</b><span>ستظهر هنا تلقائيًا وفق بريدك ومسمّاك وصلاحيتك.</span></div>:<div className="wf-list">{shown.map(item=><article key={item.id} className={item.can_act?"needs-action":""}><div className="wf-kind"><i>{item.kind==="budget_request"?"﷼":item.kind==="content_approval"?"✦":"▤"}</i><span><b>{item.kind_label}</b><small>{item.id}</small></span></div><div className="wf-main"><h3>{item.title}</h3><p>{item.summary||"لا توجد ملاحظات إضافية"}</p>{item.decision_note&&<p className="wf-decision-note">ملاحظة القرار: {item.decision_note}</p>}<div><span>{item.requester_name}</span><span>{item.department}</span>{item.period&&<span>{item.period}</span>}{item.amount&&<span>{item.amount}</span>}{item.channel&&<span>{item.channel}</span>}</div></div><div className="wf-stage"><small>المرحلة الحالية</small><b>{stageLabels[item.current_stage]||item.current_stage}</b><span className={`wf-status ${item.status}`}>{item.status==="approved"?"معتمد":item.status==="returned"?"معاد للتعديل":"قيد الإجراء"}</span></div>{item.can_act&&<div className="wf-actions"><button className="approve" disabled={busy!==""} onClick={()=>decide(item.id,"approve")}>{busy===item.id+"approve"?"جارٍ الحفظ…":"اعتماد"}</button><button disabled={busy!==""} onClick={()=>setNoteFor(item.id)}>طلب تعديل</button></div>}{item.can_resubmit&&<div className="wf-actions"><button className="approve" disabled={busy!==""} onClick={()=>decide(item.id,"resubmit")}>{busy===item.id+"resubmit"?"جارٍ الإرسال…":"إعادة الإرسال"}</button></div>}{noteFor===item.id&&<ReturnNote close={()=>setNoteFor(null)} save={(note)=>decide(item.id,"return",note)} busy={busy!==""}/>}</article>)}</div>}
    {formOpen&&<WorkflowForm kinds={authority.createKinds} close={()=>setFormOpen(false)} saved={()=>{setFormOpen(false);signalPortalUpdate("workflows");load()}}/>}
  </section>
}

function RoleBlueprint({data}:{data:{title:string;tasks:string[];kpis:string[]}}){return <details className="wf-blueprint"><summary><span><b>{data.title}</b><small>مستنتجة من المهام الفعلية المعتمدة</small></span><em>عرض المسؤوليات والمؤشرات</em></summary><div><section><b>المسؤوليات التشغيلية</b>{data.tasks.map(x=><p key={x}>✓ {x}</p>)}</section><section><b>مؤشرات الأداء الفعلية</b>{data.kpis.map(x=><p key={x}>◇ {x}</p>)}</section></div></details>}

function Routes(){return <div className="wf-routes">{Object.entries(routes).map(([kind,steps])=><article key={kind}><b>{({content_approval:"اعتماد المحتوى",sales_monthly_plan:"الخطة الشهرية",sales_monthly_report:"التقرير الشهري",department_report:"تقرير رئيس القسم",sales_target:"مستهدفات المبيعات",commission_policy:"سياسة العمولات",budget_request:"الميزانية",leave_request:"الإجازات والأذونات",disciplinary_action:"المخالفة أو الإنذار",contract_mou:"العقد أو مذكرة التفاهم",payroll_cycle:"مسار الرواتب",association_project:"ملف مشروع جمعية"} as Record<string,string>)[kind]}</b><div>{steps.map((s,i)=><span key={s}><i>{i+1}</i>{s}{i<steps.length-1&&<em>←</em>}</span>)}</div>{kind==="department_report"&&<small>الوجهة الافتراضية هي الإدارة التنفيذية، ويتجه للمدير العام فقط عندما يكون مطلوبًا منه.</small>}</article>)}</div>}

function ReturnNote({close,save,busy}:{close:()=>void;save:(note:string)=>void;busy:boolean}){const[note,setNote]=useState("");return <div className="wf-inline-note"><label>ملاحظات التعديل المطلوبة<textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="اكتب التعديل المطلوب بوضوح…"/></label><button disabled={busy||!note.trim()} onClick={()=>save(note)}>إرسال للمُعدِّل</button><button onClick={close}>إلغاء</button></div>}

function WorkflowForm({kinds,close,saved}:{kinds:{kind:string;label:string}[];close:()=>void;saved:()=>void}){
  const first=kinds[0]?.kind||""; const[kind,setKind]=useState(first),[busy,setBusy]=useState(false),[error,setError]=useState("");
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);const fd=new FormData(e.currentTarget);const body=Object.fromEntries(fd.entries());body.gmRequested=fd.get("gmRequested")==="on";const r=await fetch("/api/workflows",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});setBusy(false);if(r.ok)saved();else setError("تعذر إرسال المعاملة. راجع الحقول والصلاحية.")}
  return <div className="wf-modal"><button className="wf-back" onClick={close}/><form onSubmit={submit}><header><div><span>مسار مؤسسي موثق</span><h2>إنشاء معاملة جديدة</h2></div><button type="button" onClick={close}>×</button></header><div className="wf-form"><label>نوع المعاملة<select name="kind" value={kind} onChange={e=>setKind(e.target.value)}>{kinds.map(k=><option key={k.kind} value={k.kind}>{k.label}</option>)}</select></label><label>العنوان<input name="title" required placeholder="عنوان واضح ومحدد"/></label><label className="wide">التفاصيل / المحتوى<textarea name="summary" required placeholder={kind==="content_approval"?"ألصق النص الجاهز للنشر مع التعليمات":"اكتب ملخصًا ومبررات ونتائج المعاملة"}/></label><label>الفترة<input name="period" placeholder="مثال: سبتمبر 2026 / عام 2027"/></label><label>{kind==="budget_request"?"القيمة التقديرية":"القيمة أو المستهدف"}<input name="amount" placeholder="مثال: 25,000 ريال"/></label>{kind==="content_approval"&&<><label>قناة النشر<select name="channel"><option>منصة X</option><option>إنستغرام</option><option>المتجر الإلكتروني</option><option>واتساب</option><option>أخرى</option></select></label><label>تاريخ النشر المقترح<input name="publishDate" type="date"/></label></>}{kind==="department_report"&&<label className="wf-check wide"><input type="checkbox" name="gmRequested"/> هذا التقرير مطلوب مباشرةً من المدير العام</label>}<div className="wf-route-preview wide"><span>المسار المعتمد</span><div>{(routes[kind]||[]).map((s,i)=><b key={s}>{s}{i<(routes[kind]?.length||0)-1&&<em> ← </em>}</b>)}</div></div>{error&&<p className="wf-form-error">{error}</p>}</div><footer><button type="button" onClick={close}>إلغاء</button><button disabled={busy} type="submit">{busy?"جارٍ الإرسال…":"حفظ وإرسال"}</button></footer></form></div>
}
