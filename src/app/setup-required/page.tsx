import Link from "next/link";
import { ShieldAlert } from "lucide-react";

export default function SetupRequiredPage() {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <section className="w-full max-w-lg rounded-3xl border border-border bg-card p-8 text-center">
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-amber-500/10 text-amber-600"><ShieldAlert size={27}/></div>
        <h1 className="text-2xl font-black">يلزم إعداد بيئة التشغيل</h1>
        <p className="mt-3 text-sm leading-7 text-slate-500">لم يتم إعداد اتصال Supabase لهذا النشر. أوقفنا الوصول إلى مساحة العمل بدلاً من عرض لوحة غير متصلة أو بيانات غير حقيقية.</p>
        <p className="mt-5 text-sm text-slate-500">أضف NEXT_PUBLIC_SUPABASE_URL وNEXT_PUBLIC_SUPABASE_ANON_KEY إلى متغيرات البيئة في منصة الاستضافة، ثم أعد النشر.</p>
        <Link href="https://github.com/WWW-Alhnani-COM/mimi-search-ai#supabase-setup" className="mt-6 inline-flex rounded-xl bg-primary px-5 py-3 text-sm font-bold text-white">دليل إعداد Supabase</Link>
      </section>
    </main>
  );
}
