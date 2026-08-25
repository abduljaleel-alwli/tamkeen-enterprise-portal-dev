"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { signalPortalUpdate, usePortalLiveSync } from "./live-sync";
import "./announcements.css";

type Announcement = { id: string; title: string; body: string; author_name: string; department_scope: string; starts_at: string; expires_at: string; status: string; created_at: string };
type Data = { announcements: Announcement[]; permissions: { canPublish: boolean; canAdmin: boolean } };

async function getData(): Promise<Data> {
  const response = await fetch("/api/announcements", { cache: "no-store" });
  if (!response.ok) throw new Error("load");
  return response.json();
}

export function AnnouncementStrip() {
  const [items,setItems] = useState<Announcement[]>([]);
  const load = useCallback(() => getData().then(data => setItems(data.announcements)).catch(() => {}), []);
  useEffect(() => { void load(); }, [load]);
  usePortalLiveSync(load, ["announcements"]);
  if (!items.length) return null;
  const item = items[0];
  return <section className="announcement-strip" aria-label="التعميم الحالي"><i>✦</i><div><small>{item.department_scope === "all" ? "تعميم عام" : `تعميم ${item.department_scope}`}</small><b>{item.title}</b><p>{item.body}</p></div><time>حتى {new Date(item.expires_at).toLocaleString("ar-SA", { dateStyle: "medium", timeStyle: "short" })}</time></section>;
}

export default function AnnouncementsModule() {
  const [data,setData] = useState<Data>({ announcements: [], permissions: { canPublish: false, canAdmin: false } }), [loading,setLoading] = useState(true), [open,setOpen] = useState(false), [toast,setToast] = useState("");
  const load = useCallback(() => getData().then(setData).finally(() => setLoading(false)), []);
  useEffect(() => { void load(); }, [load]);
  usePortalLiveSync(load, ["announcements"]);
  const say = (text:string) => { setToast(text); window.setTimeout(() => setToast(""), 2500); };
  async function archive(id:string) { const response=await fetch("/api/announcements",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id,action:"archive"})});if(response.ok){signalPortalUpdate("announcements");await load();say("تمت أرشفة التعميم")}}
  return <section className="announcements-module" dir="rtl">
    <header className="announcements-hero"><div><span>اتصال داخلي منضبط</span><h1>التعاميم والإعلانات المؤسسية</h1><p>انشر الرسالة للموظفين المستهدفين وحدد مدة ظهورها، مع سجل كامل للتعاميم الحالية والمؤرشفة.</p></div>{data.permissions.canPublish&&<button onClick={()=>setOpen(true)}>＋ تعميم جديد</button>}</header>
    <div className="announcements-stats"><article><b>{data.announcements.filter(x=>x.status==="published").length}</b><span>تعاميم منشورة</span></article><article><b>{data.announcements.filter(x=>x.department_scope==="all").length}</b><span>تعاميم عامة</span></article><article><b>{data.announcements.filter(x=>x.status==="archived").length}</b><span>في الأرشيف</span></article></div>
    {loading?<p className="announcements-empty">جاري تحميل التعاميم…</p>:<div className="announcements-list">{data.announcements.map(item=><article key={item.id} className={item.status}><i>✦</i><div><small>{item.department_scope==="all"?"جميع الموظفين":item.department_scope} · {item.author_name}</small><h3>{item.title}</h3><p>{item.body}</p><footer><span>نُشر {new Date(item.created_at).toLocaleDateString("ar-SA")}</span><span>ينتهي {new Date(item.expires_at).toLocaleString("ar-SA")}</span></footer></div><em>{item.status==="published"?"منشور":"مؤرشف"}</em>{data.permissions.canAdmin&&item.status==="published"&&<button onClick={()=>archive(item.id)}>أرشفة</button>}</article>)}{!data.announcements.length&&<p className="announcements-empty">لا توجد تعاميم حتى الآن.</p>}</div>}
    {open&&<AnnouncementForm close={()=>setOpen(false)} saved={async()=>{setOpen(false);signalPortalUpdate("announcements");await load();say("تم نشر التعميم وإشعار الموظفين")}}/>}
    {toast&&<div className="module-toast">✓ {toast}</div>}
  </section>;
}

function AnnouncementForm({close,saved}:{close:()=>void;saved:()=>void}) {
  const [duration,setDuration]=useState("24"),[busy,setBusy]=useState(false),[error,setError]=useState("");
  async function submit(event:FormEvent<HTMLFormElement>) { event.preventDefault();setBusy(true);setError("");const form=new FormData(event.currentTarget),body=Object.fromEntries(form.entries());body.durationHours=duration;const response=await fetch("/api/announcements",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});setBusy(false);if(response.ok)saved();else setError("تعذر نشر التعميم؛ تحقق من الحقول والصلاحية.") }
  return <div className="module-modal"><button className="module-modal-back" onClick={close} aria-label="إغلاق"/><form onSubmit={submit}><header><div><span>نشر مقيّد بالصلاحيات</span><h2>إنشاء تعميم</h2></div><button type="button" onClick={close}>×</button></header><div className="module-form"><label className="wide">عنوان التعميم<input name="title" required/></label><label className="wide">نص التعميم<textarea name="body" required/></label><label>النطاق<select name="departmentScope"><option value="all">جميع الموظفين</option><option>المبيعات</option><option>الحسابات</option><option>الإدارة التنفيذية</option></select></label><label>مدة الظهور<select value={duration} onChange={e=>setDuration(e.target.value)}><option value="8">8 ساعات</option><option value="24">يوم كامل</option><option value="72">3 أيام</option><option value="custom">فترة مخصصة</option></select></label>{duration==="custom"&&<label className="wide">تاريخ ووقت الانتهاء<input name="expiresAt" type="datetime-local" required/></label>}{error&&<p className="module-error wide">{error}</p>}</div><footer><button type="button" onClick={close}>إلغاء</button><button disabled={busy} type="submit">{busy?"جارٍ النشر…":"نشر التعميم"}</button></footer></form></div>;
}
