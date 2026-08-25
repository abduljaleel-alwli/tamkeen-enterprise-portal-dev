"use client";

import { FormEvent, useMemo, useState } from "react";

export default function LoginPortal() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const canSubmit = useMemo(() => /\S+@\S+\.\S+/.test(email.trim()) && /^\d{6}$/.test(code), [email, code]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || loading) return;
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code }),
      });
      const result = await response.json() as { ok?: boolean; redirectTo?: string; message?: string };
      if (!response.ok || !result.ok) {
        setMessage(result.message ?? "تعذّر تسجيل الدخول. تحقق من البيانات وحاول مجددًا.");
        return;
      }
      window.location.assign(result.redirectTo === "/" ? "/" : "/employee");
    } catch {
      setMessage("تعذّر الاتصال ببوابة الدخول. تحقق من اتصالك ثم حاول مجددًا.");
    } finally {
      setLoading(false);
    }
  }

  return <main className="login-shell" dir="rtl">
    <section className="login-brand-panel" aria-label="بوابة بيت التمكين">
      <div className="login-brand-top"><img src="/tamkeen-mark-flat.png" alt="شعار بيت التمكين"/><div><b>بوابة بيت التمكين</b><span>منصة الموظفين والإدارة</span></div></div>
      <div className="login-brand-copy"><span className="login-kicker">نُمكّن لأهدافك</span><h1>مساحتك الآمنة<br/>للإنجاز وصناعة الأثر.</h1><p>بوابة موحّدة تضع طلباتك، مهامك، مستنداتك ومسارك الوظيفي في مكان واحد.</p><div className="login-trust"><i>✓</i><span><b>دخول شخصي وآمن</b><small>يتم توجيهك تلقائيًا وفق بريدك وصلاحياتك.</small></span></div></div>
      <div className="login-metallic"><span/><img src="/tamkeen-mark-metallic-cutout.png" alt=""/></div>
      <div className="login-orbit login-orbit-one"/><div className="login-orbit login-orbit-two"/>
    </section>
    <section className="login-form-panel">
      <div className="login-card">
        <header><span>تسجيل الدخول</span><h2>مرحبًا بك في بوابتك</h2><p>استخدم بريدك المعتمد ورمز الدخول الشخصي الذي استلمته من الإدارة.</p></header>
        <form onSubmit={submit} noValidate>
          <label htmlFor="portal-email">البريد الإلكتروني المعتمد</label>
          <div className="login-field"><i>✉</i><input id="portal-email" type="email" inputMode="email" autoComplete="username" value={email} onChange={(event)=>setEmail(event.target.value)} placeholder="name@example.com" required/></div>
          <div className="login-label-row"><label htmlFor="portal-code">رمز الدخول الشخصي</label><span>6 أرقام</span></div>
          <div className="login-field code-field"><i>⌾</i><input id="portal-code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event)=>setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="••••••" required/></div>
          {message&&<p className="login-error" role="alert"><i>!</i>{message}</p>}
          <button className="login-submit" type="submit" disabled={!canSubmit||loading}>{loading?<><i className="login-spinner"/>جاري التحقق...</>:<>دخول إلى البوابة <span>←</span></>}</button>
        </form>
        <footer><div><i>♙</i><span><b>هل تحتاج مساعدة؟</b><small>تواصل مع الإدارة التنفيذية لمراجعة بريدك أو رمزك.</small></span></div><p>دخولك يعني التزامك بسياسات الاستخدام وخصوصية البيانات.</p></footer>
      </div>
    </section>
  </main>;
}
