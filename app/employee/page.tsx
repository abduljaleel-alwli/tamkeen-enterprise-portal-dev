import { permissionsForSession, requirePortalSession } from "../portal-auth";
import EmployeePortal from "./EmployeePortal";
import "./employee.css";
import "./banner-refresh.css";

export const dynamic = "force-dynamic";

export default async function EmployeePage(){
  const session=await requirePortalSession("/employee");
  const initialPermissions=permissionsForSession(session);
  return <EmployeePortal
    identity={{email:session.email,displayName:session.name}}
    previewMode={false}
    initialPermissions={initialPermissions}
  />;
}
