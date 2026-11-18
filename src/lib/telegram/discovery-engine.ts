import type { SupabaseClient } from "@supabase/supabase-js";

type Rule = {
  id: string;
  rule_type: "include" | "exclude";
  match_type: "exact" | "phrase" | "contains" | "hashtag";
  rule_value: string;
  country_code: string | null;
  priority: number;
};

type SearchItem = { title?: string; content?: string; url?: string };
type SearchResponse = { results?: SearchItem[]; detail?: string; message?: string };

const MAX_SEARCH_QUERIES_PER_RUN = 1;
const RESULTS_PER_QUERY = 10;

function normalizeText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[ً-ْـ]/g, "").trim();
}

function matchesRule(text: string, rule: Rule) {
  const haystack = normalizeText(text);
  const needle = normalizeText(rule.rule_value);
  if (!needle) return false;
  if (rule.match_type === "exact") return haystack === needle;
  if (rule.match_type === "hashtag") return haystack.includes("#" + needle.replace(/^#/, ""));
  return haystack.includes(needle);
}

function extractPublicChannel(link: string) {
  try {
    const url = new URL(link);
    const host = url.hostname.toLowerCase();
    if (host !== "t.me" && host !== "www.t.me" && host !== "telegram.me") return null;
    const first = decodeURIComponent(url.pathname.split("/").filter(Boolean)[0] ?? "");
    if (!/^[a-zA-Z0-9_]{5,32}$/.test(first)) return null;
    if (/^(joinchat|addstickers|addemoji|share|proxy|s|c)$/i.test(first)) return null;
    return { username: first, publicUrl: `https://t.me/${first}` };
  } catch {
    return null;
  }
}

async function tavilySearch(query: string, countryCode: string | null) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new Error("DISCOVERY_PROVIDER_NOT_CONFIGURED");
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      query,
      search_depth: "basic",
      max_results: RESULTS_PER_QUERY,
      include_domains: ["t.me"],
      ...(countryCode ? { country: countryCode.toLowerCase() } : {}),
      include_answer: false,
      include_raw_content: false,
    }),
    signal: AbortSignal.timeout(12000),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({})) as SearchResponse;
  if (!response.ok) {
    if (response.status === 429) throw new Error("DISCOVERY_PROVIDER_QUOTA_REACHED");
    throw new Error("DISCOVERY_PROVIDER_REQUEST_FAILED");
  }
  return data.results ?? [];
}

