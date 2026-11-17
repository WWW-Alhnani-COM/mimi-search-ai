"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LoaderCircle, Mail, UserRound, LockKeyhole, Zap } from "lucide-react";

export default function SignupPage() {
  const router = useRouter();
  const [name,setName]=useState("");
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [loading,setLoading]=useState(false);

  async function handleSubmit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setMessage(""); setLoading(true);
    try {
      const supabase=createClient();
      const {data,error:authError}=await supabase.auth.signUp({
        email,password,options:{data:{full_name:name},emailRedirectTo:`${window.location.origin}/auth/callback`}
      });
      if(authError) throw authError;
      if(data.session){router.replace("/");router.refresh();}
      else setMessage("تم إنشاء الحساب. تحقق من بريدك الإلكتروني لتأكيد التسجيل.");
    } catch(err) {
      setError(err instanceof Error?err.message:"تعذر إنشاء الحساب.");
    } finally {setLoading(false);}
  }

  return <main className="grid min-h-screen place-items-center p-5"><section className="w-full max-w-md rounded-3xl border border-border bg-card p-8 shadow-soft">
    <div className="mb-8 text-center"><div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-primary text-white"><Zap size={26}/></div><h1 className="text-2xl font-black">إنشاء حساب جديد</h1><p className="mt-2 text-sm text-slate-500">ابدأ بتنظيم فرصك وعملائك المحتملين</p></div>
    <form onSubmit={handleSubmit} className="space-y-4">
      <label className="block text-sm font-semibold">الاسم الكامل<span className="mt-2 flex items-center gap-2 rounded-xl border border-border px-3"><UserRound size={17} className="text-slate-400"/><input required value={name} onChange={e=>setName(e.target.value)} className="w-full bg-transparent py-3 outline-none" placeholder="الاسم"/></span></label>
      <label className="block text-sm font-semibold">البريد الإلكتروني<span className="mt-2 flex items-center gap-2 rounded-xl border border-border px-3"><Mail size={17} className="text-slate-400"/><input required type="email" value={email} onChange={e=>setEmail(e.target.value)} className="w-full bg-transparent py-3 outline-none" placeholder="name@example.com"/></span></label>
      <label className="block text-sm font-semibold">كلمة المرور<span className="mt-2 flex items-center gap-2 rounded-xl border border-border px-3"><LockKeyhole size={17} className="text-slate-400"/><input required minLength={8} type="password" value={password} onChange={e=>setPassword(e.target.value)} className="w-full bg-transparent py-3 outline-none" placeholder="8 أحرف على الأقل"/></span></label>
      {error&&<p role="alert" className="rounded-xl bg-red-500/10 p-3 text-sm text-red-600">{error}</p>}
      {message&&<p role="status" className="rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-700">{message}</p>}
      <button disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-bold text-white disabled:opacity-60">{loading&&<LoaderCircle className="animate-spin" size={17}/>}إنشاء الحساب</button>
    </form>
    <p className="mt-6 text-center text-sm text-slate-500">لديك حساب؟ <Link href="/login" className="font-bold text-primary">تسجيل الدخول</Link></p>
  </section></main>;
}