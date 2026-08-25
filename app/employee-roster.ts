import { salesDirectory, salesDirectoryForEmail } from "./sales-directory";

export type PortalRole = "admin" | "executive" | "department_head" | "supervisor" | "employee";

export type RosterEmployee = {
  employeeNo: string;
  email: string;
  name: string;
  jobTitle: string;
  department: string;
  managerName: string;
  role: PortalRole;
  organization?: "بيت التمكين" | "مؤسسة معين";
  associationName?: string;
  salesSupervisor?: string;
};

export const employeeRoster: RosterEmployee[] = [
  { employeeNo: "QA-001", email: "qa.admin@example.com", name: "مسؤول المنصة التجريبي", jobTitle: "رئيس قسم الموارد البشرية", department: "الموارد البشرية", managerName: "الإدارة التنفيذية التجريبية", role: "admin" },
  { employeeNo: "QA-002", email: "qa.executive@example.com", name: "مدير تنفيذي تجريبي", jobTitle: "المدير التنفيذي", department: "الإدارة التنفيذية", managerName: "المدير العام التجريبي", role: "executive" },
  { employeeNo: "QA-003", email: "qa.head@example.com", name: "رئيس قسم تجريبي", jobTitle: "رئيس قسم المبيعات", department: "المبيعات", managerName: "المدير العام التجريبي", role: "department_head" },
  { employeeNo: "QA-004", email: "qa.supervisor@example.com", name: "مشرف مبيعات تجريبي", jobTitle: "مشرف المبيعات", department: "المبيعات", managerName: "رئيس قسم تجريبي", role: "supervisor", salesSupervisor: "محمد الراشدي" },
  { employeeNo: "QA-005", email: "qa.sales@example.com", name: "مختص مبيعات تجريبي", jobTitle: "مختص المبيعات", department: "المبيعات", managerName: "مشرف مبيعات تجريبي", role: "employee", associationName: "جمعية تجريبية", salesSupervisor: "محمد الراشدي" },
  { employeeNo: "QA-006", email: "qa.employee@example.com", name: "موظف تجريبي", jobTitle: "منسق إداري", department: "الإدارة العامة", managerName: "رئيس قسم تجريبي", role: "employee" },
];

export function findRosterEmployee(email: string): RosterEmployee | null {
  const normalized = email.trim().toLowerCase();
  return employeeRoster.find((employee) => employee.email === normalized) ?? null;
}

type EmployeeRow = {
  employee_no: string; email: string; name: string; job_title: string; department: string;
  manager_name: string | null; role: PortalRole; organization?: string | null;
  association_name?: string | null; sales_supervisor?: string | null;
};

export async function getRosterEmployee(db: D1Database, email: string): Promise<RosterEmployee | null> {
  await ensureRoster(db);
  const row = await db.prepare(`SELECT e.employee_no,e.email,e.name,e.job_title,e.department,e.manager_name,e.role,
      p.organization,p.association_name,p.sales_supervisor
    FROM employees e LEFT JOIN employee_profiles p ON p.employee_email=e.email
    WHERE e.email=? AND e.status='active' LIMIT 1`).bind(email.trim().toLowerCase()).first<EmployeeRow>();
  if (!row) return null;
  return {
    employeeNo: row.employee_no, email: row.email, name: row.name, jobTitle: row.job_title,
    department: row.department, managerName: row.manager_name || "", role: row.role,
    organization: row.organization === "مؤسسة معين" ? "مؤسسة معين" : "بيت التمكين",
    associationName: row.association_name || undefined, salesSupervisor: row.sales_supervisor || undefined,
  };
}

export function permissionsForRole(role: PortalRole) {
  const canManageTeam = role === "admin" || role === "executive" || role === "department_head" || role === "supervisor";
  return {
    canViewOwnData: true,
    canSubmitRequests: true,
    canUploadDocuments: true,
    canManageTeam,
    canApproveRequests: canManageTeam,
    canAccessAdmin: role === "admin",
  };
}

