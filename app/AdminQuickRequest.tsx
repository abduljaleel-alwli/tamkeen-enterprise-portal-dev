"use client";

import { FormEvent, useState } from "react";
import { signalPortalUpdate } from "./live-sync";

export default function AdminQuickRequest({close,done}:{close:()=>void;done:(message:string)=>void}){
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[type,setType]=useState("طلب اعتماد");
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy(true);setError("");
    const body=new FormData(event.currentTarget);
    const response=await fetch("/api/employee",{method:"POST",body});
    setBusy(false);
    if(response.ok){signalPortalUpdate("requests");close();done("تم إنشاء الطلب وإرساله مع مرفقاته إلى الجهة المختارة")}
    else setError("تعذر حفظ الطلب؛ تحقق من النوع والعنوان والمرفق ثم حاول مجددًا.");
  }
  return <div className="modal-wrap" role="dialog" aria-modal="true"><button className="modal-backdrop" onClick={close}/><form className="modal" onSubmit={submit}><header><div><span>إجراء مؤسسي</span><h2>إنشاء طلب جديد</h2></div><button type="button" onClick={close}>×</button></header><div className="form"><label>نوع الطلب<select name="type" value={type} onChange={event=>setType(event.target.value)}><option>طلب اعتماد</option><option>طلب إجازة</option><option>أمر صرف</option><option>طلب شراء</option><option>ترشيح تدريبي</option><option>تكليف وظيفي</option><option>أخرى</option></select></label>{type==="أخرى"&&<label>النوع المخصص<input name="customType" required placeholder="اكتب نوع الطلب"/></label>}<label className={type==="أخرى"?"full":""}>العنوان<input name="title" required placeholder="اكتب عنوانًا واضحًا للطلب"/></label><label className="full">التفاصيل<textarea name="details" placeholder="اشرح الطلب والمبررات والمخرجات المتوقعة"/></label><label>القيمة أو المدة<input name="value" placeholder="مثال: 1,500 ريال أو 5 أيام"/></label><label>الأولوية<select name="priority"><option value="normal">عادية</option><option value="high">عالية</option><option value="urgent">عاجلة</option></select></label><label>مستلم الطلب / جهة التوجيه<select name="recipientScope"><option value="manager">المدير المباشر</option><option value="hr">الموارد البشرية</option><option value="executive">الإدارة التنفيذية</option><option value="general_manager">المدير العام</option></select></label><label>إرفاق الملفات<input name="file" type="file" accept=".pdf,.doc,.docx,.xlsx,.jpg,.jpeg,.png"/><span className="form-hint">الحد الأعلى 15MB</span></label>{error&&<p className="full module-error">{error}</p>}</div><footer><button type="button" onClick={close}>إلغاء</button><button className="primary-btn" disabled={busy}>{busy?"جارٍ الإرسال…":"حفظ وإرسال"}</button></footer></form></div>;
}
