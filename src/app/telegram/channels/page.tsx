import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { TelegramChannelManager } from "@/components/telegram-channel-manager";
import { ArrowRight } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function TelegramChannelsPage() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/login");

  const { data: memberships } = await supabase
    .from("workspace_members")
    .select("workspace_id,role")
    .eq("user_id", user.id);

  const workspaceIds = (memberships ?? []).map((item) => item.workspace_id);
  const canManageByWorkspace = new Map((memberships ?? []).map((item) => [item.workspace_id, ["owner", "admin", "member"].includes(item.role)] as const));
  const [{ data: workspaces }, { data: countries }] = await Promise.all([
    workspaceIds.length
      ? supabase.from("workspaces").select("id,name").in("id", workspaceIds).order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    supabase.from("countries").select("code,name_ar,name_en").eq("is_active", true).order("name_ar"),
  ]);

  const workspaceOptions = (workspaces ?? []).map((workspace) => ({ ...workspace, canManage: canManageByWorkspace.get(workspace.id) ?? false }));

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl space-y-6 p-5 md:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/" className="mb-3 inline-flex items-center gap-2 text-sm text-slate-500 hover:text-primary"><ArrowRight size={16}/>لوحة التحكم</Link>
          <p className="mb-2 text-sm text-slate-500">Telegram / إدارة القنوات</p>
          <h1 className="text-2xl font-black md:text-3xl">إدارة القنوات العامة</h1>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-500">إضافة القنوات العامة ومراجعتها وإدارة قواعد تقييمها ضمن مساحة العمل المشتركة.</p>
        </div>
        <Link href="/settings/connections/telegram" className="rounded-xl border border-border bg-card px-4 py-3 text-sm font-bold hover:border-primary">إعداد اتصال Telegram</Link>
      </header>
      <TelegramChannelManager workspaces={workspaceOptions} countries={countries ?? []}/>
      <p className="text-xs leading-6 text-slate-400">هذه الواجهة لا تنضم إلى القنوات ولا تجمع منشوراتها. اعتماد القناة يسجل موافقتها ضمن قائمة المصادر فقط؛ تشغيل الجمع والاكتشاف الآلي سيكون في مرحلة مستقلة.</p>
    </main>
  );
}
