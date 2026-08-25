import { redirect } from "next/navigation";
import { getPortalSession } from "../portal-auth";
import LoginPortal from "./LoginPortal";
import "./login.css";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getPortalSession();
  if (session) redirect(session.role === "admin" ? "/" : "/employee");
  return <LoginPortal />;
}
