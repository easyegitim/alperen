import type { TryonMode } from "@/lib/tryon/types";

// Sanal deneme v2 yapılandırması (KB §7, R2-C10, Ç10; PLAN_V2 5b–5d; CONTRACTS_V2 Sprint 2). Env'den okunur, koda gömülmez.
// Model adları: KB R2-C10/2 "sağlayıcılar yarışmasın", sağlayıcı seçimi AÇIK (§11.6). PLAN 5c gemini-3.1-flash-image öneriyor;
// varsayılan bugünkü model kalır (lite), kurucu TRYON_IMAGE_MODEL ile değiştirir. Kullanılabilirlik uydurulmaz.

export const TRYON_IMAGE_MODEL_DEFAULT = "gemini-3.1-flash-lite-image";
export const TRYON_QC_MODEL_DEFAULT = "claude-opus-5-5";
/** Kontrolden geçmeyen görsel en fazla iki kez yeniden üretilir; yine geçmezse "Bu fotoğrafla bu stil iyi sonuç vermedi" (Ç10). */
export const TRYON_QC_MAX_REGEN_DEFAULT = 2;

export type TryonConfig = {
  /** Görsel modeli: TRYON_IMAGE_MODEL > GEMINI_IMAGE_MODEL (eski ad) > varsayılan. */
  imageModel: string;
  /** Claude kalite kontrolü (R2-C10/3 KARAR). off: kontrol yapılmaz (yalnız geliştirme/test; üretimde açık). */
  qc: "on" | "off";
  qcModel: string;
  qcEffort: "low" | "medium" | "high";
  /** 0–3; varsayılan 2. */
  qcMaxRegen: number;
  /** Mod başına kota ağırlığı (reserve_tryon p_weight). Deneme kotası ve fiyat AÇIK (KB §11.2): hepsi 1 yer tutucu. */
  weights: Record<TryonMode, number>;
  weightsPlaceholder: true;
};

type Env = Record<string, string | undefined>;
const clean = (v: string | undefined) => (v?.trim() ? v.trim() : undefined);
function intIn(v: string | undefined, min: number, max: number, fallback: number): number {
  const n = Number(clean(v));
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}
function weight(v: string | undefined): number {
  return intIn(v, 1, 5, 1);
}

export function getTryonConfig(env: Env = process.env): TryonConfig {
  const effort = clean(env.TRYON_QC_EFFORT);
  return {
    imageModel: clean(env.TRYON_IMAGE_MODEL) ?? clean(env.GEMINI_IMAGE_MODEL) ?? TRYON_IMAGE_MODEL_DEFAULT,
    qc: clean(env.TRYON_QC)?.toLowerCase() === "off" ? "off" : "on",
    qcModel: clean(env.TRYON_QC_MODEL) ?? TRYON_QC_MODEL_DEFAULT,
    qcEffort: effort === "medium" || effort === "high" ? effort : "low",
    qcMaxRegen: intIn(env.TRYON_QC_MAX_REGEN, 0, 3, TRYON_QC_MAX_REGEN_DEFAULT),
    weights: { style: weight(env.TRYON_WEIGHT_STYLE), combo: weight(env.TRYON_WEIGHT_COMBO), glow_up: weight(env.TRYON_WEIGHT_GLOW_UP) },
    weightsPlaceholder: true,
  };
}

/**
 * Glow-up kapıları (PLAN 5d; ÖNERİ — eşikler ilk deneme kapısında ölçülür, kurucu onayı). Yalnız kodda uygulanır:
 * - featuresOnlyOpacity: features_only maskesinin koruma opaklığı (0,8): göz/kaş/burun/dudak orijinalden, ton geçişi yumuşak.
 * - minTextureRatio: cilt bölgesinde çıktı yüksek frekans enerjisi / orijinal ≥ 0,55 — altı "aşırı pürüzsüz" (skin_over_smoothed), gösterilmez.
 * - maxTextureRatio: ≤ 1,6 — üstü doku uydurma/bozukluk işareti.
 * - maxSkinToneShift: cilt bölgesinde ortalama L* farkı ≤ 6 (ten rengi korunur, Ç9).
 * - hfRewriteStrength: yüksek frekans doku geri yazımı karışımı (0,5): orijinal ben/çil/iz/gözenek dokusu korunur.
 * - geometri sapması: lib/tryon/composite.ts TRYON_LIMITS aynen (uzunluk/çene ≤ %3; kemik yapısı değişmez).
 */
export const GLOW_UP_GATE = {
  featuresOnlyOpacity: 0.8,
  minTextureRatio: 0.55,
  maxTextureRatio: 1.6,
  maxSkinToneShift: 6,
  hfRewriteStrength: 0.5,
  placeholder: true,
} as const;

/** Combo kuralı (R1-E7): saç + sakal zorunlu çift; renk isteğe bağlı. Tek parça = style modu. */
export const TRYON_COMBO_MIN_PARTS = 2;
