import { NextResponse } from "next/server";
import { PORTAL_SESSION_COOKIE, revokeCurrentPortalSession } from "../../../portal-auth";

export async function POST(request: Request) {
  await revokeCurrentPortalSession();
  const response = NextResponse.redirect(new URL("/login?logged_out=1", request.url), 303);
  response.cookies.set(PORTAL_SESSION_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
