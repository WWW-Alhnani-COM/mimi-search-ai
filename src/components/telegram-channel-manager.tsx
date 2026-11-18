"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { Archive, Check, CirclePause, LoaderCircle, Plus, RefreshCw, Search, Settings2, SlidersHorizontal, Trash2 } from "lucide-react";

type Workspace = { id: string; name: string; canManage: boolean };
type DiscoverySource = { channel_id: string; source_kind: string; source_url: string | null; search_query: string | null; discovered_at: string };
type Country = { code: string; name_ar: string; name_en: string };
type Channel = {
  id: string; workspace_id: string; username: string | null; title: string | null; about: string | null; collection_enabled: boolean;
  public_url: string | null; status: string; country_code: string | null; city_id: string | null;
  category: string | null; discovery_method: string; evaluation_score: number | null; created_at: string;
};
type Rule = { id: string; rule_type: "include" | "exclude"; match_type: string; rule_value: string; country_code: string | null; enabled: boolean; priority: number };
type Settings = { discovery_enabled: boolean; schedule_interval: string; auto_approve_enabled: boolean; minimum_approval_score: number; default_history_days: number; ai_enabled: boolean; ai_provider: "local" | "gemini"; ai_model: string; ai_daily_request_limit: number };
type City = { id: string; country_code: string; name_ar: string };

const statusLabels: Record<string, string> = {
  candidate: "مرشحة", review: "قيد المراجعة", approved: "معتمدة",
  rejected: "مرفوضة", paused: "متوقفة", archived: "مؤرشفة",
};
const statusStyles: Record<string, string> = {
  candidate: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  review: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  approved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  rejected: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
  paused: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200",
  archived: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};
const initialSettings: Settings = {
  discovery_enabled: false, schedule_interval: "daily", auto_approve_enabled: false,
  minimum_approval_score: 85, default_history_days: 10,
  ai_enabled: false, ai_provider: "local", ai_model: "gemini-2.5-flash-lite", ai_daily_request_limit: 50,
};

