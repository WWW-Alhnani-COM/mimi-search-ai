"use client";

import { FormEvent, useState } from "react";
import { LoaderCircle, Search, ShieldCheck, Send, CheckCircle2 } from "lucide-react";

type Workspace = { id: string; name: string };
type Post = { sourceUrl: string; sourceName: string | null; textContent: string; publishedAt: string | null };

export function TelegramConnectionPanel({ workspaces }: { workspaces: Workspace[] }) {
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [attemptId, setAttemptId] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false);
  const [connectionId, setConnectionId] = useState("");
  const [query, setQuery] = useState("");
  const [posts, setPosts] = useState<Post[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function postJson(url: string, body: Record<string, string>) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "REQUEST_FAILED");
    return result;
  }

  async function start(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const result = await postJson("/api/integrations/telegram/start", { workspaceId, phoneNumber });
      setAttemptId(result.attemptId);
      setMessage(result.isCodeViaApp ? "تم إرسال رمز التحقق داخل تطبيق Telegram." : "تم إرسال رمز التحقق إلى رقم الهاتف.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "تعذر بدء الربط."); }
    finally { setBusy(false); }
  }

  async function verify(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const result = await postJson("/api/integrations/telegram/verify", { attemptId, code, password });
      if (result.requiresTwoFactor) {
        setRequiresTwoFactor(true);
        setMessage("الحساب محمي بالتحقق بخطوتين. أدخل كلمة مرور Telegram 2FA.");
      } else {
        setConnectionId(result.connectionId);
        setAttemptId("");
        setRequiresTwoFactor(false);
        setMessage("تم ربط حساب Telegram وتخزين الجلسة المشفرة.");
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "تعذر التحقق."); }
    finally { setBusy(false); }
  }

  async function search(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(""); setPosts([]);
    try {
      const result = await postJson("/api/integrations/telegram/search", { workspaceId, connectionId, query });
      setPosts(result.items ?? []);
      setMessage(`اكتمل البحث. النتائج العامة المطابقة: ${result.count ?? 0}.`);
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      const messages: Record<string, string> = {
        TELEGRAM_PUBLIC_SEARCH_PAYMENT_REQUIRED: "يتطلب Telegram صلاحية أو اشتراكاً مؤهلاً لهذا البحث. لم يتم شراء Stars أو تنفيذ بحث مدفوع.",
        TELEGRAM_RATE_LIMITED: "تم تجاوز حد طلبات البحث مؤقتاً. انتظر قليلاً ثم أعد المحاولة.",
        TELEGRAM_QUERY_TOO_SHORT: "عبارة البحث قصيرة جداً. أدخل كلمتين أو أكثر.",
        TELEGRAM_SESSION_UNAUTHORIZED: "انتهت صلاحية جلسة Telegram. أعد ربط الحساب.",
        TELEGRAM_PUBLIC_SEARCH_FAILED: "تعذر تنفيذ البحث العام. راجع سجل التشخيص في Vercel لمعرفة رمز خطأ Telegram.",
      };
      setMessage(messages[code] ?? "تعذر البحث. تحقق من الاتصال ثم راجع سجل Vercel.");
    }
    finally { setBusy(false); }
  }

  if (!workspaces.length) return <div className="rounded-2xl border border-border bg-card p-6 text-sm text-slate-500">لا توجد مساحة عمل بصلاحية مالك أو مدير. يلزم دور owner أو admin لربط مصدر خارجي.</div>;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border bg-card p-5 md:p-6">
        <div className="mb-5 flex items-center gap-3"><span className="rounded-xl bg-primary/10 p-3 text-primary"><Send size={22}/></span><div><h2 className="font-extrabold">ربط حساب Telegram</h2><p className="mt-1 text-sm text-slate-500">يُستخدم الحساب للبحث في المنشورات العامة فقط.</p></div></div>
        <label className="mb-4 block text-sm font-semibold">مساحة العمل
          <select value={workspaceId} onChange={e=>setWorkspaceId(e.target.value)} className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-3">
            {workspaces.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
        {!connectionId && !attemptId && <form onSubmit={start} className="space-y-4">
          <label className="block text-sm font-semibold">رقم الهاتف بصيغة دولية
            <input required type="tel" dir="ltr" autoComplete="tel" placeholder="+9677xxxxxxxx" value={phoneNumber} onChange={e=>setPhoneNumber(e.target.value)} className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-3 text-left"/>
          </label>
          <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-bold text-white disabled:opacity-60">{busy&&<LoaderCircle size={17} className="animate-spin"/>}إرسال رمز التحقق</button>
        </form>}
        {attemptId && <form onSubmit={verify} className="space-y-4">
          <label className="block text-sm font-semibold">رمز Telegram
            <input required inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value)} className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-3"/>
          </label>
          {requiresTwoFactor && <label className="block text-sm font-semibold">كلمة مرور التحقق بخطوتين
            <input required type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-3"/>
          </label>}
          <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-bold text-white disabled:opacity-60">{busy&&<LoaderCircle size={17} className="animate-spin"/>}التحقق وربط الحساب</button>
        </form>}
        {connectionId && <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 p-4 text-sm font-semibold text-emerald-700"><CheckCircle2 size={18}/>حساب Telegram متصل</div>}
        {message && <p role="status" className="mt-4 rounded-xl border border-border bg-background p-3 text-sm">{message}</p>}
      </section>

      {connectionId && <section className="rounded-2xl border border-border bg-card p-5 md:p-6">
        <div className="mb-4 flex items-center gap-3"><Search size={21}/><h2 className="font-extrabold">اختبار البحث في المنشورات العامة</h2></div>
        <form onSubmit={search} className="flex flex-col gap-3 sm:flex-row">
          <input required minLength={2} maxLength={128} value={query} onChange={e=>setQuery(e.target.value)} placeholder="اكتب كلمة أو عبارة للبحث" className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-3"/>
          <button disabled={busy} className="rounded-xl bg-primary px-5 py-3 font-bold text-white disabled:opacity-60">بحث عام</button>
        </form>
        <div className="mt-3 flex items-start gap-2 text-xs leading-6 text-slate-500"><ShieldCheck size={15} className="mt-1 shrink-0"/>لا يتم الانضمام إلى القنوات أو الوصول إلى المحادثات الخاصة أو إرسال رسائل أو شراء بحث مدفوع.</div>
        <div className="mt-5 space-y-3">
          {posts.map((post,i)=><article key={post.sourceUrl+i} className="rounded-xl border border-border p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"><span>{post.sourceName ?? "قناة عامة"}</span>{post.publishedAt&&<time>{new Date(post.publishedAt).toLocaleString("ar")}</time>}</div>
            <p className="whitespace-pre-wrap text-sm leading-7">{post.textContent}</p>
            <a href={post.sourceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs font-bold text-primary">فتح المنشور في Telegram</a>
          </article>)}
        </div>
      </section>}
    </div>
  );
}
