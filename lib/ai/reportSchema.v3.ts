import { z } from "zod";
import { PLAN_PHASES } from "@/lib/config/plan";
import { REGION_KEYS } from "@/lib/score/contract";

// Plan seçimi şeması (PLAN 4e; CONTRACTS_V2 S2.1 kural 1). Claude bilgi tabanından KİMLİK seçer, faz ve bağlı bölge verir,
// kısa gerekçe yazar; planın kendisini (PlanV2) KOD kurar. Şema bilerek KÜÇÜK ve DÜZ: tek dizi, 4 zorunlu alan, enum'lar,
// min/max yok (sınırlar lib/coach/plan.ts'te) — Sprint 1'de 7 KB'lık iç içe şema "compiled grammar is too large" ile reddedildi.
// Sayı yok: rationale'de rakam geçerse safety.ts (score_in_text) düşürür.

export const PLAN_SELECTION_PROMPT_VERSION = "plan.v2";

export const PlanSelectionItem = z.object({
  /** Verilen listeden kimlik, birebir. Bilinmeyen kimlik kodda düşer. */
  id: z.string(),
  phase: z.enum(PLAN_PHASES),
  /** Cevap verdiği rapor bölgesi. Yapısal bölge (göz, burun, elmacık, çene) yalnız saç/sakal/kaş/renk/stil adımına bağlanır. */
  region: z.enum(REGION_KEYS),
  /** Bir cümle, nötr, rakam yok: bu adım bu kullanıcıda neden. */
  rationale: z.string(),
});
export type PlanSelectionItem = z.infer<typeof PlanSelectionItem>;

export const PlanSelectionOutput = z.object({
  selections: z.array(PlanSelectionItem),
});
export type PlanSelectionOutput = z.infer<typeof PlanSelectionOutput>;

/** Sözleşme tavanları (kod uygular): en çok 16 adım, gerekçe ≤ 400 karakter. */
export const PLAN_SELECTION_LIMITS = { selections: 16, rationale: 400 } as const;

export function normalizePlanSelection(out: PlanSelectionOutput): PlanSelectionOutput {
  const seen = new Set<string>();
  const selections = out.selections
    .filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)))
    .slice(0, PLAN_SELECTION_LIMITS.selections)
    .map((s) => ({ ...s, id: s.id.trim(), rationale: s.rationale.trim().slice(0, PLAN_SELECTION_LIMITS.rationale) }));
  return { selections };
}
