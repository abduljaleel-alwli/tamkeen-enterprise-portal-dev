import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const employees = sqliteTable("employees", {
  id: text("id").primaryKey(), email: text("email").notNull().unique(), employeeNo: text("employee_no").notNull().unique(),
  name: text("name").notNull(), jobTitle: text("job_title").notNull(), department: text("department").notNull(),
  managerName: text("manager_name"), branch: text("branch").notNull().default("المقر الرئيسي"), role: text("role").notNull().default("employee"),
  status: text("status").notNull().default("active"), leaveBalance: real("leave_balance").notNull().default(21),
  performanceScore: real("performance_score").notNull().default(0), createdAt: text("created_at").notNull(),
});
export const requests = sqliteTable("requests", {
  id: text("id").primaryKey(), employeeId: text("employee_id").notNull().references(() => employees.id), type: text("type").notNull(),
  title: text("title").notNull(), details: text("details"), value: text("value"), priority: text("priority").notNull().default("normal"),
  status: text("status").notNull().default("pending_manager"), currentStep: text("current_step").notNull().default("المدير المباشر"),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
});
export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(), employeeId: text("employee_id").notNull().references(() => employees.id), title: text("title").notNull(),
  projectName: text("project_name"), dueDate: text("due_date"), priority: text("priority").notNull().default("normal"),
  status: text("status").notNull().default("open"), progress: integer("progress").notNull().default(0),
});
export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(), employeeId: text("employee_id").notNull().references(() => employees.id), name: text("name").notNull(),
  storageKey: text("storage_key").notNull(), contentType: text("content_type"), size: integer("size").notNull(),
  category: text("category").notNull().default("other"), uploadedAt: text("uploaded_at").notNull(),
});
export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(), employeeId: text("employee_id").notNull().references(() => employees.id), title: text("title").notNull(),
  body: text("body").notNull(), readAt: text("read_at"), createdAt: text("created_at").notNull(),
});
export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(), actorEmail: text("actor_email").notNull(), action: text("action").notNull(), entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(), payload: text("payload"), createdAt: text("created_at").notNull(),
});
export const portalAccess = sqliteTable("portal_access", {
  email: text("email").primaryKey(), codeDigest: text("code_digest").notNull(), failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: text("locked_until"), isActive: integer("is_active").notNull().default(1), lastLoginAt: text("last_login_at"),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
});
export const portalSessions = sqliteTable("portal_sessions", {
  id: text("id").primaryKey(), tokenHash: text("token_hash").notNull().unique(),
  email: text("email").notNull().references(() => employees.email, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull(), expiresAt: text("expires_at").notNull(), lastSeenAt: text("last_seen_at").notNull(),
}, (table) => [index("portal_sessions_email_idx").on(table.email), index("portal_sessions_expires_at_idx").on(table.expiresAt)]);

export const associations = sqliteTable("associations", {
  id: text("id").primaryKey(), name: text("name").notNull().unique(), branch: text("branch").notNull().default("المقر الرئيسي"),
  status: text("status").notNull().default("active"), createdAt: text("created_at").notNull(),
});
export const salesAssignments = sqliteTable("sales_assignments", {
  id: text("id").primaryKey(), employeeEmail: text("employee_email").notNull(), associationId: text("association_id").notNull(),
  year: integer("year").notNull(), status: text("status").notNull().default("active"), createdAt: text("created_at").notNull(),
});
export const salesTargets = sqliteTable("sales_targets", {
  id: text("id").primaryKey(), employeeEmail: text("employee_email").notNull(), associationId: text("association_id"), year: integer("year").notNull(),
  month: integer("month").notNull(), targetAmount: real("target_amount").notNull().default(0), createdBy: text("created_by").notNull(), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
});
export const salesRevenueEntries = sqliteTable("sales_revenue_entries", {
  id: text("id").primaryKey(), employeeEmail: text("employee_email").notNull(), associationId: text("association_id"), entryDate: text("entry_date").notNull(),
  amount: real("amount").notNull().default(0), donorCount: integer("donor_count").notNull().default(0), receiptRef: text("receipt_ref"), notes: text("notes"), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
});
export const salesCases = sqliteTable("sales_cases", {
  id: text("id").primaryKey(), kind: text("kind").notNull(), requesterEmail: text("requester_email").notNull(), associationId: text("association_id"), requestType: text("request_type").notNull(),
  title: text("title").notNull(), details: text("details"), amount: real("amount"), period: text("period"), currentStage: text("current_stage").notNull(), status: text("status").notNull().default("pending"), decisionNote: text("decision_note"), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
});
export const salesCaseFiles = sqliteTable("sales_case_files", {
  id: text("id").primaryKey(), caseId: text("case_id").notNull(), uploaderEmail: text("uploader_email").notNull(), name: text("name").notNull(), storageKey: text("storage_key").notNull(), contentType: text("content_type"), size: integer("size").notNull(), createdAt: text("created_at").notNull(),
});

export const meetings = sqliteTable("meetings", {
  id: text("id").primaryKey(), title: text("title").notNull(), agenda: text("agenda"), meetingDate: text("meeting_date").notNull(),
  startTime: text("start_time").notNull(), endTime: text("end_time"), location: text("location"), organizerEmail: text("organizer_email").notNull(),
  audience: text("audience").notNull().default("management"), resultsDestination: text("results_destination"), minutes: text("minutes"),
  status: text("status").notNull().default("scheduled"), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (table) => [index("meetings_date_idx").on(table.meetingDate, table.status)]);
export const meetingAttendees = sqliteTable("meeting_attendees", {
  id: text("id").primaryKey(), meetingId: text("meeting_id").notNull().references(() => meetings.id, { onDelete: "cascade" }),
  employeeEmail: text("employee_email").notNull(), attendanceStatus: text("attendance_status").notNull().default("invited"),
});
export const meetingDecisions = sqliteTable("meeting_decisions", {
  id: text("id").primaryKey(), meetingId: text("meeting_id").notNull().references(() => meetings.id, { onDelete: "cascade" }),
  title: text("title").notNull(), ownerEmail: text("owner_email").notNull(), dueDate: text("due_date"), status: text("status").notNull().default("open"),
  notes: text("notes"), createdAt: text("created_at").notNull(),
});
export const announcements = sqliteTable("announcements", {
  id: text("id").primaryKey(), authorEmail: text("author_email").notNull(), authorName: text("author_name").notNull(), title: text("title").notNull(),
  body: text("body").notNull(), departmentScope: text("department_scope").notNull().default("all"), startsAt: text("starts_at").notNull(),
  expiresAt: text("expires_at").notNull(), status: text("status").notNull().default("published"), createdAt: text("created_at").notNull(), archivedAt: text("archived_at"),
}, (table) => [index("announcements_active_idx").on(table.status, table.startsAt, table.expiresAt)]);
export const supportRequests = sqliteTable("support_requests", {
  id: text("id").primaryKey(), requesterEmail: text("requester_email").notNull(), category: text("category").notNull(), subject: text("subject").notNull(),
  message: text("message").notNull(), status: text("status").notNull().default("open"), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
});
export const developmentPlans = sqliteTable("development_plans", {
  id: text("id").primaryKey(), employeeEmail: text("employee_email").notNull(), improvementArea: text("improvement_area").notNull(), actions: text("actions").notNull(),
  dueDate: text("due_date"), progress: integer("progress").notNull().default(0), status: text("status").notNull().default("active"), createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (table) => [index("development_employee_idx").on(table.employeeEmail, table.status)]);
export const externalReceiptReports = sqliteTable("external_receipt_reports", {
  id: text("id").primaryKey(), requesterEmail: text("requester_email").notNull(), associationId: text("association_id"), period: text("period").notNull(),
  totalAmount: real("total_amount").notNull().default(0), receiptCount: integer("receipt_count").notNull().default(0), pdfStorageKey: text("pdf_storage_key").notNull(),
  status: text("status").notNull().default("pending_accounts"), createdAt: text("created_at").notNull(),
}, (table) => [index("receipt_reports_requester_idx").on(table.requesterEmail, table.createdAt)]);
export const externalReceipts = sqliteTable("external_receipts", {
  id: text("id").primaryKey(), reportId: text("report_id").notNull().references(() => externalReceiptReports.id, { onDelete: "cascade" }),
  name: text("name").notNull(), storageKey: text("storage_key").notNull(), contentType: text("content_type"), size: integer("size").notNull(), createdAt: text("created_at").notNull(),
});
