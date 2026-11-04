// SPEC 8.1 ağırlıklar, 8.4 kalibrasyon v0, 8.5 potansiyel tavanları. Kodda sabit değil; burada ve env'de.
import type { SubKey, SubKeyV1 } from "./teaser";

export const SUB_WEIGHTS: Record<SubKeyV1, number> = {
  harmony: 0.25,
  eyes: 0.15,
  jawline: 0.15,
  skin: 0.15,
  hair: 0.15,
  grooming: 0.15,
};

/** Yapısal / geliştirilebilir rozeti (SPEC 8.1, 8.7). */
export const SUB_KIND: Record<SubKey, "structural" | "partial" | "modifiable"> = {
  harmony: "structural",
  eyes: "structural",
  jawline: "partial",
  skin: "modifiable",
  hair: "modifiable",
  grooming: "modifiable",
  brows: "modifiable",
};

/** hybrid.v1 satırlarının rozeti (engine spec §1.2, sözleşme C16): çene hattı h1'de tamamen geometriktir. SUB_KIND (eski) değişmez. */
export const SUB_KIND_HYBRID: Record<SubKey, "structural" | "partial" | "modifiable"> = {
  harmony: "structural",
  eyes: "structural",
  jawline: "structural",
  skin: "modifiable",
  hair: "modifiable",
  grooming: "modifiable",
  brows: "modifiable",
};

/** Herkes için aynı, yayımlanan referans noktası (UI spec S5; = CALIBRATION_V0.target). Yüzdelik veya ortalama değildir. */
export const CALIBRATION_REFERENCE = 5.5;

/** Kalibrasyon h1 (engine spec §5.1): kimlik + kenetleme. Ödeme/plan girdisi yok. */
export const CALIBRATION_H1 = { min: 1.0, max: 9.8 } as const;

/** Sonuç ekranında düşük skor düzeni eşiği (SPEC 8.7, UI spec S5). */
export const RESULT_FOCUS_BELOW = 4.0;

/** Kalibrasyon v0 (SPEC 8.4): overall = clamp(5.5 + (raw − RAW_MEAN) × SCALE, 1.0, 9.8). Faz 6'da 50 fotoğrafla ayarlanır. */
export const CALIBRATION_V0 = {
  target: 5.5,
  rawMean: 6.5,
  scale: 1.4,
  min: 1.0,
  max: 9.8,
  /** Alt skorlar için anahtar bazlı farklı değerler (yoksa genel). */
  perSub: {} as Partial<Record<SubKeyV1, { rawMean: number; scale: number }>>,
} as const;

export const POTENTIAL = {
  caps: { skin: 1.5, hair: 1.5, grooming: 1.5, jawline: 1.0 },
  /** Yağ oranı bağlamı veya sakal seçeneği yoksa çene hattı tavanı. */
  jawlineCapWithoutLever: 0.3,
  maxAboveOverall: 1.5,
  absoluteMax: 9.5,
} as const;

/** Paralel skorlama çağrısı sayısı (SPEC 8.6; tutarsızlıkta 5'e çıkarılır). */
export const SCORE_CALLS = 3;
/** Çağrı başına zaman aşımı (ms): güvenlik tavanı. Hedef p95 < 10 sn; yoğunlukta flash-lite 20 sn'yi aşabiliyor (22 Ekim ölçümü). */
export const SCORE_CALL_TIMEOUT_MS = 40_000;

/** Geçici hatada (503/429) çağrı başına yeniden deneme sayısı ve ilk bekleme. */
export const SCORE_RETRIES = 2;
export const SCORE_RETRY_BASE_MS = 1_500;

export function getScoringEnv(env: Record<string, string | undefined> = process.env) {
  const scoreModel = env.GEMINI_SCORE_MODEL || "gemini-3.5-flash-lite";
  // Birincil model yoğunlukta (503) ise son çare; boş string kapatır. Kullanılan model analyses.scoring_model'e yazılır.
  const fallbackModel = env.GEMINI_SCORE_FALLBACK_MODEL ?? "gemini-3.5-flash";
  const calibrationVersion = env.SCORE_CALIBRATION_VERSION || "v0";
  return { scoreModel, fallbackModel: fallbackModel.trim() || null, calibrationVersion };
}

/**
 * Skor motoru anahtarı (engine spec §9.1). Kod varsayılanı "legacy": dağıtım davranışı değiştirmez.
 * "hybrid.v2": Claude puan cetveli + ortanca-3 + kalibrasyon h2 (CONTRACTS_V2.md §4; lib/config/engine.h2.server.ts).
 */
export const SCORE_ENGINES = ["legacy", "hybrid.v1", "hybrid.v2"] as const;
export type ScoreEngine = (typeof SCORE_ENGINES)[number];
export const DEFAULT_SCORE_ENGINE: ScoreEngine = "legacy";

/** SCORE_ENGINE okur; eksik veya geçersiz değerde "legacy" döner, asla fırlatmaz. Üretim kapısı ayrıdır (scoreEngineBlocked). */
export function getScoreEngine(env: Record<string, string | undefined> = process.env): ScoreEngine {
  const v = env.SCORE_ENGINE?.trim();
  return (SCORE_ENGINES as readonly string[]).includes(v ?? "") ? (v as ScoreEngine) : DEFAULT_SCORE_ENGINE;
}

/** Motorun ölçüm/hukuk hazırlığı (engine spec §9.2). Değerler server-only motor yapılandırmasında tutulur. */
export type EngineReadiness = {
  norms: "provisional" | "fitted";
  categories: "provisional" | "fitted";
  legal: "pending" | "approved";
};

/** Üretim kapısı (engine spec §9.2), saf: VERCEL_ENV=production iken hybrid.v1 (veya koç için Claude) yalnız
 *  norms ve categories "fitted" ve legal "approved" ise çalışır. true → çağıran engine_not_ready ile durur. */
export function scoreEngineBlocked(
  env: Record<string, string | undefined>,
  readiness: EngineReadiness,
  path: "score" | "coach" = "score",
): boolean {
  if (env.VERCEL_ENV !== "production") return false;
  const wantsClaude =
    path === "score" ? getScoreEngine(env) !== "legacy" : env.AI_COACH_PROVIDER?.trim() === "claude";
  if (!wantsClaude) return false;
  return readiness.norms !== "fitted" || readiness.categories !== "fitted" || readiness.legal !== "approved";
}
