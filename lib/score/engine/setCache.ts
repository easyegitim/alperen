import "server-only";

import { z } from "zod";
import { ClientSignalsV2, ReportV3 } from "@/lib/score/contract";
import type { ScoredV2, SignalsV2 } from "./typesV2";

// Set önbelleği (KB Ç11; CONTRACTS_V2 §2.3/5): aynı dosya seti 1 yıl aynı skoru alır. analysis_sets.scores yalnız sayı,
// enum ve denetimden geçmiş metin taşır; fotoğraf, landmark veya hash listesi yok (anahtar HMAC'tir). Model değişse de
// saklı skor korunur (KB §4.2/6). Saf dönüşümler; DB erişimi repo.ts'te.

export const CachedScores = z.object({
  overall: z.number(),
  potential: z.number(),
  subscores: z.record(z.string(), z.number().nullable()),
  score_range: z.record(z.string(), z.unknown()),
  percentile: z.number(),
  face_shape: z.string(),
  gains: z.record(z.string(), z.number()),
  observations: z.record(z.string(), z.unknown()),
  signals: z.record(z.string(), z.unknown()),
  report: ReportV3,
});
export type CachedScores = z.infer<typeof CachedScores>;

export type CachedSetRow = { set_key: string; user_id: string; scores: CachedScores; model: string; prompt_version: string; calibration_version: string; created_at: string; expires_at: string };

/** Saklanacak kısım: runs (ham vektörler) ve ai_usage önbelleğe girmez. */
export function toCachedScores(s: ScoredV2): CachedScores {
  // runs (ham vektörler), progressAt ve failure saklanmaz; geri kalan sinyaller (istemci kısmı dahil) aynen.
  const signals: Record<string, unknown> = { ...s.signals };
  delete signals.runs;
  delete signals.progressAt;
  delete signals.failure;
  return {
    overall: s.overall,
    potential: s.potential,
    subscores: s.subscores,
    score_range: s.scoreRange,
    percentile: s.percentile,
    face_shape: s.faceShape,
    gains: s.gains,
    observations: s.observations,
    signals,
    report: s.report,
  };
}

/** Saklı veriyi doğrular (istemci sinyal sözleşmesi dahil); bozuksa null → önbellek yok sayılır, model çağrılır. */
export function readCachedScores(raw: unknown): CachedScores | null {
  const r = CachedScores.safeParse(raw);
  if (!r.success) return null;
  if (!ClientSignalsV2.safeParse(r.data.signals).success) return null;
  return r.data;
}

/** Önbellekten gelen satır için signals: cacheHit ve yeni ilerleme zamanı. */
export function cachedSignals(c: CachedScores, nowIso: string): Record<string, unknown> & Pick<SignalsV2, "cacheHit" | "progressAt"> {
  return { ...c.signals, cacheHit: true, progressAt: nowIso };
}
