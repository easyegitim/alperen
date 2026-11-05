// Plan sayfasındaki "planın şunlara göre hazırlandı" yankısı (UI spec §7, F09). Saf ve paylaşılabilir (mobil de kullanabilir).
// Kural: beden ölçüsü (boy, kilo, VKİ, aktivite) ve serbest not ASLA yankılanmaz (SPEC 9.4; istem enjeksiyonu riski).
import type { GOALS, Questionnaire } from "@/lib/questionnaire";
import { BEARD_LEVERS, type ImproveItem, type LeverKey } from "@/lib/score/contract";

export type Goal = (typeof GOALS)[number];
export type BasisChipKey = "goal" | "skinType" | "budget" | "minutes" | "hairType" | "beard" | "headCovering" | "glasses" | "jawHealth";
/** values: anket seçenek anahtarları (arayüzde questionnaire.options.* ile çevrilir) veya dakika sayısı. */
export type BasisChip = { key: BasisChipKey; values?: Record<string, string | number> };
export type PlanSkips = { hair?: true; exercises?: true; beard?: true };
export type ReportSection = "skin" | "hair" | "beard";

type BasisInput = Pick<
  Questionnaire,
  "goals" | "presentation" | "hairType" | "beardPreference" | "skinType" | "budget" | "minutesPerDay" | "glasses" | "headCovering" | "jawHealth"
>;

/** Sakal içeriği yok: kadın sunumu veya "sakal yok" tercihi (C9, C11). */
function beardOff(q: Pick<Questionnaire, "presentation" | "beardPreference">): boolean {
  return q.presentation === "female" || q.beardPreference === "none";
}

export function planBasis(q: BasisInput): BasisChip[] {
  const chips: BasisChip[] = q.goals.map((g) => ({ key: "goal", values: { value: g } }));
  chips.push({ key: "skinType", values: { value: q.skinType } });
  chips.push({ key: "budget", values: { value: q.budget } });
  chips.push({ key: "minutes", values: { n: q.minutesPerDay } });
  if (q.headCovering) chips.push({ key: "headCovering" });
  else chips.push({ key: "hairType", values: { value: q.hairType } });
  if (!beardOff(q)) chips.push({ key: "beard", values: { value: q.beardPreference } });
  if (q.glasses) chips.push({ key: "glasses" });
  // Çene sağlığı: koşullar listelenmez; tek genel çip.
  if (q.jawHealth.length > 0) chips.push({ key: "jawHealth" });
  return chips;
}

/** Ankete göre bilerek eklenmeyen bölümler (SPEC 9.8: başörtüsü → saç yok; jawHealth → egzersiz yok). */
export function planSkips(q: Pick<Questionnaire, "headCovering" | "jawHealth" | "presentation" | "beardPreference">): PlanSkips {
  const s: PlanSkips = {};
  if (q.headCovering) s.hair = true;
  if (q.jawHealth.length > 0) s.exercises = true;
  if (beardOff(q)) s.beard = true;
  return s;
}

const LEVER_SECTION: Record<LeverKey, ReportSection | null> = {
  lv_blemish_care: "skin",
  lv_texture_smooth: "skin",
  lv_daily_spf: "skin",
  lv_shine_balance: "skin",
  // st_lip_balm bir cilt rutini adımı.
  lv_lip_care: "skin",
  lv_hair_styling: "hair",
  lv_haircut_refresh: "hair",
  lv_beard_lineup: "beard",
  // Plan rotası yok; improve-first'e zaten girmez (C9).
  lv_brow_tidy: null,
};

/** Öncelik maddesinin bağlanacağı rapor bölümü. */
export function leverSection(l: LeverKey): ReportSection | null {
  return LEVER_SECTION[l];
}

/** İlk öncelik maddesinin alanı seçilen hedeflerden biriyse o hedef (bakım ↔ sakal yalnız sakal kaldıraçlarında). */
export function goalMatch(goals: readonly Goal[], first: ImproveItem | undefined): Goal | null {
  if (!first) return null;
  const goal: Goal | null = first.sub === "grooming" ? (BEARD_LEVERS.includes(first.lever) ? "beard" : null) : first.sub;
  return goal && goals.includes(goal) ? goal : null;
}
