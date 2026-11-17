"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LockKeyhole } from "lucide-react";

export default function ResetPasswordPage() {
  const router=useRouter();
  const [password,setPassword]=useState("");
  const [error,setError]=useState("");
  const [done,setDone]=useState(false);
  const [loading,setLoading]=useState(false);
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setError("");setLoading(true);
    try {
      const supabase=createClient();
      const {error:updateError}=await supabase.auth.updateUser({password});
      if(updateError)throw updateError;
      setDone(true);
      setTimeout(()=>router.replace("/login"),1500);
    } catch(err) {setError(err instanceof Error?err.message:"تعذر تحديث كلمة المرور.");}
    finally {setLoading(false);}
  }
  return <main className="grid min-h-screen place-items-center p-5"><section className="w-full max-w-md rounded-3xl border border-border bg-card p-8 shadow-soft"><h1 className="text-2xl font-black">تعيين كلمة مرور جديدة</h1><p className="mt-2 text-sm text-slate-500">اختر كلمة مرور قوية لا تقل عن 8 أحرف.</p><form onSubmit={submit} className="mt-7 space-y-4"><label className="block text-sm font-semibold">كلمة المرور الجديدة<span className="mt-2 flex items-center gap-2 rounded-xl border border-border px-3"><LockKeyhole size={17} className="text-slate-400"/><input required minLength={8} type="password" value={password} onChange={e=>setPassword(e.target.value)} className="w-full bg-transparent py-3 outline-none" placeholder="8 أحرف على الأقل"/></span></label>{error&&<p role="alert" className="text-sm text-red-600">{error}</p>}{done&&<p role="status" className="text-sm text-emerald-700">تم تحديث كلمة المرور. جارٍ تحويلك لتسجيل الدخول...</p>}<button disabled={loading||done} className="w-full rounded-xl bg-primary py-3 font-bold text-white disabled:opacity-60">{loading?"جارٍ الحفظ...":"حفظ كلمة المرور"}</button></form></section></main>;
}