import "server-only";

import { SUB_KEYS_V2, type SubKey, type SubKeyV1 } from "@/lib/config/teaser";
import { WEIGHTS_H1 } from "@/lib/config/engine.server";

// hybrid.v2 ("claude-rubric") motor yapılandırması — CONTRACTS_V2.md §4, PLAN_V2 §2 Faz 3, KB §4.1–4.7.
// Yalnız sunucu (mobil ESLint "@/lib/config/*.server" içe aktarımını engeller). Kullanıcıya göre değişen değer yoktur:
// kalibrasyon, ağırlık ve tavanlar herkes için aynıdır (K1). Ödeme, plan veya kampanya girdisi yoktur.

export const ENGINE_H2 = { version: "hybrid.v2", promptVersion: "score.v2", calibrationVersion: "h2" } as const;

/**
 * Yapısal üçlünün (uyum, göz, çene) kaynağı (PLAN_V2 Ç-A):
 *  - claude:   yalnız Claude cetvel puanı
 *  - geometry: yalnız cihaz geometrisi bant puanı (hybrid.v1 kodu, aynı ölçeğe eşlenir)
 *  - blend:    0,5 Claude + 0,5 geometri (varsayılan). Anthropic teyidi olumsuzsa tek ayarla "geometry".
 */
export const STRUCTURAL_SOURCES = ["claude", "geometry", "blend"] as const;
export type StructuralSource = (typeof STRUCTURAL_SOURCES)[number];
export const DEFAULT_STRUCTURAL_SOURCE: StructuralSource = "blend";
/** blend'de Claude payı; geometri payı 1 − bu. */
export const BLEND_CLAUDE_WEIGHT = 0.5;

/** Kalibrasyon h2 (KB §4.4): ham → z → ölçek; merkez ve yayılım yapılandırılabilir. Referans set gelince sıra eşlemesi eklenir. */
export const CALIBRATION_H2_DEFAULT = { center: 5.5, sd: 1.5, min: 1.0, max: 9.8 } as const;
export type CalibrationH2 = { center: number; sd: number; min: number; max: number };

/** Ortanca-3 tutarlılığı (KB §4.1–4.2): alt skorlardan herhangi birinde yayılım > 0,5 ise 4. çalıştırma; en çok 4. */
export const CONSENSUS = { runs: 3, extraRunIfSpread: 0.5, maxRuns: 4 } as const;

/** Potansiyel (K2): en fazla +1,5, en çok 9,5; her kazanç bir plan adımına bağlı. */
export const POTENTIAL_H2 = { maxAboveOverall: 1.5, absoluteMax: 9.5 } as const;

/** Yeniden analizde ±0,3'ten küçük fark "değişim yok" (KB §4.2/4). */
export { NOISE_BAND } from "@/lib/config/scoring";

/** Aynı dosya seti (bayt bayt) bu süre boyunca aynı skoru alır (Ç11); analysis_sets.expires_at. */
export const SET_CACHE_DAYS = 365;

/** Kaş alt skorunun eklenmeden önceki ham ağırlığı (R1-W5 önerisi: 0,06); toplam yeniden 1'e normalize edilir. */
export const BROWS_RAW_WEIGHT = 0.06;

function renormalise(w: Record<SubKey, number>): Record<SubKey, number> {
  const sum = SUB_KEYS_V2.reduce((s, k) => s + w[k], 0);
  return Object.fromEntries(SUB_KEYS_V2.map((k) => [k, w[k] / sum])) as Record<SubKey, number>;
}

/** h2 ağırlıkları: hybrid.v1'in 6 ağırlığı + brows 0,06, toplam 1'e normalize. */
export const SUB_WEIGHTS_H2: Record<SubKey, number> = renormalise({ ...(WEIGHTS_H1 as Record<SubKeyV1, number>), brows: BROWS_RAW_WEIGHT });

/** Yapısal üçlü; blend/geometry yalnız bunlara uygulanır. */
export const STRUCTURAL_SUBS_H2 = ["harmony", "eyes", "jawline"] as const satisfies readonly SubKey[];

type Env = Record<string, string | undefined>;

function num(v: string | undefined, min: number, max: number, fallback: number): number {
  const t = v?.trim();
  const n = t ? Number(t) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

/** STRUCTURAL_SOURCE okur; geçersiz veya boşsa "blend". Asla fırlatmaz. */
export function getStructuralSource(env: Env = process.env): StructuralSource {
  const v = env.STRUCTURAL_SOURCE?.trim();
  return (STRUCTURAL_SOURCES as readonly string[]).includes(v ?? "") ? (v as StructuralSource) : DEFAULT_STRUCTURAL_SOURCE;
}

/** CALIBRATION_H2_CENTER (3–8) ve CALIBRATION_H2_SD (0,5–3) okur; geçersizde varsayılan (5,5 / 1,5). */
export function getCalibrationH2(env: Env = process.env): CalibrationH2 {
  return {
    center: num(env.CALIBRATION_H2_CENTER, 3, 8, CALIBRATION_H2_DEFAULT.center),
    sd: num(env.CALIBRATION_H2_SD, 0.5, 3, CALIBRATION_H2_DEFAULT.sd),
    min: CALIBRATION_H2_DEFAULT.min,
    max: CALIBRATION_H2_DEFAULT.max,
  };
}

/** Set önbelleği HMAC anahtarı adı; değer yalnız sunucuda okunur, loglanmaz. Yoksa önbellek kapalı (model her sette çağrılır). */
export const SET_CACHE_SECRET_ENV = "SET_CACHE_SECRET";
