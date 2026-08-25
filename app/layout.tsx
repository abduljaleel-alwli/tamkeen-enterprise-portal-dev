import type { Metadata } from "next";
import "./globals.css";
import "./sidebar-logo-refresh.css";
import "./admin-hero-mark.css";
import "./auth-controls.css";
import "./readability-responsive.css";

export const metadata: Metadata = {
  title: "بوابة بيت التمكين — البيئة التجريبية",
  description: "بيئة مستقلة للمراجعة الوظيفية والبرمجية والأمنية قبل الإطلاق",
  other: { "codex-preview": "development" },
  icons: {
    icon: [{ url: "/tamkeen-mark-flat.png", type: "image/png" }],
    shortcut: "/tamkeen-mark-flat.png",
    apple: "/tamkeen-mark-flat.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ar" dir="rtl"><body>{children}</body></html>;
}
