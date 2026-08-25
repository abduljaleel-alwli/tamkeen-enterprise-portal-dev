import { redirect } from "next/navigation";
import AdminPortal from "./AdminPortal";
import { requirePortalSession } from "./portal-auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await requirePortalSession("/");
  if (session.role !== "admin") redirect("/employee");
  return <AdminPortal />;
}
