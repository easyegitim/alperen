import { z } from "zod";
import { DOCTOR_LAYER, PLAN_AREAS } from "@/lib/config/plan";
import { normalizeTr } from "@/lib/ai/safety";

// Doktor katmanı tipleri (KB Ç3/Ç5, §6.1; PLAN 4f; AUP high-risk). Saf, paylaşılan.
// Taslak (ai_items) ve hekimin son hali (physician_items) aynı biçimdedir: { methodId, area, rationale, sources[] }.
// Doz, marka, eczane/satış bağlantısı YOK; bağlantı yalnız bilimsel kaynak ve TİTCK (DOCTOR_LAYER.allowedLinkHosts).

export const DOCTOR_STATUSES = ["draft", "physician_reviewed", "delivered", "rejected"] as const;
export type DoctorStatus = (typeof DOCTOR_STATUSES)[number];

/** Kullanıcıya ulaşabilen durumlar: hekim onayladı ya da zaten teslim edildi. draft/rejected ASLA. */
export const DELIVERABLE_STATUSES: readonly DoctorStatus[] = ["physician_reviewed", "delivered"];

/** Doz/miktar kalıpları (Ç5): "10 mg", "günde 2 kez", "%5", "ml", "tablet", "kapsül", "damla", "ünite". */
export const DOSE_RE = /\b\d+([.,]\d+)?\s*(mg|mcg|µg|ml|iu|ünite|unite|tablet|kapsul|kapsül|damla|doz)\b|%\s*\d|\bgunde\s+\d|\bhaftada\s+\d|\bx\s*\d\s*(tablet|kapsul)/;
/** Eczane / satış / marka kalıpları: link ya da metinde "eczane", "sipariş", "satın al", "fiyat", "indirim". */
export const SALES_RE = /eczane|siparis|satin al|fiyat|indirim|kampanya|sepet|ucretsiz kargo/;

export const DoctorItem = z.object({
  /** Bilgi tabanı kimliği (tier "doctor" kaydı); kod doğrular. */
  methodId: z.string().min(1).max(80),
  area: z.enum(PLAN_AREAS),
  /** Gerekçe; doz, marka, satış yok. */
  rationale: z.string().min(1).max(600),
  /** Yalnız https ve izinli alan adları (TİTCK, DOI, PubMed, Cochrane, WHO). */
  sources: z.array(z.string().url().max(300)).max(4),
});
export type DoctorItem = z.infer<typeof DoctorItem>;

export const DoctorItems = z.array(DoctorItem).max(DOCTOR_LAYER.maxRecommendations);

export function isAllowedSourceUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  return DOCTOR_LAYER.allowedLinkHosts.some((h) => host === h || host.endsWith(`.${h}`));
}

export type DoctorItemIssue = "dose" | "sales" | "source_host" | "unknown_method" | "too_many";

/**
 * Öğe doğrulaması (kod; hekim ekranı ve taslak aynı kuralı kullanır): bilinmeyen yöntem, doz kalıbı, satış/eczane dili,
 * izinsiz kaynak alanı → öğe düşer. En çok iki öğe (KB §6.1).
 */
export function validateDoctorItems(items: readonly DoctorItem[], knownMethodIds: ReadonlySet<string> | null): { valid: DoctorItem[]; issues: { index: number; issue: DoctorItemIssue }[] } {
  const valid: DoctorItem[] = [];
  const issues: { index: number; issue: DoctorItemIssue }[] = [];
  items.forEach((it, index) => {
    if (valid.length >= DOCTOR_LAYER.maxRecommendations) return issues.push({ index, issue: "too_many" });
    const text = normalizeTr(it.rationale);
    if (knownMethodIds && !knownMethodIds.has(it.methodId)) return issues.push({ index, issue: "unknown_method" });
    if (DOSE_RE.test(text)) return issues.push({ index, issue: "dose" });
    if (SALES_RE.test(text) || it.sources.some((s) => SALES_RE.test(normalizeTr(s)))) return issues.push({ index, issue: "sales" });
    if (!it.sources.every(isAllowedSourceUrl)) return issues.push({ index, issue: "source_host" });
    valid.push({ ...it, rationale: it.rationale.trim() });
  });
  return { valid, issues };
}