export function TelegramChannelManager({ workspaces, countries }: { workspaces: Workspace[]; countries: Country[] }) {
  const supabase = useMemo(() => createClient(), []);
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [sources, setSources] = useState<DiscoverySource[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [aiUsage, setAiUsage] = useState({ requests: 0, input_tokens: 0, output_tokens: 0 });
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [tab, setTab] = useState<"channels" | "rules" | "settings">("channels");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [title, setTitle] = useState("");
  const [usernameInput, setUsernameInput] = useState("");
  const [about, setAbout] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [cityId, setCityId] = useState("");
  const [category, setCategory] = useState("");
  const [ruleType, setRuleType] = useState<"include" | "exclude">("include");
  const [matchType, setMatchType] = useState("contains");
  const [ruleValue, setRuleValue] = useState("");
  const [ruleCountry, setRuleCountry] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [collectingChannelId, setCollectingChannelId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true); setError("");
    const [channelResult, ruleResult, settingsResult, cityResult, sourceResult] = await Promise.all([
      supabase.from("telegram_channels").select("id,workspace_id,username,title,about,public_url,status,country_code,city_id,category,discovery_method,evaluation_score,collection_enabled,created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
      supabase.from("telegram_channel_rules").select("id,rule_type,match_type,rule_value,country_code,enabled,priority").eq("workspace_id", workspaceId).order("priority"),
      supabase.from("telegram_discovery_settings").select("discovery_enabled,schedule_interval,auto_approve_enabled,minimum_approval_score,default_history_days,ai_enabled,ai_provider,ai_model,ai_daily_request_limit").eq("workspace_id", workspaceId).maybeSingle(),
      supabase.from("cities").select("id,country_code,name_ar").order("name_ar"),
      supabase.from("telegram_channel_discovery_sources").select("channel_id,source_kind,source_url,search_query,discovered_at").eq("workspace_id", workspaceId).order("discovered_at", { ascending: false }),
    ]);
    const firstError = channelResult.error ?? ruleResult.error ?? settingsResult.error ?? cityResult.error ?? sourceResult.error;
    if (firstError) setError("تعذر تحميل بيانات إدارة القنوات. تحقق من تطبيق ترحيل قاعدة البيانات وصلاحيات مساحة العمل.");
    setChannels((channelResult.data ?? []) as Channel[]);
    setSources((sourceResult.data ?? []) as DiscoverySource[]);
    setRules((ruleResult.data ?? []) as Rule[]);
    setSettings(settingsResult.data ? { ...initialSettings, ...settingsResult.data } : initialSettings);
    setCities((cityResult.data ?? []) as City[]);
    const usageDate = new Date().toISOString().slice(0, 10);
    const { data: usage } = await supabase.from("telegram_ai_usage")
      .select("requests,input_tokens,output_tokens").eq("workspace_id", workspaceId).eq("usage_date", usageDate).maybeSingle();
    setAiUsage(usage ?? { requests: 0, input_tokens: 0, output_tokens: 0 });
    setLoading(false);
  }, [supabase, workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const filteredChannels = useMemo(() => channels.filter((channel) => {
    const matchesStatus = statusFilter === "all" || channel.status === statusFilter;
    const term = search.trim().toLowerCase();
    const matchesSearch = !term || [channel.title, channel.username, channel.category, channel.about]
      .some((value) => value?.toLowerCase().includes(term));
    return matchesStatus && matchesSearch;
  }), [channels, search, statusFilter]);

  const visibleCities = cities.filter((city) => city.country_code === countryCode);
  const canManage = workspaces.find((workspace) => workspace.id === workspaceId)?.canManage ?? false;
  const counts = useMemo(() => ({
    all: channels.length,
    candidate: channels.filter((item) => item.status === "candidate").length,
    review: channels.filter((item) => item.status === "review").length,
    approved: channels.filter((item) => item.status === "approved").length,
  }), [channels]);

  async function startDiscovery() {
    setDiscovering(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/telegram/discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = result.error === "DISCOVERY_ALREADY_QUEUED"
          ? "توجد عملية اكتشاف قيد الانتظار بالفعل."
          : result.error === "WORKSPACE_FORBIDDEN"
            ? "لا تملك صلاحية تشغيل الاكتشاف في مساحة العمل."
            : "تعذر وضع عملية الاكتشاف في قائمة المهام.";
        throw new Error(message);
      }
      setMessage(result.alreadyQueued
        ? "عملية الاكتشاف موجودة بالفعل في قائمة المهام."
        : "تمت إضافة عملية اكتشاف القنوات إلى قائمة المهام. ستبدأ عند تشغيل العامل الخلفي.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر طلب اكتشاف القنوات.");
    } finally {
      setDiscovering(false);
    }
  }

  async function toggleScheduledCollection(channel: Channel) {
    setSaving(true); setError(""); setMessage("");
    const { error: updateError } = await supabase.from("telegram_channels")
      .update({ collection_enabled: !channel.collection_enabled, updated_at: new Date().toISOString() })
      .eq("id", channel.id).eq("workspace_id", workspaceId);
    if (updateError) setError("تعذر تحديث إعداد الجمع الدوري.");
    else {
      setMessage(channel.collection_enabled ? "تم إيقاف الجمع الدوري لهذه القناة." : "تم تفعيل الجمع الدوري لهذه القناة.");
      await load();
    }
    setSaving(false);
  }

  async function startCollection(channel: Channel) {
    setCollectingChannelId(channel.id); setError(""); setMessage("");
    try {
      const response = await fetch("/api/telegram/collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, channelId: channel.id }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = result.error === "CHANNEL_NOT_APPROVED"
          ? "يجب اعتماد القناة قبل جمع منشوراتها."
          : result.error === "WORKSPACE_FORBIDDEN"
            ? "لا تملك صلاحية تشغيل الجمع في مساحة العمل."
            : "تعذر وضع مهمة جمع المنشورات في قائمة الانتظار.";
        throw new Error(message);
      }
      setMessage(result.alreadyQueued
        ? "توجد مهمة جمع منشورات لهذه القناة بالفعل."
        : "تمت إضافة مهمة جمع منشورات القناة إلى قائمة الانتظار.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر طلب جمع المنشورات.");
    } finally {
      setCollectingChannelId(null);
    }
  }

  async function addChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage(""); setError("");
    const raw = usernameInput.trim();
    let username = raw.replace(/^@/, "");
    if (raw.includes("://") || /^www\.t\.me\//i.test(raw) || /^t\.me\//i.test(raw)) {
      try {
        const parsed = new URL(raw.startsWith("http") ? raw : "https://" + raw);
        const segments = parsed.pathname.split("/").filter(Boolean);
        if (!["t.me", "www.t.me"].includes(parsed.hostname.toLowerCase()) || segments.length !== 1) throw new Error("INVALID_PUBLIC_CHANNEL_URL");
        username = segments[0];
      } catch { username = ""; }
    }
    if (!/^[a-zA-Z0-9_]{5,32}$/.test(username)) {
      setError("أدخل اسم مستخدم عام صحيحاً أو رابطاً من نوع t.me/username.");
      setSaving(false); return;
    }
    try {
      const { data: auth } = await supabase.auth.getUser();
      const publicUrl = `https://t.me/${username}`;
      const { data, error: insertError } = await supabase.from("telegram_channels").insert({
        workspace_id: workspaceId, username, title: title.trim() || null, about: about.trim() || null,
        public_url: publicUrl, status: "review", discovery_method: "manual",
        country_code: countryCode || null, city_id: cityId || null, category: category.trim() || null,
        created_by: auth.user?.id ?? null,
      }).select("id").single();
      if (insertError) throw insertError;
      const { error: sourceError } = await supabase.from("telegram_channel_discovery_sources").insert({
        workspace_id: workspaceId, channel_id: data.id, source_kind: "manual", source_url: publicUrl,
        source_metadata: { submitted_by: "workspace_user" },
      });
      if (sourceError) {
        await supabase.from("telegram_channels").delete().eq("id", data.id).eq("workspace_id", workspaceId);
        throw sourceError;
      }
      setMessage("تمت إضافة القناة إلى قائمة المراجعة.");
      setTitle(""); setUsernameInput(""); setAbout(""); setCountryCode(""); setCityId(""); setCategory("");
      await load();
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
      setError(code === "23505" ? "هذه القناة مسجلة بالفعل في مساحة العمل." : "تعذرت إضافة القناة. تحقق من صلاحية التحرير ومن صحة اسم المستخدم.");
    } finally { setSaving(false); }
  }

  async function changeStatus(channel: Channel, nextStatus: string) {
    setSaving(true); setError(""); setMessage("");
    const { data: auth } = await supabase.auth.getUser();
    const patch: Record<string, unknown> = { status: nextStatus, updated_at: new Date().toISOString() };
    if (nextStatus === "approved") { patch.approved_at = new Date().toISOString(); patch.approved_by = auth.user?.id ?? null; }
    else { patch.approved_at = null; patch.approved_by = null; }
    const { error: updateError } = await supabase.from("telegram_channels").update(patch).eq("id", channel.id).eq("workspace_id", workspaceId);
    if (updateError) setError("تعذر تحديث حالة القناة. تحقق من صلاحية التحرير.");
    else { setMessage(`تم تحديث حالة القناة إلى: ${statusLabels[nextStatus] ?? nextStatus}.`); await load(); }
    setSaving(false);
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(""); setMessage("");
    const { data: auth } = await supabase.auth.getUser();
    const { error: saveError } = await supabase.from("telegram_discovery_settings").upsert({
      workspace_id: workspaceId, ...settings, updated_by: auth.user?.id ?? null, updated_at: new Date().toISOString(),
    }, { onConflict: "workspace_id" });
    if (saveError) setError("تعذر حفظ إعدادات مساحة العمل. تحقق من صلاحية التحرير.");
    else setMessage("تم حفظ إعدادات الاكتشاف المشتركة. لم يتم تشغيل أي عملية اكتشاف.");
    setSaving(false);
  }

  async function addRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(""); setMessage("");
    const { data: auth } = await supabase.auth.getUser();
    const { error: insertError } = await supabase.from("telegram_channel_rules").insert({
      workspace_id: workspaceId, rule_type: ruleType, match_type: matchType, rule_value: ruleValue.trim(),
      country_code: ruleCountry || null, created_by: auth.user?.id ?? null,
    });
    if (insertError) setError(insertError.code === "23505" ? "هذه القاعدة موجودة بالفعل." : "تعذرت إضافة القاعدة. تحقق من صلاحية التحرير.");
    else { setRuleValue(""); setMessage("تمت إضافة القاعدة."); await load(); }
    setSaving(false);
  }

  async function toggleRule(rule: Rule) {
    setSaving(true);
    const { error: updateError } = await supabase.from("telegram_channel_rules").update({ enabled: !rule.enabled, updated_at: new Date().toISOString() }).eq("id", rule.id).eq("workspace_id", workspaceId);
    if (updateError) setError("تعذر تحديث القاعدة.");
    else await load();
    setSaving(false);
  }

  async function deleteRule(rule: Rule) {
    if (!window.confirm("هل تريد حذف هذه القاعدة؟")) return;
    setSaving(true);
    const { error: deleteError } = await supabase.from("telegram_channel_rules").delete().eq("id", rule.id).eq("workspace_id", workspaceId);
    if (deleteError) setError("تعذر حذف القاعدة.");
    else { setMessage("تم حذف القاعدة."); await load(); }
    setSaving(false);
  }

  if (!workspaces.length) return <section className="rounded-2xl border border-border bg-card p-6 text-sm leading-7 text-slate-500">لا توجد مساحة عمل مرتبطة بحسابك.</section>;

  return <div className="space-y-5">
    <section className="rounded-2xl border border-border bg-card p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="min-w-0 flex-1 text-sm font-bold">مساحة العمل
          <select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} className="mt-2 block w-full rounded-xl border border-border bg-background px-3 py-3">
            {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => void load()} disabled={loading} className="mt-6 inline-flex items-center gap-2 rounded-xl border border-border px-4 py-3 text-sm font-semibold"><RefreshCw size={16} className={loading ? "animate-spin" : ""}/>تحديث</button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[["كل القنوات", counts.all], ["مرشحة", counts.candidate], ["قيد المراجعة", counts.review], ["معتمدة", counts.approved]].map(([label, value]) => <div key={label} className="rounded-xl bg-background p-4"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 text-2xl font-black tabular-nums">{value}</div></div>)}
      </div>
    </section>

    <div className="flex flex-wrap gap-2" role="tablist" aria-label="إدارة القنوات">
      <button type="button" onClick={() => setTab("channels")} className={`rounded-xl px-4 py-3 text-sm font-bold ${tab === "channels" ? "bg-primary text-white" : "border border-border bg-card"}`}>القنوات والمرشحون</button>
      <button type="button" onClick={() => setTab("rules")} className={`rounded-xl px-4 py-3 text-sm font-bold ${tab === "rules" ? "bg-primary text-white" : "border border-border bg-card"}`}>قواعد التقييم</button>
      <button type="button" onClick={() => setTab("settings")} className={`rounded-xl px-4 py-3 text-sm font-bold ${tab === "settings" ? "bg-primary text-white" : "border border-border bg-card"}`}>إعدادات الاكتشاف</button>
    </div>

    {error && <p role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">{error}</p>}
    {message && <p role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">{message}</p>}
    {loading && <div className="flex items-center gap-2 text-sm text-slate-500"><LoaderCircle size={17} className="animate-spin"/>جارٍ تحميل بيانات مساحة العمل…</div>}

    {tab === "channels" && <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="min-w-0 rounded-2xl border border-border bg-card p-4 md:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="font-extrabold">قائمة القنوات</h2><div className="flex items-center gap-2"><span className="text-xs text-slate-500">{filteredChannels.length} قناة</span>{canManage && <button type="button" onClick={() => void startDiscovery()} disabled={discovering || saving} className="inline-flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-xs font-bold text-white disabled:opacity-50"><Search size={14}/>{discovering ? "جارٍ الإرسال…" : "اكتشاف قنوات"}</button>}</div></div>
        <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_180px]">
          <label className="relative"><Search size={16} className="absolute right-3 top-3.5 text-slate-400"/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث بالاسم أو المستخدم أو المجال" className="w-full rounded-xl border border-border bg-background py-3 pr-9 pl-3 text-sm"/></label>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-xl border border-border bg-background px-3 py-3 text-sm"><option value="all">كل الحالات</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        </div>
        {filteredChannels.length === 0 && !loading ? <div className="rounded-xl border border-dashed border-border p-8 text-center"><SlidersHorizontal className="mx-auto mb-3 text-slate-400"/><p className="font-bold">لا توجد قنوات مطابقة</p><p className="mt-2 text-sm text-slate-500">أضف قناة عامة يدوياً لتظهر هنا ضمن قائمة المراجعة.</p></div> :
          <div className="space-y-3">{filteredChannels.map((channel) => <article key={channel.id} className="rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0"><div className="font-bold">{channel.title || (channel.username ? `@${channel.username}` : "قناة عامة")}</div><div className="mt-1 text-xs text-slate-500" dir="ltr">{channel.username ? `@${channel.username}` : "اسم المستخدم غير متاح"}</div>{channel.category && <div className="mt-2 text-xs text-slate-500">{channel.category}</div>}</div>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusStyles[channel.status] ?? statusStyles.candidate}`}>{statusLabels[channel.status] ?? channel.status}</span>
            </div>
            {channel.about && <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-500">{channel.about}</p>}
            {(() => { const source = sources.find((item) => item.channel_id === channel.id); return source ? <p className="mt-2 text-xs text-slate-400">مصدر الإضافة: {source.source_kind === "manual" ? "إضافة يدوية" : source.source_kind} {source.source_url ? <a href={source.source_url} target="_blank" rel="noreferrer" className="text-primary underline">عرض المصدر</a> : null}</p> : null; })()}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
              <div className="text-xs text-slate-400">{channel.country_code ?? "دون تحديد دولة"} · {channel.evaluation_score === null ? "لم تُقيّم بعد" : `التقييم ${channel.evaluation_score}/100`}</div>
              <div className="flex flex-wrap gap-2">
                {channel.public_url && <a href={channel.public_url} target="_blank" rel="noreferrer" className="rounded-lg border border-border px-3 py-2 text-xs font-semibold">فتح القناة</a>}\n                {canManage && channel.status === "approved" && <button type="button" disabled={Boolean(collectingChannelId) || saving} onClick={() => void startCollection(channel)} className="rounded-lg border border-primary px-3 py-2 text-xs font-semibold text-primary disabled:opacity-50">{collectingChannelId === channel.id ? "جارٍ الإرسال…" : "جمع المنشورات"}</button>}\n                {canManage && channel.status === "approved" && <button type="button" disabled={saving} onClick={() => void toggleScheduledCollection(channel)} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold disabled:opacity-50">{channel.collection_enabled ? "إيقاف الجمع الدوري" : "تفعيل الجمع الدوري"}</button>}
                {canManage && channel.status !== "approved" && <button type="button" disabled={saving} onClick={() => void changeStatus(channel, "approved")} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"><Check size={14}/>اعتماد</button>}
                {canManage && channel.status !== "rejected" && <button type="button" disabled={saving} onClick={() => void changeStatus(channel, "rejected")} className="rounded-lg border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-700 disabled:opacity-50">رفض</button>}
                {canManage && channel.status !== "paused" && channel.status !== "archived" && <button type="button" disabled={saving} onClick={() => void changeStatus(channel, "paused")} title="إيقاف" className="rounded-lg border border-border p-2 text-slate-500 disabled:opacity-50"><CirclePause size={15}/></button>}
                {canManage && channel.status !== "archived" && <button type="button" disabled={saving} onClick={() => void changeStatus(channel, "archived")} title="أرشفة" className="rounded-lg border border-border p-2 text-slate-500 disabled:opacity-50"><Archive size={15}/></button>}
                {canManage && (channel.status === "paused" || channel.status === "rejected" || channel.status === "archived") && <button type="button" disabled={saving} onClick={() => void changeStatus(channel, "review")} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold">إعادة للمراجعة</button>}
              </div>
            </div>
          </article>)}</div>}
      </section>

      {canManage && <section className="h-fit rounded-2xl border border-border bg-card p-4 md:p-5">
        <div className="mb-4 flex items-center gap-2"><Plus size={18} className="text-primary"/><h2 className="font-extrabold">إضافة قناة عامة</h2></div>
        <form onSubmit={addChannel} className="space-y-3">
          <label className="block text-sm font-semibold">رابط القناة أو اسم المستخدم
            <input required value={usernameInput} onChange={(event) => setUsernameInput(event.target.value)} placeholder="https://t.me/channelname" className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-3 text-left text-sm" dir="ltr"/>
          </label>
          <label className="block text-sm font-semibold">اسم القناة (اختياري)
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-3 text-sm"/>
          </label>
          <label className="block text-sm font-semibold">وصف مختصر (اختياري)
            <textarea value={about} onChange={(event) => setAbout(event.target.value)} maxLength={1000} rows={3} className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-3 text-sm"/>
          </label>
          <label className="block text-sm font-semibold">المجال (اختياري)
            <input value={category} onChange={(event) => setCategory(event.target.value)} maxLength={80} placeholder="مثال: عقارات، تقنية، مقاولات" className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-3 text-sm"/>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm font-semibold">الدولة
              <select value={countryCode} onChange={(event) => { setCountryCode(event.target.value); setCityId(""); }} className="mt-2 w-full rounded-xl border border-border bg-background px-2 py-3 text-sm"><option value="">غير محددة</option>{countries.map((country) => <option key={country.code} value={country.code}>{country.name_ar}</option>)}</select>
            </label>
            <label className="text-sm font-semibold">المدينة
              <select value={cityId} onChange={(event) => setCityId(event.target.value)} disabled={!countryCode} className="mt-2 w-full rounded-xl border border-border bg-background px-2 py-3 text-sm"><option value="">غير محددة</option>{visibleCities.map((city) => <option key={city.id} value={city.id}>{city.name_ar}</option>)}</select>
            </label>
          </div>
          <button disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white disabled:opacity-50"><Plus size={16}/>إضافة إلى المراجعة</button>
        </form>
        <p className="mt-3 text-xs leading-6 text-slate-400">تُضاف القناة بحالة «قيد المراجعة». لا يتم الانضمام إليها أو جمع منشوراتها تلقائياً.</p>
      </section>}
    </div>}
    {!canManage && tab === "channels" && <p className="text-xs text-slate-500">صلاحية القراءة فقط: لا يملك دورك صلاحية تعديل قنوات مساحة العمل.</p>}

    {tab === "rules" && <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="rounded-2xl border border-border bg-card p-4 md:p-5">
        <h2 className="mb-4 font-extrabold">قواعد التضمين والاستبعاد</h2>
        {rules.length === 0 ? <p className="rounded-xl border border-dashed border-border p-7 text-center text-sm text-slate-500">لا توجد قواعد بعد. أضف كلمات أو عبارات لتستخدمها آلية التقييم لاحقاً.</p> :
          <div className="space-y-2">{rules.map((rule) => <div key={rule.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3">
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-1 text-[11px] font-bold ${rule.rule_type === "include" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>{rule.rule_type === "include" ? "تضمين" : "استبعاد"}</span><span className="font-semibold">{rule.rule_value}</span></div><div className="mt-1 text-xs text-slate-500">{rule.match_type} · {rule.country_code ?? "كل الدول"} · أولوية {rule.priority}</div></div>
            {canManage && <div className="flex items-center gap-2"><button type="button" disabled={saving} onClick={() => void toggleRule(rule)} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold">{rule.enabled ? "تعطيل" : "تفعيل"}</button><button type="button" disabled={saving} onClick={() => void deleteRule(rule)} aria-label="حذف القاعدة" className="rounded-lg border border-border p-2 text-rose-600"><Trash2 size={15}/></button></div>}
          </div>)}</div>}
      </div>
      {canManage && <div className="h-fit rounded-2xl border border-border bg-card p-4 md:p-5">
        <h2 className="mb-4 font-extrabold">إضافة قاعدة</h2>
        <form onSubmit={addRule} className="space-y-3">
          <label className="block text-sm font-semibold">نوع القاعدة<select value={ruleType} onChange={(event) => setRuleType(event.target.value as "include" | "exclude")} className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-3"><option value="include">تضمين / إشارة إيجابية</option><option value="exclude">استبعاد / إشارة سلبية</option></select></label>
          <label className="block text-sm font-semibold">طريقة المطابقة<select value={matchType} onChange={(event) => setMatchType(event.target.value)} className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-3"><option value="contains">يحتوي على</option><option value="exact">مطابقة تامة</option><option value="phrase">عبارة</option><option value="hashtag">وسم</option></select></label>
          <label className="block text-sm font-semibold">الكلمة أو العبارة<input required maxLength={120} value={ruleValue} onChange={(event) => setRuleValue(event.target.value)} className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-3"/></label>
          <label className="block text-sm font-semibold">الدولة (اختياري)<select value={ruleCountry} onChange={(event) => setRuleCountry(event.target.value)} className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-3"><option value="">كل الدول</option>{countries.map((country) => <option key={country.code} value={country.code}>{country.name_ar}</option>)}</select></label>
          <button disabled={saving} className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white">حفظ القاعدة</button>
        </form>
      </div>}
    </section>}
    {!canManage && tab === "rules" && <p className="text-xs text-slate-500">صلاحية القراءة فقط: إدارة قواعد التقييم متاحة للمحررين المخولين في مساحة العمل.</p>}

    {tab === "settings" && <section className="max-w-3xl rounded-2xl border border-border bg-card p-4 md:p-6">
      <div className="mb-5 flex items-center gap-3"><Settings2 className="text-primary"/><div><h2 className="font-extrabold">إعدادات الاكتشاف المشتركة</h2><p className="mt-1 text-xs text-slate-500">تُحفظ كإعدادات مساحة العمل ولا تشغّل أي مهام حالياً.</p></div></div>
      {canManage ? <form onSubmit={saveSettings} className="space-y-5">
        <label className="flex items-start justify-between gap-4 rounded-xl border border-border p-4"><span><span className="block text-sm font-bold">تفعيل الاكتشاف التلقائي</span><span className="mt-1 block text-xs leading-5 text-slate-500">الإعداد محفوظ فقط؛ محرك الاكتشاف غير مفعّل في هذه المرحلة.</span></span><input type="checkbox" checked={settings.discovery_enabled} onChange={(event) => setSettings((value) => ({ ...value, discovery_enabled: event.target.checked, schedule_interval: event.target.checked && value.schedule_interval === "paused" ? "daily" : value.schedule_interval }))} className="mt-1 h-5 w-5 accent-blue-600"/></label>
        <label className="block text-sm font-semibold">تكرار الاكتشاف<select value={settings.schedule_interval} onChange={(event) => setSettings((value) => ({ ...value, schedule_interval: event.target.value, discovery_enabled: event.target.value === "paused" ? false : value.discovery_enabled }))} className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-3"><option value="hourly">كل ساعة</option><option value="every_6_hours">كل 6 ساعات</option><option value="every_12_hours">كل 12 ساعة</option><option value="daily">يومياً</option><option value="paused">إيقاف مؤقت</option></select></label>
        <label className="flex items-center justify-between gap-4 rounded-xl border border-border p-4"><span className="text-sm font-bold">الاعتماد التلقائي للقنوات المؤهلة</span><input type="checkbox" checked={settings.auto_approve_enabled} onChange={(event) => setSettings((value) => ({ ...value, auto_approve_enabled: event.target.checked }))} className="h-5 w-5 accent-blue-600"/></label>
        <label className="block text-sm font-semibold">الحد الأدنى لدرجة الاعتماد التلقائي: {settings.minimum_approval_score}/100<input type="range" min="0" max="100" step="5" value={settings.minimum_approval_score} onChange={(event) => setSettings((value) => ({ ...value, minimum_approval_score: Number(event.target.value) }))} className="mt-3 w-full accent-blue-600"/></label>
        <label className="block text-sm font-semibold">النطاق التاريخي الافتراضي للبحث<select value={settings.default_history_days} onChange={(event) => setSettings((value) => ({ ...value, default_history_days: Number(event.target.value) }))} className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-3">{[1,3,7,10,15,30].map((days) => <option key={days} value={days}>آخر {days} {days === 1 ? "يوم" : "أيام"}</option>)}</select></label>
        <div className="rounded-xl border border-border p-4 space-y-4">
          <div>
            <h3 className="font-bold">تحليل الذكاء الاصطناعي</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">التحليل المحلي يظل الأساس. Gemini خيار إضافي ولا يعمل إلا عند تفعيل مفاتيح الحماية الخاصة بالمستوى المجاني.</p>
          </div>
          <label className="flex items-center justify-between gap-4 text-sm font-semibold">
            تفعيل التحليل بالذكاء الاصطناعي
            <input type="checkbox" checked={settings.ai_enabled} onChange={(event) => setSettings((value) => ({ ...value, ai_enabled: event.target.checked }))} className="h-5 w-5 accent-blue-600"/>
          </label>
          <label className="block text-sm font-semibold">المزود
            <select value={settings.ai_provider} onChange={(event) => setSettings((value) => ({ ...value, ai_provider: event.target.value as "local" | "gemini" }))} className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-3">
              <option value="local">التحليل المحلي فقط</option>
              <option value="gemini">Google Gemini – المستوى المجاني</option>
            </select>
          </label>
          <label className="block text-sm font-semibold">النموذج
            <select value={settings.ai_model} onChange={(event) => setSettings((value) => ({ ...value, ai_model: event.target.value }))} className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-3">
              <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash-Lite</option>
              <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
            </select>
          </label>
          <label className="block text-sm font-semibold">الحد اليومي لطلبات الذكاء الاصطناعي: {settings.ai_daily_request_limit}
            <input type="range" min="1" max="100" step="1" value={settings.ai_daily_request_limit} onChange={(event) => setSettings((value) => ({ ...value, ai_daily_request_limit: Number(event.target.value) }))} className="mt-3 w-full accent-blue-600"/>
          </label>
          <div className="rounded-lg bg-background p-3 text-xs leading-6 text-slate-500">
            استهلاك اليوم: {aiUsage.requests}/{settings.ai_daily_request_limit} طلب · {aiUsage.input_tokens + aiUsage.output_tokens} رمز.
            <br/>لا يوفر Gemini API رقماً موثوقاً للحصة المجانية المتبقية؛ المعروض هنا استهلاك Mimi Search AI فقط.
          </div>
          <p className="text-xs leading-5 text-amber-700 dark:text-amber-300">لمنع الفوترة: لن يرسل النظام طلباً إلا عند تعيين GEMINI_FREE_TIER_ONLY=true وGEMINI_BILLING_DISABLED_CONFIRMED=true واستخدام مشروع Google لا يحتوي على حساب فوترة. لا يتم استخدام Google Search Grounding أو أي نموذج غير مدرج في القائمة.</p>
        </div>
        <button disabled={saving} className="w-full rounded-xl bg-primary px-4 py-3 font-bold text-white disabled:opacity-50">حفظ إعدادات مساحة العمل</button>
      </form> : <p className="rounded-xl border border-border p-4 text-sm text-slate-500">إعدادات مساحة العمل مشتركة، لكن حسابك يملك صلاحية القراءة فقط.</p>}
    </section>}
  </div>;
}
