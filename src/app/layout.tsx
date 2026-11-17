import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mimi Search AI | اكتشاف العملاء بذكاء",
  description: "منصة لاكتشاف العملاء المحتملين والطلبات التقنية وإدارة فرص المبيعات.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}