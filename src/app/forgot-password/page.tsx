"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ArrowRight, Mail } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email,setEmail]=useState("");
  const [error,setError]=useState("");
  const [sent,setSent]=useState(false);
  const [loading,setLoading]=useState(false);
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setError("");setLoading(true);
    try {
      const supabase=createClient();
      const {error:requestError}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:`${window.location.origin}/reset-password`});
      if(requestError)throw requestError;
      setSent(true);
    } catch(err) {setError(err instanceof Error?err.message:"تعذر إرسال رابط الاستعادة.");}
    finally {setLoading(false);}
  }
  return <main className="grid min-h-screen place-items-center p-5"><section className="w-full max-w-md rounded-3xl border border-border bg-card p-8 shadow-soft"><Link href="/login" className="mb-7 inline-flex items-center gap-2 text-sm text-slate-500"><ArrowRight size={16}/>العودة لتسجيل الدخول</Link><h1 className="text-2xl font-black">استعادة كلمة المرور</h1><p className="mt-2 text-sm leading-6 text-slate-500">أدخل بريدك الإلكتروني وسنرسل لك رابطاً آمناً لإعادة تعيين كلمة المرور.</p><form onSubmit={submit} className="mt-7 space-y-4"><label className="block text-sm font-semibold">البريد الإلكتروني<span className="mt-2 flex items-center gap-2 rounded-xl border border-border px-3"><Mail size={17} className="text-slate-400"/><input required type="email" value={email} onChange={e=>setEmail(e.target.value)} className="w-full bg-transparent py-3 outline-none" placeholder="name@example.com"/></span></label>{error&&<p role="alert" className="text-sm text-red-600">{error}</p>}{sent&&<p role="status" className="rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-700">إذا كان البريد مسجلاً، ستصلك رسالة تحتوي على رابط الاستعادة.</p>}<button disabled={loading||sent} className="w-full rounded-xl bg-primary py-3 font-bold text-white disabled:opacity-60">{loading?"جارٍ الإرسال...":"إرسال رابط الاستعادة"}</button></form></section></main>;
}