"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LoaderCircle, LockKeyhole, Mail, Zap } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) throw authError;
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تسجيل الدخول.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center p-5">
      <section className="w-full max-w-md rounded-3xl border border-border bg-card p-8 shadow-soft">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-primary text-white"><Zap size={26}/></div>
          <h1 className="text-2xl font-black">مرحباً بعودتك</h1>
          <p className="mt-2 text-sm text-slate-500">سجّل الدخول إلى Mimi Search AI</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block text-sm font-semibold">البريد الإلكتروني
            <span className="mt-2 flex items-center gap-2 rounded-xl border border-border px-3"><Mail size={17} className="text-slate-400"/><input required type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} className="w-full bg-transparent py-3 outline-none" placeholder="name@example.com"/></span>
          </label>
          <label className="block text-sm font-semibold">كلمة المرور
            <span className="mt-2 flex items-center gap-2 rounded-xl border border-border px-3"><LockKeyhole size={17} className="text-slate-400"/><input required type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} className="w-full bg-transparent py-3 outline-none" placeholder="••••••••"/></span>
          </label>
          {error && <p role="alert" className="rounded-xl bg-red-500/10 p-3 text-sm text-red-600">{error}</p>}
          <button disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-bold text-white disabled:opacity-60">{loading && <LoaderCircle className="animate-spin" size={17}/>}تسجيل الدخول</button>
        </form>
        <p className="mt-6 text-center text-sm text-slate-500"><Link href="/forgot-password" className="mb-3 block text-center font-bold text-primary">نسيت كلمة المرور؟</Link><span>ليس لديك حساب؟ </span><Link href="/signup" className="font-bold text-primary">إنشاء حساب</Link></p>
      </section>
    </main>
  );
}