export async function discoverTelegramChannels(
  admin: SupabaseClient,
  workspaceId: string,
  ruleOffset = 0,
) {
  if (process.env.TELEGRAM_DISCOVERY_SEARCH_ENABLED !== "true") {
    throw new Error("DISCOVERY_SEARCH_DISABLED");
  }
  if (process.env.TAVILY_FREE_PLAN_ONLY_CONFIRMED !== "true") {
    throw new Error("DISCOVERY_FREE_PLAN_GUARD_NOT_CONFIRMED");
  }

  const [{ data: settings, error: settingsError }, { data: rules, error: rulesError }] = await Promise.all([
    admin.from("telegram_discovery_settings")
      .select("auto_approve_enabled,minimum_approval_score")
      .eq("workspace_id", workspaceId).maybeSingle(),
    admin.from("telegram_channel_rules")
      .select("id,rule_type,match_type,rule_value,country_code,priority")
      .eq("workspace_id", workspaceId).eq("enabled", true).order("priority", { ascending: true }),
  ]);
  if (settingsError || rulesError) throw new Error("DISCOVERY_CONFIGURATION_READ_FAILED");

  const allRules = (rules ?? []) as Rule[];
  const includeRules = allRules.filter((rule) => rule.rule_type === "include").slice(ruleOffset, ruleOffset + MAX_SEARCH_QUERIES_PER_RUN);
  const excludeRules = allRules.filter((rule) => rule.rule_type === "exclude");
  if (!includeRules.length) throw new Error("DISCOVERY_INCLUDE_RULES_REQUIRED");

  const discovered = new Map<string, { username: string; publicUrl: string; title: string; snippet: string; query: string; countryCode: string | null; score: number }>();
  let searches = 0;

  for (const rule of includeRules) {
    const query = `site:t.me ${rule.rule_value} Telegram channel`;
    const { data: quotaAllowed, error: quotaError } = await admin.rpc("claim_telegram_discovery_credit", { p_monthly_limit: 900 });
    if (quotaError) throw new Error("DISCOVERY_QUOTA_RESERVATION_FAILED");
    if (quotaAllowed !== true) throw new Error("DISCOVERY_MONTHLY_FREE_LIMIT_REACHED");
    const items = await tavilySearch(query, rule.country_code);
    searches += 1;

    for (const item of items) {
      const title = (item.title ?? "").slice(0, 240);
      const snippet = (item.content ?? "").slice(0, 1200);
      const channel = item.url ? extractPublicChannel(item.link) : null;
      if (!channel) continue;

      const evidenceText = `${title} ${snippet}`;
      if (excludeRules.some((excludeRule) => matchesRule(evidenceText, excludeRule))) continue;
      if (!matchesRule(evidenceText, rule) && !normalizeText(query)) continue;

      const score = Math.min(100, 50 + (title ? 15 : 0) + (snippet ? 15 : 0) + (rule.country_code ? 5 : 0));
      const key = channel.username.toLowerCase();
      const existing = discovered.get(key);
      if (!existing || score > existing.score) {
        discovered.set(key, {
          ...channel, title: title.replace(/\s*[-|–]\s*Telegram\s*$/i, "").slice(0, 160),
          snippet, query, countryCode: rule.country_code, score,
        });
      }
    }
  }

  let inserted = 0;
  let alreadyKnown = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const candidate of discovered.values()) {
    const { data: existing, error: lookupError } = await admin.from("telegram_channels")
      .select("id,status").eq("workspace_id", workspaceId)
      .ilike("username", candidate.username).maybeSingle();
    if (lookupError) { errors.push("CHANNEL_LOOKUP_FAILED"); skipped += 1; continue; }

    let channelId = existing?.id as string | undefined;
    if (channelId) {
      alreadyKnown += 1;
      await admin.from("telegram_channels").update({
        last_discovered_at: new Date().toISOString(),
      }).eq("id", channelId).eq("workspace_id", workspaceId);
    } else {
      const canAutoApprove = Boolean(settings?.auto_approve_enabled)
        && candidate.score >= Number(settings?.minimum_approval_score ?? 85);
      const { data: created, error: insertError } = await admin.from("telegram_channels").insert({
        workspace_id: workspaceId,
        username: candidate.username,
        title: candidate.title || null,
        about: candidate.snippet || null,
        public_url: candidate.publicUrl,
        status: canAutoApprove ? "approved" : "candidate",
        approved_at: canAutoApprove ? new Date().toISOString() : null,
        discovery_method: "search_engine",
        country_code: candidate.countryCode,
        evaluation_score: candidate.score,
        evaluation_details: {
          version: "discovery-v1",
          provider: "tavily",
          matched_query: candidate.query,
          title: candidate.title,
          snippet: candidate.snippet,
        },
        last_discovered_at: new Date().toISOString(),
      }).select("id").single();

      if (insertError || !created) {
        if (insertError?.code === "23505") { alreadyKnown += 1; continue; }
        errors.push("CHANNEL_INSERT_FAILED"); skipped += 1; continue;
      }
      channelId = created.id;
      inserted += 1;
    }

    const { error: sourceError } = await admin.from("telegram_channel_discovery_sources").insert({
      workspace_id: workspaceId,
      channel_id: channelId,
      source_kind: "search_engine",
      source_url: candidate.publicUrl,
      search_query: candidate.query,
      source_metadata: {
        provider: "tavily",
        title: candidate.title,
        snippet: candidate.snippet,
        evaluation_score: candidate.score,
      },
    });
    if (sourceError && sourceError.code !== "23505") errors.push("DISCOVERY_SOURCE_SAVE_FAILED");
  }

  return {
    searches,
    candidatesFound: discovered.size,
    inserted,
    alreadyKnown,
    skipped,
    errors: [...new Set(errors)],
    hasMore: ruleOffset + includeRules.length < allRules.filter((rule) => rule.rule_type === "include").length,
    nextRuleOffset: ruleOffset + includeRules.length,
  };
}
