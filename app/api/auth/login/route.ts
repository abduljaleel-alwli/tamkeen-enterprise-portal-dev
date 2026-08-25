import { NextResponse } from "next/server";
import { authenticatePortalCode, PORTAL_SESSION_COOKIE, PORTAL_SESSION_MAX_AGE_SECONDS } from "../../../portal-auth";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { email?: unknown; code?: unknown };
    const email = typeof body.email === "string" ? body.email : "";
    const code = typeof body.code === "string" ? body.code.replace(/\D/g, "") : "";
    if (!email || !/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: "invalid_credentials", message: "تحقق من البريد ورمز الدخول المكوّن من ستة أرقام." }, { status: 400 });
    }

    const result = await authenticatePortalCode(email, code);
    if (!result.ok) {
      if (result.reason === "locked") {
        return NextResponse.json({ error: "account_locked", message: `تم إيقاف المحاولات مؤقتًا. أعد المحاولة بعد ${result.retryAfterMinutes ?? 15} دقيقة.` }, { status: 429 });
      }
      return NextResponse.json({ error: "invalid_credentials", message: "البريد أو رمز الدخول غير صحيح، أو أن الحساب غير مفعّل." }, { status: 401 });
    }

    const response = NextResponse.json({ ok: true, redirectTo: result.redirectTo, name: result.name });
    response.cookies.set(PORTAL_SESSION_COOKIE, result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: PORTAL_SESSION_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    console.error("portal_login_error", error);
    return NextResponse.json({ error: "login_unavailable", message: "تعذّر إتمام تسجيل الدخول الآن. حاول مرة أخرى بعد قليل." }, { status: 503 });
  }
}
