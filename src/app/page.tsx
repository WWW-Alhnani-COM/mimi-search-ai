import { ThemeToggle } from "@/components/theme-toggle";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  Activity, ArrowUpLeft, Bell, BriefcaseBusiness, ChartNoAxesCombined,
  CircleHelp, Compass, LayoutDashboard, Search, Settings2, ShieldCheck,
  Users, Zap,
} from "lucide-react";

const stats = [
  { label: "العملاء المحتملون", value: "0", hint: "ابدأ بإضافة أول فرصة", icon: Users },
  { label: "الفرص قيد المراجعة", value: "0", hint: "تحتاج إلى تقييم", icon: Compass },
  { label: "طلبات هذا الأسبوع", value: "0", hint: "من المصادر المرتبطة", icon: Activity },
  { label: "فرص عالية الأولوية", value: "0", hint: "حسب معايير التأهيل", icon: Zap },
];

const nav = [
  { label: "لوحة التحكم", icon: LayoutDashboard, active: true },
  { label: "اكتشاف العملاء", icon: Search },
  { label: "العملاء المحتملون", icon: Users },
  { label: "إدارة الفرص", icon: BriefcaseBusiness },
  { label: "التقارير والتحليلات", icon: ChartNoAxesCombined },
];

export default async function Home() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/login');
  }
  return (
    <main className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="border-l border-border bg-card p-5 lg:min-h-screen">
        <div className="mb-10 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-primary text-white"><Zap size={22} /></div>
          <div><div className="text-lg font-black tracking-tight">Mimi Search AI</div><div className="text-xs text-slate-500">منصة اكتشاف الفرص</div></div>
        </div>
        <div className="mb-3 px-3 text-xs font-bold text-slate-400">مساحة العمل</div>
        <div className="mb-7 rounded-xl border border-border p-3"><div className="text-sm font-bold">مساحة العمل الرئيسية</div><div className="mt-1 text-xs text-slate-500">الخطة الأساسية</div></div>
        <nav className="space-y-1">
          {nav.map(({label,icon:Icon,active}) => <a key={label} href="#" className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition ${active ? "bg-primary/10 text-primary" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"}`}><Icon size={18}/>{label}</a>)}
        </nav>
        <div className="mt-8 border-t border-border pt-5">
          <a href="#" className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-slate-500"><Settings2 size={18}/>الإعدادات</a>
          <a href="#" className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-slate-500"><CircleHelp size={18}/>المساعدة</a>
        </div>
        <div className="mt-10 rounded-2xl bg-slate-950 p-4 text-white">
          <div className="mb-2 flex items-center gap-2 text-sm font-bold"><ShieldCheck size={17}/>خصوصية وأمان</div>
          <p className="text-xs leading-6 text-slate-300">تتم مراجعة مصادر البيانات وصلاحيات الوصول قبل تفعيل أي عملية جمع.</p>
        </div>
      </aside>

      <section className="min-w-0 p-5 md:p-8">
        <header className="mb-9 flex flex-wrap items-center justify-between gap-4">
          <div><p className="mb-2 text-sm text-slate-500">مساحة العمل / لوحة التحكم</p><h1 className="text-2xl font-black md:text-3xl">نظرة عامة</h1><p className="mt-2 text-sm text-slate-500">تابع فرصك التقنية والعملاء المحتملين من مكان واحد.</p></div>
          <div className="flex items-center gap-2"><ThemeToggle/><button aria-label="الإشعارات" className="rounded-xl border border-border bg-card p-3 text-slate-500"><Bell size={18}/></button><div className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 font-bold text-primary">م</div></div>
        </header>

        <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map(({label,value,hint,icon:Icon}) => <article key={label} className="rounded-2xl border border-border bg-card p-5 shadow-soft"><div className="mb-5 flex items-center justify-between"><span className="text-sm font-semibold text-slate-500">{label}</span><span className="rounded-xl bg-primary/10 p-2 text-primary"><Icon size={19}/></span></div><div className="text-3xl font-black tabular-nums">{value}</div><p className="mt-2 text-xs text-slate-500">{hint}</p></article>)}
        </div>

        <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
          <section className="rounded-2xl border border-border bg-card p-6">
            <div className="mb-6 flex items-center justify-between"><div><h2 className="font-extrabold">ابدأ باكتشاف أول فرصة</h2><p className="mt-1 text-sm text-slate-500">أضف مصدراً أو استورد طلباً تقنياً لمراجعته.</p></div><Compass className="text-primary" size={22}/></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-dashed border-border p-5"><div className="mb-3 grid h-10 w-10 place-items-center rounded-xl bg-sky-500/10 text-sky-600"><Search size={20}/></div><h3 className="font-bold">استيراد طلب يدوي</h3><p className="mt-2 text-sm leading-6 text-slate-500">أضف رابط منشور من X أو ألصق نص الطلب لتحليله وتصنيفه.</p><button className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-primary">إضافة طلب <ArrowUpLeft size={16}/></button></div>
              <div className="rounded-xl border border-dashed border-border p-5"><div className="mb-3 grid h-10 w-10 place-items-center rounded-xl bg-violet-500/10 text-violet-600"><Users size={20}/></div><h3 className="font-bold">إدارة مصادر Telegram</h3><p className="mt-2 text-sm leading-6 text-slate-500">جهّز قائمة القنوات والمجموعات التي تملك صلاحية الوصول إليها.</p><span className="mt-4 inline-block text-xs font-bold text-slate-400">ستتوفر في مرحلة ربط المصادر</span></div>
            </div>
          </section>
          <section className="rounded-2xl border border-border bg-card p-6">
            <h2 className="font-extrabold">آخر النشاطات</h2><p className="mt-1 text-sm text-slate-500">سجل عمليات مساحة العمل</p>
            <div className="mt-8 rounded-xl bg-slate-50 p-5 text-center dark:bg-slate-900"><Activity className="mx-auto mb-3 text-slate-400" size={25}/><p className="text-sm font-semibold">لا توجد نشاطات حتى الآن</p><p className="mt-1 text-xs text-slate-500">ستظهر هنا التحديثات عند بدء استخدام المنصة.</p></div>
          </section>
        </div>
        <footer className="mt-10 border-t border-border pt-5 text-xs text-slate-400">Mimi Search AI · الإصدار التأسيسي 0.1.0</footer>
      </section>
    </main>
  );
}