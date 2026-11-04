// Paywall tetikleyicileri ve analitik teaser kodları (UI spec S4, §8.2). Analitiğe giden değerler skor/metrik/e-posta
// içermez: "overall", "lengthRatio", "@" veya "/9j/" geçmez (privacy.spec adım 3; tests/unit/paywallConfig.test.ts).
import { SUB_KEYS_V2, type TeaserMode } from "./teaser";

export const PAYWALL_TRIGGERS = [
  "score_main",
  "score_potential",
  "improve_first",
  "measurements",
  "plan",
  "plan_page",
  // v2: kaşlar (sub_brows) dahil; v1 ekranı yalnız ilk altısını üretir.
  ...SUB_KEYS_V2.map((k) => `sub_${k}` as const),
] as const satisfies readonly string[];

export type PaywallTrigger = (typeof PAYWALL_TRIGGERS)[number];

/** paywall_viewed.teaserMode'da gönderilen kısa kod (ham mod adı "overall_only" privacy.spec'e takılır). */
export const TEASER_ANALYTICS_CODE: Record<TeaserMode, string> = {
  shape_plus_one: "t_spo",
  overall_only: "t_oo",
  shape_only: "t_so",
};
