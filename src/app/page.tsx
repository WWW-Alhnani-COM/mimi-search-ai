import { ThemeToggle } from "@/components/theme-toggle";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Activity, Bell, BriefcaseBusiness, ChartNoAxesCombined, CircleHelp, Compass, LayoutDashboard, Search, Settings2, Send, ShieldCheck, Users, Zap } from "lucide-react";

export const dynamic = "force-dynamic";

const futureModules = [
  { label: "اكتشاف العملاء", icon: Search },
  { label: "العملاء المحتملون", icon: Users },
  { label: "إدارة الفرص", icon: BriefcaseBusiness },
  { label: "التقارير والتحليلات", icon: ChartNoAxesCombined },
];

export default async function Home() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/login");

  return (
    <main className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="border-l border-border bg-card p-5 lg:min-h-screen">
        <div className="mb-10 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-primary text-white"><Zap size={22} /></div>
          <div><div className="text-lg font-black tracking-tight">Mimi Search AI</div><div className="text-xs text-slate-500">منصة اكتشاف الفرص</div></div>
        </div>
        <div className="mb-3 px-3 text-xs font-bold text-slate-400">مساحة العمل</div>
        <div className="mb-7 rounded-xl border border-border p-3"><div className="text-sm font-bold">مساحة العمل</div><div className="mt-1 truncate text-xs text-slate-500">{user.email ?? "حساب موثّق"}</div></div>
        <nav className="space-y-1">
          <div className="flex items-center gap-3 rounded-xl bg-primary/10 px-3 py-3 text-sm font-semibold text-primary"><LayoutDashboard size={18}/>لوحة التحكم</div>
          {futureModules.map(({ label, icon: Icon }) => <div key={label} aria-disabled="true" className="flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-3 text-sm text-slate-400"><Icon size={18}/>{label}<span className="mr-auto text-[10px]">قريباً</span></div>)}
        </nav>
        <div className="mt-8 border-t border-border pt-5">
          <Link href="/telegram/channels" className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold hover:bg-primary/10 hover:text-primary"><Send size={18}/>إدارة قنوات Telegram</Link>
          <Link href="/settings/connections/telegram" className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold hover:bg-primary/10 hover:text-primary"><Settings2 size={18}/>مصادر البيانات · Telegram</Link>
          <div className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-slate-400"><CircleHelp size={18}/>المساعدة · قريباً</div>
        </div>
        <div className="mt-10 rounded-2xl bg-slate-950 p-4 text-white">
          <div className="mb-2 flex items-center gap-2 text-sm font-bold"><ShieldCheck size={17}/>خصوصية وأمان</div>
          <p className="text-xs leading-6 text-slate-300">لن يتم جمع بيانات من مصدر قبل إعداد الاتصال والتحقق من صلاحية الوصول إليه.</p>
        </div>
      </aside>
      <section className="min-w-0 p-5 md:p-8">
        <header className="mb-9 flex flex-wrap items-center justify-between gap-4">
          <div><p className="mb-2 text-sm text-slate-500">مساحة العمل / لوحة التحكم</p><h1 className="text-2xl font-black md:text-3xl">نظرة عامة</h1><p className="mt-2 text-sm text-slate-500">مساحة عملك جاهزة لاستقبال البيانات الحقيقية بعد تفعيل وحدات المنتج.</p></div>
          <div className="flex items-center gap-2"><ThemeToggle/><span aria-label="الإشعارات غير مفعلة" className="rounded-xl border border-border bg-card p-3 text-slate-400"><Bell size={18}/></span></div>
        </header>
        <section className="rounded-2xl border border-border bg-card p-6">
          <div className="mb-5 flex items-center gap-3"><span className="rounded-xl bg-primary/10 p-3 text-primary"><Compass size={22}/></span><div><h2 className="font-extrabold">لا توجد بيانات بعد</h2><p className="mt-1 text-sm text-slate-500">لم يتم ربط أي مصدر أو استيراد طلبات إلى مساحة العمل.</p></div></div>
          <div className="rounded-xl border border-dashed border-border p-5">
            <div className="flex items-center gap-2 text-sm font-bold"><Activity size={17}/>حالة النظام</div>
            <p className="mt-2 text-sm leading-7 text-slate-500">هذه النسخة لا تعرض أرقاماً تقديرية أو سجلات تجريبية. ستظهر مؤشرات العملاء والفرص فقط بعد تنفيذ وحدات الجمع والتخزين وربطها بقاعدة البيانات.</p>
            <p className="mt-3 text-xs text-slate-400">أصبحت إدارة قنوات Telegram متاحة. أما الاكتشاف الآلي وجمع المنشورات وX وإدارة CRM فلم تُفعّل بعد.</p>
          </div>
        </section>
        <footer className="mt-10 border-t border-border pt-5 text-xs text-slate-400">Mimi Search AI · الإصدار التأسيسي</footer>
      </section>
    </main>
  );
}