export async function ensureRoster(db: D1Database): Promise<void> {
  await ensureApplicationSchema(db);
  const now = new Date().toISOString();
  const statements = employeeRoster.map((employee) => db.prepare(`
    INSERT INTO employees (
      id, email, employee_no, name, job_title, department, manager_name,
      branch, role, status, leave_balance, performance_score, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      employee_no = excluded.employee_no,
      name = excluded.name,
      job_title = excluded.job_title,
      department = excluded.department,
      manager_name = excluded.manager_name,
      role = excluded.role,
      status = excluded.status
  `).bind(
    `employee-${employee.employeeNo.toLowerCase()}`,
    employee.email,
    employee.employeeNo,
    employee.name,
    employee.jobTitle,
    employee.department,
    employee.managerName,
    "المقر الرئيسي",
    employee.role,
    "active",
    21,
    employee.role === "admin" ? 86 : 0,
    now,
  ));
  await db.batch(statements);
  await db.batch(employeeRoster.map((employee) => {
    const sales = salesDirectoryForEmail(employee.email);
    return db.prepare(`INSERT INTO employee_profiles (employee_email,organization,association_name,sales_supervisor,updated_at)
      VALUES (?,?,?,?,?) ON CONFLICT(employee_email) DO UPDATE SET
      organization=excluded.organization,association_name=excluded.association_name,sales_supervisor=excluded.sales_supervisor,updated_at=excluded.updated_at`)
      .bind(employee.email, employee.organization || sales?.organization || "بيت التمكين", employee.associationName || sales?.association || null, employee.salesSupervisor || sales?.supervisor || null, now);
  }));
}

