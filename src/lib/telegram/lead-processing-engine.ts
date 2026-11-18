import type { SupabaseClient } from "@supabase/supabase-js";
import { enhanceTelegramLeadWithGemini } from "@/lib/telegram/gemini-free-tier";

type SourceItem = {
  id: string;
  workspace_id: string;
  external_item_id: string;
  source_url: string;
  source_name: string | null;
  author_public_id: string | null;
  author_display_name: string | null;
  text_content: string | null;
  published_at: string | null;
  country_code: string | null;
  city_id: string | null;
};

type KeywordVariant = { term: string; is_negative: boolean; match_type: string; language_code: string | null };

const BUYER_NEED = [
  "مطلوب", "نبحث عن", "ابحث عن", "أبحث عن", "نحتاج", "احتاج", "أحتاج",
  "اريد", "أريد", "نرغب", "طلب عرض سعر", "عرض سعر", "نطلب", "محتاج",
  "looking for", "need a", "need an", "seeking", "request for quotation",
  "rfq", "requesting", "need someone", "recommend a",
];
const SERVICE_TERMS = [
  "مقاول", "مقاولات", "تنفيذ", "تصميم", "برمجة", "تطوير", "صيانة", "تركيب",
  "تشطيب", "توريد", "تسويق", "موقع إلكتروني", "تطبيق", "نظام", "خدمات",
  "contractor", "construction", "development", "design", "maintenance",
  "installation", "software", "website", "app", "service",
];
const PRODUCT_TERMS = [
  "منتج", "منتجات", "جهاز", "معدات", "مواد", "قطعة", "شراء", "توريد",
  "product", "products", "equipment", "material", "supplies", "buy", "purchase",
];
const TENDER_TERMS = ["مناقصة", "منافسة", "طلب تقديم عروض", "طلب عروض", "rfp", "tender", "bid"];
const HIRING_TERMS = ["وظيفة", "توظيف", "مطلوب موظف", "مطلوب مهندس", "فرصة عمل", "hiring", "job opening", "vacancy"];
const OFFER_TERMS = ["نقدم خدمات", "نقدم لكم", "متوفر لدينا", "لدينا عرض", "our services", "we offer", "available now"];
const OPPORTUNITY_TERMS = ["شراكة", "شريك", "استثمار", "فرصة استثمارية", "partnership", "investor", "investment"];
const AD_TERMS = ["خصم", "عرض خاص", "سارع", "لا يفوتك", "تواصل معنا", "للطلب والاستفسار", "limited offer", "discount", "contact us"];

function normalize(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[ً-ْـ]/g, "").replace(/\s+/g, " ").trim();
}

function includesAny(text: string, terms: string[]) {
  const value = normalize(text);
  return terms.some((term) => value.includes(normalize(term)));
}

