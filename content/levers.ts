// engine spec §6.4: geliştirilebilir alanların kaldıraçları. Saf katalog (mobil içe aktarabilir); etiketler
// messages/tr.json "analysis.levers.*" altında. Adımlar yalnız content/skin-steps.ts ve content/habits.ts kimlikleridir.
import type { LeverKey, ModSub } from "@/lib/score/contract";

/** Motorun puanladığı (veya yalnız gözlediği) bakım öğeleri. evenness gözlenir, puanlanmaz. */
export const LEVER_ITEMS = ["blemishes", "texture", "evenness", "shine", "hairNeat", "hairShape", "brows", "lips", "facialHairEdges"] as const;
export type LeverItemKey = (typeof LEVER_ITEMS)[number];

export type Lever = {
  sub: ModSub;
  item: LeverItemKey;
  /** Plan adımları (skin-steps / habits kimlikleri). */
  steps: readonly string[];
  /** Raporun katalogdan seçeceği stil önerisi. */
  presets?: "hair" | "beard";
};

export const LEVERS: Record<LeverKey, Lever> = {
  lv_blemish_care: { sub: "skin", item: "blemishes", steps: ["st_cleanser_gentle", "st_cleanser_evening", "st_clay_mask_weekly"] },
  lv_texture_smooth: { sub: "skin", item: "texture", steps: ["st_exfoliant_weekly", "st_hydrating_serum", "st_moisturizer_light"] },
  // Skor kazancı yok (evenness puanlanmaz); "önce odaklan" listesine hiç girmez, raporda alışkanlık olarak kalır.
  lv_daily_spf: { sub: "skin", item: "evenness", steps: ["st_spf", "hb_sun"] },
  lv_shine_balance: { sub: "skin", item: "shine", steps: ["st_cleanser_foaming", "st_moisturizer_light", "st_clay_mask_weekly"] },
  lv_hair_styling: { sub: "hair", item: "hairNeat", steps: ["st_hair_conditioner"] },
  lv_haircut_refresh: { sub: "hair", item: "hairShape", steps: [], presets: "hair" },
  // Plan adımı yok (st_brow_tidy onaylı bir içerik değişikliğiyle eklenene kadar): "önce odaklan"a girmez.
  lv_brow_tidy: { sub: "grooming", item: "brows", steps: [] },
  lv_lip_care: { sub: "grooming", item: "lips", steps: ["st_lip_balm"] },
  lv_beard_lineup: { sub: "grooming", item: "facialHairEdges", steps: ["st_beard_oil"], presets: "beard" },
};

/** Kaldıracın plana bağlanan bir adımı veya stil önerisi var mı (engine spec §6.3). */
export function hasPlanRoute(k: LeverKey): boolean {
  const l = LEVERS[k];
  return l.steps.length > 0 || l.presets !== undefined;
}