async function ensureApplicationSchema(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY NOT NULL,
      email TEXT NOT NULL UNIQUE,
      employee_no TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      job_title TEXT NOT NULL,
      department TEXT NOT NULL,
      manager_name TEXT,
      branch TEXT NOT NULL DEFAULT 'المقر الرئيسي',
      role TEXT NOT NULL DEFAULT 'employee',
      status TEXT NOT NULL DEFAULT 'active',
      leave_balance REAL NOT NULL DEFAULT 21,
      performance_score REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS employee_profiles (
      employee_email TEXT PRIMARY KEY NOT NULL,
      organization TEXT NOT NULL DEFAULT 'بيت التمكين',
      association_name TEXT,
      sales_supervisor TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (employee_email) REFERENCES employees(email) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY NOT NULL,
      employee_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      details TEXT,
      value TEXT,
      priority TEXT NOT NULL DEFAULT 'normal',
      status TEXT NOT NULL DEFAULT 'pending_manager',
      current_step TEXT NOT NULL DEFAULT 'المدير المباشر',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (employee_id) REFERENCES employees(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS request_routing (
      request_id TEXT PRIMARY KEY NOT NULL,
      recipient_scope TEXT NOT NULL,
      recipient_email TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS request_files (
      id TEXT PRIMARY KEY NOT NULL,
      request_id TEXT NOT NULL,
      uploader_email TEXT NOT NULL,
      name TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      content_type TEXT,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY NOT NULL,
      employee_id TEXT NOT NULL,
      title TEXT NOT NULL,
      project_name TEXT,
      due_date TEXT,
      priority TEXT NOT NULL DEFAULT 'normal',
      status TEXT NOT NULL DEFAULT 'open',
      progress INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (employee_id) REFERENCES employees(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY NOT NULL,
      employee_id TEXT NOT NULL,
      name TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      content_type TEXT,
      size INTEGER NOT NULL,
      category TEXT NOT NULL DEFAULT 'other',
      uploaded_at TEXT NOT NULL,
      FOREIGN KEY (employee_id) REFERENCES employees(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY NOT NULL,
      employee_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      read_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (employee_id) REFERENCES employees(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY NOT NULL,
      actor_email TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      payload TEXT,
      created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS workflow_items (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      period TEXT,
      amount TEXT,
      channel TEXT,
      publish_date TEXT,
      department TEXT NOT NULL,
      requester_email TEXT NOT NULL,
      requester_name TEXT NOT NULL,
      current_stage TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      gm_requested INTEGER NOT NULL DEFAULT 0,
      decision_note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS workflow_actions (
      id TEXT PRIMARY KEY NOT NULL,
      workflow_id TEXT NOT NULL,
      actor_email TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      action TEXT NOT NULL,
      note TEXT,
      from_stage TEXT NOT NULL,
      to_stage TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (workflow_id) REFERENCES workflow_items(id)
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS workflow_stage_idx ON workflow_items(current_stage, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS workflow_requester_idx ON workflow_items(requester_email, created_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS associations (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE,
      branch TEXT NOT NULL DEFAULT 'المقر الرئيسي',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_assignments (
      id TEXT PRIMARY KEY NOT NULL,
      employee_email TEXT NOT NULL,
      association_id TEXT NOT NULL,
      year INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      UNIQUE(employee_email, year),
      FOREIGN KEY (association_id) REFERENCES associations(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_targets (
      id TEXT PRIMARY KEY NOT NULL,
      employee_email TEXT NOT NULL,
      association_id TEXT,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      target_amount REAL NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(employee_email, year, month)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_revenue_entries (
      id TEXT PRIMARY KEY NOT NULL,
      employee_email TEXT NOT NULL,
      association_id TEXT,
      entry_date TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      donor_count INTEGER NOT NULL DEFAULT 0,
      receipt_ref TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_cases (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL,
      requester_email TEXT NOT NULL,
      association_id TEXT,
      request_type TEXT NOT NULL,
      title TEXT NOT NULL,
      details TEXT,
      amount REAL,
      period TEXT,
      current_stage TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      decision_note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_case_files (
      id TEXT PRIMARY KEY NOT NULL,
      case_id TEXT NOT NULL,
      uploader_email TEXT NOT NULL,
      name TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      content_type TEXT,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (case_id) REFERENCES sales_cases(id)
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS sales_revenue_scope_idx ON sales_revenue_entries(employee_email, entry_date)"),
    db.prepare("CREATE INDEX IF NOT EXISTS sales_cases_stage_idx ON sales_cases(current_stage, status)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      agenda TEXT,
      meeting_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT,
      location TEXT,
      organizer_email TEXT NOT NULL,
      audience TEXT NOT NULL DEFAULT 'management',
      results_destination TEXT,
      minutes TEXT,
      status TEXT NOT NULL DEFAULT 'scheduled',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS meeting_attendees (
      id TEXT PRIMARY KEY NOT NULL,
      meeting_id TEXT NOT NULL,
      employee_email TEXT NOT NULL,
      attendance_status TEXT NOT NULL DEFAULT 'invited',
      FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS meeting_decisions (
      id TEXT PRIMARY KEY NOT NULL,
      meeting_id TEXT NOT NULL,
      title TEXT NOT NULL,
      owner_email TEXT NOT NULL,
      due_date TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      notes TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY NOT NULL,
      author_email TEXT NOT NULL,
      author_name TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      department_scope TEXT NOT NULL DEFAULT 'all',
      starts_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'published',
      created_at TEXT NOT NULL,
      archived_at TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS support_requests (
      id TEXT PRIMARY KEY NOT NULL,
      requester_email TEXT NOT NULL,
      category TEXT NOT NULL,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS development_plans (
      id TEXT PRIMARY KEY NOT NULL,
      employee_email TEXT NOT NULL,
      improvement_area TEXT NOT NULL,
      actions TEXT NOT NULL,
      due_date TEXT,
      progress INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS evaluations (
      id TEXT PRIMARY KEY NOT NULL,
      employee_email TEXT NOT NULL,
      department TEXT NOT NULL,
      assigned_to_email TEXT NOT NULL,
      route_type TEXT NOT NULL,
      template_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS evaluation_submissions (
      id TEXT PRIMARY KEY NOT NULL,
      evaluation_id TEXT NOT NULL UNIQUE,
      responder_email TEXT NOT NULL,
      scores_json TEXT NOT NULL,
      notes TEXT,
      submitted_at TEXT NOT NULL,
      FOREIGN KEY (evaluation_id) REFERENCES evaluations(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS external_receipt_reports (
      id TEXT PRIMARY KEY NOT NULL,
      requester_email TEXT NOT NULL,
      association_id TEXT,
      period TEXT NOT NULL,
      total_amount REAL NOT NULL DEFAULT 0,
      receipt_count INTEGER NOT NULL DEFAULT 0,
      pdf_storage_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_accounts',
      created_at TEXT NOT NULL,
      FOREIGN KEY (association_id) REFERENCES associations(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS external_receipts (
      id TEXT PRIMARY KEY NOT NULL,
      report_id TEXT NOT NULL,
      name TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      content_type TEXT,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (report_id) REFERENCES external_receipt_reports(id) ON DELETE CASCADE
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS meetings_date_idx ON meetings(meeting_date, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS announcements_active_idx ON announcements(status, starts_at, expires_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS development_employee_idx ON development_plans(employee_email, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS evaluations_assignee_idx ON evaluations(assigned_to_email, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS request_files_request_idx ON request_files(request_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS receipt_reports_requester_idx ON external_receipt_reports(requester_email, created_at)"),
  ]);

  const now = new Date().toISOString();
  const seedStatements = [
    db.prepare("INSERT OR IGNORE INTO associations (id,name,branch,status,created_at) VALUES (?,?,?,?,?)").bind("assoc-unassigned", "غير محددة", "المقر الرئيسي", "active", now),
  ];
  for (const entry of salesDirectory.filter((item) => item.email && item.association !== "—")) {
    const associationId = `assoc-${stableId(entry.association)}`;
    seedStatements.push(
      db.prepare("INSERT OR IGNORE INTO associations (id,name,branch,status,created_at) VALUES (?,?,?,?,?)")
        .bind(associationId, entry.association, entry.organization, "active", now),
      db.prepare(`INSERT INTO sales_assignments (id,employee_email,association_id,year,status,created_at) VALUES (?,?,?,?,?,?)
        ON CONFLICT(employee_email,year) DO UPDATE SET association_id=excluded.association_id,status='active'`)
        .bind(`assign-${stableId(entry.email!)}-2026`, entry.email, associationId, 2026, "active", now),
    );
  }
  await db.batch(seedStatements);
}

function stableId(value: string) {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
}

export async function getAuthorizedEmployee(db: D1Database, email: string) {
  const rosterEmployee = await getRosterEmployee(db, email);
  if (!rosterEmployee) return null;
  const employee = await db.prepare("SELECT * FROM employees WHERE email = ? LIMIT 1")
    .bind(rosterEmployee.email)
    .first();
  return { employee, rosterEmployee, permissions: permissionsForRole(rosterEmployee.role) };
}

export async function getManagementSnapshot(db: D1Database, actor: RosterEmployee) {
  const globalScope = actor.role === "admin" || actor.role === "executive";
  const teamQuery = globalScope
    ? db.prepare("SELECT id,name,job_title,department,role,status,performance_score FROM employees WHERE status = 'active' AND email <> ? ORDER BY name").bind(actor.email)
    : actor.role === "supervisor"
      ? db.prepare("SELECT id,name,job_title,department,role,status,performance_score FROM employees WHERE status = 'active' AND manager_name = ? ORDER BY name").bind(actor.name)
      : db.prepare("SELECT id,name,job_title,department,role,status,performance_score FROM employees WHERE status = 'active' AND department = ? AND email <> ? ORDER BY name").bind(actor.department, actor.email);
  const requestsQuery = globalScope
    ? db.prepare("SELECT r.id,r.type,r.title,r.value,r.status,r.created_at,e.name AS employee_name,(SELECT id FROM request_files f WHERE f.request_id=r.id LIMIT 1) AS file_id,(SELECT COUNT(*) FROM request_files f WHERE f.request_id=r.id) AS file_count FROM requests r JOIN employees e ON e.id = r.employee_id WHERE r.status LIKE 'pending%' ORDER BY r.created_at DESC LIMIT 20")
    : actor.role === "supervisor"
      ? db.prepare("SELECT r.id,r.type,r.title,r.value,r.status,r.created_at,e.name AS employee_name,(SELECT id FROM request_files f WHERE f.request_id=r.id LIMIT 1) AS file_id,(SELECT COUNT(*) FROM request_files f WHERE f.request_id=r.id) AS file_count FROM requests r JOIN employees e ON e.id = r.employee_id WHERE r.status = 'pending_manager' AND e.manager_name = ? ORDER BY r.created_at DESC LIMIT 20").bind(actor.name)
      : db.prepare("SELECT r.id,r.type,r.title,r.value,r.status,r.created_at,e.name AS employee_name,(SELECT id FROM request_files f WHERE f.request_id=r.id LIMIT 1) AS file_id,(SELECT COUNT(*) FROM request_files f WHERE f.request_id=r.id) AS file_count FROM requests r JOIN employees e ON e.id = r.employee_id WHERE r.status LIKE 'pending%' AND e.department = ? ORDER BY r.created_at DESC LIMIT 20").bind(actor.department);
  const [team, pendingRequests] = await Promise.all([teamQuery.all(), requestsQuery.all()]);
  return { team: team.results ?? [], pendingRequests: pendingRequests.results ?? [] };
}