function matchKeyword(text: string, keyword: KeywordVariant) {
  const value = normalize(text);
  const term = normalize(keyword.term);
  if (!term) return false;
  if (keyword.match_type === "exact") return value === term;
  if (keyword.match_type === "hashtag") return value.includes("#" + term.replace(/^#/, ""));
  return value.includes(term);
}

function classify(text: string) {
  if (includesAny(text, TENDER_TERMS)) return "Tender";
  if (includesAny(text, HIRING_TERMS)) return "Hiring";
  if (includesAny(text, OPPORTUNITY_TERMS)) return "Business Opportunity";
  if (includesAny(text, OFFER_TERMS)) return "Supplier Offer";
  if (includesAny(text, BUYER_NEED) && includesAny(text, PRODUCT_TERMS)) return "Product Request";
  if (includesAny(text, BUYER_NEED) && includesAny(text, SERVICE_TERMS)) return "Service Request";
  if (includesAny(text, BUYER_NEED)) return "Buyer Intent";
  if (includesAny(text, AD_TERMS)) return "Advertisement";
  return "General Discussion";
}

function scoreLead(text: string, item: SourceItem, category: string) {
  const reasons: string[] = [];
  const needClarity = includesAny(text, BUYER_NEED) ? 25 : category === "Tender" ? 24 : 4;
  if (needClarity >= 20) reasons.push("يتضمن طلباً أو احتياجاً مباشراً.");

  const purchaseIntent = ["Service Request", "Product Request", "Buyer Intent", "Tender"].includes(category)
    ? (includesAny(text, ["عرض سعر", "شراء", "توريد", "ميزانية", "quote", "budget", "purchase", "rfq"]) ? 24 : 17)
    : category === "Business Opportunity" ? 14 : 3;
  if (purchaseIntent >= 17) reasons.push("توجد إشارة إلى نية شراء أو طلب عرض.");

  const serviceSpecificity = includesAny(text, SERVICE_TERMS) || includesAny(text, PRODUCT_TERMS) ? 16 : 5;
  if (serviceSpecificity > 10) reasons.push("الخدمة أو المنتج محدد في النص.");

  const ageDays = item.published_at
    ? Math.max(0, (Date.now() - new Date(item.published_at).getTime()) / 86400000)
    : Number.POSITIVE_INFINITY;
  const postRecency = ageDays <= 3 ? 10 : ageDays <= 7 ? 8 : ageDays <= 30 ? 5 : 1;
  if (postRecency >= 8) reasons.push("المنشور حديث.");

  const projectDetails = includesAny(text, [
    "مشروع", "المشروع", "الموقع", "المساحة", "الكمية", "التكلفة", "الميزانية",
    "مدينة", "حي", "project", "location", "quantity", "budget", "deadline",
  ]) ? 9 : 3;
  if (projectDetails > 5) reasons.push("يتضمن تفاصيل عن المشروع أو نطاق الطلب.");

  const geographicClarity = 0;

  const total = needClarity + purchaseIntent + serviceSpecificity + postRecency + projectDetails + geographicClarity;
  const classification = total >= 75 ? "high" : total >= 50 ? "review" : "low";
  return {
    needClarity, purchaseIntent, serviceSpecificity, postRecency, projectDetails,
    geographicClarity, total, classification, reasons,
  };
}

export async function processTelegramSourceItem(admin: SupabaseClient, workspaceId: string, sourceItemId: string) {
  const { data: item, error: itemError } = await admin.from("source_items")
    .select("id,workspace_id,external_item_id,source_url,source_name,author_public_id,author_display_name,text_content,language_code,published_at,country_code,city_id")
    .eq("id", sourceItemId).eq("workspace_id", workspaceId).maybeSingle();
  if (itemError || !item) throw new Error("SOURCE_ITEM_NOT_FOUND");

  const text = (item.text_content ?? "").trim();
  if (!text) return { skipped: true, reason: "EMPTY_TEXT" };

  const { data: sets, error: setsError } = await admin.from("keyword_sets")
    .select("id").eq("workspace_id", workspaceId).eq("is_active", true);
  if (setsError) throw new Error("KEYWORD_SETS_READ_FAILED");
  const setIds = (sets ?? []).map((set: { id: string }) => set.id);
  let keywords: KeywordVariant[] = [];
  if (setIds.length) {
    const { data: variants, error: variantsError } = await admin.from("keyword_variants")
      .select("term,is_negative,match_type,language_code").eq("workspace_id", workspaceId).in("keyword_set_id", setIds);
    if (variantsError) throw new Error("KEYWORD_VARIANTS_READ_FAILED");
    keywords = ((variants ?? []) as KeywordVariant[]).filter((variant) => !variant.language_code || variant.language_code === item.language_code || variant.language_code === "und");
  }

  const positiveMatches = keywords.filter((keyword) => !keyword.is_negative && matchKeyword(text, keyword));
  const negativeMatches = keywords.filter((keyword) => keyword.is_negative && matchKeyword(text, keyword));
  if (negativeMatches.length) return { skipped: true, reason: "NEGATIVE_KEYWORD_MATCH" };

  const category = classify(text);
  if (["Advertisement", "General Discussion"].includes(category)) {
    return { skipped: true, reason: category.toUpperCase().replace(/\s+/g, "_"), category };
  }

  const scoring = scoreLead(text, item as SourceItem, category);
  const serviceCategory = category === "Product Request" ? "product"
    : category === "Hiring" ? "hiring"
    : category === "Tender" ? "tender"
    : category === "Business Opportunity" ? "business_opportunity"
    : "services";
  const normalizedIdentity = `telegram_post:${item.external_item_id}`;
  const displayName = null;

  const { data: lead, error: leadError } = await admin.from("leads").upsert({
    workspace_id: workspaceId,
    lead_type: "unknown",
    display_name: displayName,
    normalized_identity: normalizedIdentity,
    country_code: null,
    city_id: null,
    service_category: serviceCategory,
    latest_score: scoring.total,
    classification: scoring.classification,
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "workspace_id,normalized_identity" }).select("id").single();
  if (leadError || !lead) throw new Error("LEAD_SAVE_FAILED");

  const relevanceReason = [
    category,
    ...scoring.reasons,
    ...(item.language_code ? [`لغة المنشور: ${item.language_code}`] : []),\n    ...(positiveMatches.length ? [`مطابقة كلمات مفتاحية: ${positiveMatches.map((item) => item.term).slice(0, 5).join("، ")}`] : []),
  ].join(" ");

  const { error: evidenceError } = await admin.from("lead_evidence").upsert({
    workspace_id: workspaceId,
    lead_id: lead.id,
    source_item_id: item.id,
    relevance_reason: relevanceReason.slice(0, 1000),
  }, { onConflict: "lead_id,source_item_id", ignoreDuplicates: true });
  if (evidenceError) throw new Error("LEAD_EVIDENCE_SAVE_FAILED");

  const { data: priorAssessment, error: assessmentLookupError } = await admin.from("lead_assessments")
    .select("id").eq("workspace_id", workspaceId).eq("lead_id", lead.id)
    .eq("scorer_version", "rules-v1").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (assessmentLookupError) throw new Error("LEAD_ASSESSMENT_LOOKUP_FAILED");

  const assessment = {
    workspace_id: workspaceId,
    lead_id: lead.id,
    need_clarity: scoring.needClarity,
    purchase_intent: scoring.purchaseIntent,
    service_specificity: scoring.serviceSpecificity,
    post_recency: scoring.postRecency,
    project_details: scoring.projectDetails,
    geographic_clarity: scoring.geographicClarity,
    total_score: scoring.total,
    classification: scoring.classification,
    reasons: [category, ...scoring.reasons, ...positiveMatches.slice(0, 5).map((match) => `keyword:${match.term}`)],
    scorer_version: "rules-v1",
  };

  const assessmentWrite = priorAssessment
    ? await admin.from("lead_assessments").update(assessment).eq("id", priorAssessment.id).eq("workspace_id", workspaceId)
    : await admin.from("lead_assessments").insert(assessment);
  if (assessmentWrite.error) throw new Error("LEAD_ASSESSMENT_SAVE_FAILED");

  const ai = await enhanceTelegramLeadWithGemini(admin, workspaceId, item as SourceItem, lead.id);

  return {
    processed: true,
    leadId: lead.id,
    category,
    score: scoring.total,
    classification: scoring.classification,
    matchedKeywords: positiveMatches.length,
    ai,
  };
}
