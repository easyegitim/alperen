import { BODY_IMAGE_SCREEN_QUESTIONS, BODY_IMAGE_SCREEN_RETAKE_DAYS, BODY_IMAGE_SCREEN_RISK_YES_COUNT, type BodyImageScreenResult } from "@/lib/config/plan";
import type { DoctorLayerState, StepCard } from "@/lib/coach/planTypes";
import type { MethodRecord } from "@/lib/coach/knowledge";
import { DELIVERABLE_STATUSES, DoctorItems, type DoctorItem, type DoctorStatus } from "./types";

// Doktor katmanı kuralları (saf; birim testi): kullanıcıya ulaşma yolu TEK ve KAPALI — yalnız physician_reviewed/delivered
// satırın physician_items alanı. Taslak (ai_items) hiçbir fonksiyondan kullanıcıya dönmez.

export type DoctorRowLike = { status: DoctorStatus; physician_items: unknown; ai_items?: unknown };

/** Beden algısı taraması (KB §6.4, CLAUDE NOTU eşik): "evet" sayısı eşiğe ulaşırsa risk. Cevaplar saklanmaz. */
export function bodyImageScreenResult(answers: Readonly<Record<string, boolean>>): BodyImageScreenResult {
  const yes = BODY_IMAGE_SCREEN_QUESTIONS.filter((q) => answers[q] === true).length;
  return yes >= BODY_IMAGE_SCREEN_RISK_YES_COUNT ? "risk" : "ok";
}

/**
 * Tarama yeniden alınabilir mi (saf): önceki sonuç "risk" ise BODY_IMAGE_SCREEN_RETAKE_DAYS dolmadan yeni gönderim kabul
 * edilmez (risk → ok sessizce düşmez; sayfa yenileyip dört "hayır" ile katmanı açmak mümkün değildir). "ok" ya da hiç
 * taranmamışsa serbest. Tarih yoksa risk kalıcı sayılır. Dönen retakeAt: ne zaman yeniden alınabileceği (ISO) ya da null.
 */
export function screenRetakePolicy(prev: { result: BodyImageScreenResult | null; screenedAt: string | null }, nowMs: number): { allowed: boolean; retakeAt: string | null } {
  if (prev.result !== "risk") return { allowed: true, retakeAt: null };
  const at = prev.screenedAt ? Date.parse(prev.screenedAt) : Number.NaN;
  if (!Number.isFinite(at)) return { allowed: false, retakeAt: null };
  const retake = at + BODY_IMAGE_SCREEN_RETAKE_DAYS * 86_400_000;
  return { allowed: nowMs >= retake, retakeAt: new Date(retake).toISOString() };
}

export type DoctorStateInput = {
  flagEnabled: boolean;
  under18: boolean;
  screen: BodyImageScreenResult | null;
  rows: readonly Pick<DoctorRowLike, "status">[];
};

/** Katman durumu (CONTRACTS_V2 S2.1 kural 3): off → under_18 → screen_required → screen_risk → available/pending/none. */
export function doctorLayerState(i: DoctorStateInput): DoctorLayerState {
  if (!i.flagEnabled) return "off";
  if (i.under18) return "under_18";
  if (i.screen === null) return "screen_required";
  if (i.screen === "risk") return "screen_risk";
  if (i.rows.some((r) => DELIVERABLE_STATUSES.includes(r.status))) return "available";
  if (i.rows.some((r) => r.status === "draft")) return "pending_review";
  return "none";
}

/**
 * Kullanıcıya gidebilecek öğeler: YALNIZ status physician_reviewed|delivered ve YALNIZ physician_items. draft/rejected → [].
 * ai_items hiçbir durumda dönmez (hekim değiştirmiş olabilir; AUP: değiştirme yetkisi olan kişi inceledi).
 */
export function deliverableItems(row: DoctorRowLike): DoctorItem[] {
  if (!DELIVERABLE_STATUSES.includes(row.status)) return [];
  const parsed = DoctorItems.safeParse(row.physician_items);
  return parsed.success ? parsed.data : [];
}

/** Kullanıcı görünümü: hekim öğesi → doktor katmanı adım kartı (tier doctor; plana yazılmaz, okuma anında eklenir). */
export function doctorStepCard(item: DoctorItem, record: MethodRecord | null): StepCard {
  return {
    id: item.methodId,
    area: item.area,
    phase: "months_1_3",
    tier: "doctor",
    title: record?.title ?? item.methodId,
    summary: item.rationale.slice(0, 400),
    observationRef: { region: record?.regions[0] ?? "skin" },
    costTryRange: record?.costTryRange ?? { min: 0, max: null },
    frequency: record?.frequency ?? { per: "once", times: 1 },
    minutesPerDay: record?.minutesPerDay ?? 0,
    difficulty: record?.difficulty ?? 2,
    impact: record?.impact ?? 2,
    effort: record?.effort ?? 2,
    evidence: { level: record?.evidence.level ?? "expert_opinion", ...(item.sources[0] ? { source: item.sources[0] } : {}) },
  };
}
