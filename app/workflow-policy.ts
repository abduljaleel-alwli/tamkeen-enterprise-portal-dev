import type { RosterEmployee } from "./employee-roster";

export const GENERAL_MANAGER_EMAIL = "m.s.g.sh.93@gmail.com";
export const DEPUTY_EXECUTIVE_EMAIL = "baitaltamkeen@gmail.com";
export const EXECUTIVE_DIRECTOR_EMAIL = "mr.isaac.es@gmail.com";
export const HEAD_OF_SALES_EMAIL = "binhameedh@gmail.com";
export const HEAD_OF_ACCOUNTS_EMAIL = "hashedi2050@gmail.com";

export type WorkflowKind =
  | "content_approval"
  | "sales_monthly_plan"
  | "sales_monthly_report"
  | "department_report"
  | "sales_target"
  | "commission_policy"
  | "budget_request";

export const workflowLabels: Record<WorkflowKind, string> = {
  content_approval: "محتوى جاهز للنشر",
  sales_monthly_plan: "خطة شهرية لمختص المبيعات",
  sales_monthly_report: "تقرير شهري لمختص المبيعات",
  department_report: "تقرير رئيس قسم",
  sales_target: "مستهدف مبيعات شهري أو سنوي",
  commission_policy: "سياسة عمولات",
  budget_request: "طلب ميزانية قسم",
};

export function authorityFor(actor: RosterEmployee) {
  const email = actor.email;
  const isGeneralManager = email === GENERAL_MANAGER_EMAIL;
  const isDeputyExecutive = email === DEPUTY_EXECUTIVE_EMAIL;
  const isExecutiveDirector = email === EXECUTIVE_DIRECTOR_EMAIL;
  const isExecutiveManagement = isDeputyExecutive || isExecutiveDirector;
  const isHeadOfSales = email === HEAD_OF_SALES_EMAIL;
  const isHeadOfAccounts = email === HEAD_OF_ACCOUNTS_EMAIL;
  const isSalesSupervisor = actor.role === "supervisor" && actor.department === "المبيعات";
  const isGeneralManagerSecretary = actor.jobTitle.includes("سكرتير المدير العام");
  const isDepartmentHead = actor.role === "department_head" || isDeputyExecutive;
  const isSalesSpecialist = actor.department === "المبيعات" && actor.role === "employee";
  const createKinds: WorkflowKind[] = [];
  if (isSalesSpecialist) createKinds.push("content_approval", "sales_monthly_plan", "sales_monthly_report");
  if (isDepartmentHead) createKinds.push("department_report", "budget_request");
  if (isGeneralManagerSecretary) createKinds.push("budget_request");
  if (isHeadOfSales) createKinds.push("sales_target", "commission_policy");
  return {
    isGeneralManager,
    isDeputyExecutive,
    isExecutiveDirector,
    isExecutiveManagement,
    isHeadOfSales,
    isHeadOfAccounts,
    isSalesSupervisor,
    isGeneralManagerSecretary,
    isDepartmentHead,
    isSalesSpecialist,
    createKinds: [...new Set(createKinds)],
  };
}

export function initialStage(kind: WorkflowKind, gmRequested: boolean) {
  if (kind === "content_approval" || kind === "sales_monthly_plan" || kind === "sales_monthly_report") return "sales_supervisor";
  if (kind === "sales_target" || kind === "commission_policy") return "general_manager";
  if (kind === "budget_request") return "executive_management";
  return gmRequested ? "general_manager" : "executive_management";
}

export function canActAtStage(actor: RosterEmployee, stage: string) {
  const authority = authorityFor(actor);
  if (stage === "sales_supervisor") return authority.isSalesSupervisor;
  if (stage === "sales_head") return authority.isHeadOfSales;
  if (stage === "executive_management") return authority.isExecutiveManagement;
  if (stage === "general_manager") return authority.isGeneralManager;
  if (stage === "accounts_copy") return authority.isHeadOfAccounts;
  return false;
}

export function nextStage(kind: WorkflowKind, currentStage: string) {
  if (currentStage === "sales_supervisor") return kind === "content_approval" ? "completed" : "sales_head";
  if (currentStage === "sales_head") return "completed";
  if (currentStage === "executive_management") return kind === "budget_request" ? "general_manager" : "completed";
  if (currentStage === "general_manager") return "completed";
  if (currentStage === "accounts_copy") return "completed";
  return "completed";
}

export const roleBlueprints = {
  head_sales: {
    title: "بطاقة تشغيل رئيس قسم المبيعات",
    responsibilities: ["متابعة المستهدفات وحل عوائق الفريق يوميًا", "مراجعة المحتوى بعد اعتماد المشرف", "اعتماد خطط المشرف ومراجعة تقارير المختصين", "رفع ميزانية القسم والتقرير الشهري", "رفع المستهدفات وسياسة العمولات للمدير العام"],
    kpis: ["نسبة تحقيق المستهدف الشهري والسنوي", "معدل التحصيل والإيرادات", "نسبة تنفيذ الخطط التسويقية", "زمن معالجة عوائق الفريق", "انتظام التقارير والميزانية والعمولات"],
  },
  head_accounts: {
    title: "بطاقة تشغيل رئيس قسم الحسابات",
    responsibilities: ["مراجعة القيود والمقبوضات والمدفوعات يوميًا", "المطابقات البنكية ومراجعة الفواتير", "مراجعة الرواتب والعمولات وصرفها", "إعداد التقارير والإقفالات والإقرارات", "حفظ النسخ المعتمدة للمستهدفات والعمولات والميزانية"],
    kpis: ["دقة القيود والمطابقات", "الالتزام بمواعيد الرواتب والعمولات", "نسبة التحصيل قبل اليوم العاشر", "الالتزام بالإقفال والتقارير الدورية", "سلامة المستندات والامتثال الضريبي"],
  },
};
