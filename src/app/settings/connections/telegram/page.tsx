import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TelegramConnectionPanel } from "@/components/telegram-connection-panel";

export const dynamic = "force-dynamic";

export default async function TelegramConnectionsPage() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/login");

  const { data: memberships } = await supabase.from("workspace_members")
    .select("workspace_id").eq("user_id", user.id).in("role", ["owner", "admin"]);
  const ids = (memberships ?? []).map(item => item.workspace_id);
  const { data: workspaces } = ids.length
    ? await supabase.from("workspaces").select("id,name").in("id", ids).order("created_at", { ascending: true })
    : { data: [] };

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl space-y-6 p-5 md:p-8">
      <header><p className="mb-2 text-sm text-slate-500">الإعدادات / مصادر البيانات</p><h1 className="text-2xl font-black md:text-3xl">مصادر البيانات</h1><p className="mt-2 text-sm leading-7 text-slate-500">إدارة اتصال Telegram واختبار البحث في المحتوى العام.</p></header>
      <TelegramConnectionPanel workspaces={workspaces ?? []}/>
      <p className="text-xs leading-6 text-slate-400">تُحفظ جلسة Telegram مشفرة على الخادم فقط. لا تظهر رموز التحقق أو كلمات مرور 2FA أو بيانات الجلسة في المتصفح.</p>
    </main>
  );
}
