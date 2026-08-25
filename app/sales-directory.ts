export type SalesDirectoryEntry = {
  name: string;
  email?: string;
  jobTitle: string;
  association: string;
  supervisor: "محمد الراشدي" | "صالح بن سعد";
  organization: "بيت التمكين" | "مؤسسة معين";
};

/** بيانات وهمية مخصصة للبيئة التجريبية، ولا تتضمن بيانات الموظفين الفعلية. */
export const salesDirectory: SalesDirectoryEntry[] = [
  {
    name: "مختص مبيعات تجريبي",
    email: "qa.sales@example.com",
    jobTitle: "مختص المبيعات",
    association: "جمعية تجريبية",
    supervisor: "محمد الراشدي",
    organization: "بيت التمكين",
  },
  {
    name: "مختص معين التجريبي",
    jobTitle: "مختص المبيعات",
    association: "جمعية معين التجريبية",
    supervisor: "صالح بن سعد",
    organization: "مؤسسة معين",
  },
];

export function salesDirectoryForEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  return salesDirectory.find((entry) => entry.email?.toLowerCase() === normalized);
}
