// Bütçe bantları (KB §6.6 TASLAK, AÇIK §11.3; PLAN 4c). Bant adları sözleşme (lib/config/plan.ts), tutarlar burada ve
// messages/tr.json questionnaire.v2.options.* içinde. Kurucu tutarları verene kadar `placeholder: true`.
import { BUDGET_BANDS, BUDGET_BAND_TRY, ONE_TIME_BUDGET_BANDS, ONE_TIME_BUDGET_BAND_TRY, type BudgetBand, type OneTimeBudgetBand } from "@/lib/config/plan";
import { COST_BANDS, COST_BAND_TRY, type CostBand } from "@/lib/coach/knowledge";

export const BUDGET_PLACEHOLDER = true as const;

export type BudgetBandDef = { id: BudgetBand; minTry: number; maxTry: number | null };
export const MONTHLY_BUDGET: readonly BudgetBandDef[] = BUDGET_BANDS.map((id) => ({ id, minTry: BUDGET_BAND_TRY[id].min, maxTry: BUDGET_BAND_TRY[id].max }));

export type OneTimeBudgetDef = { id: OneTimeBudgetBand; minTry: number | null; maxTry: number | null };
export const ONE_TIME_BUDGET: readonly OneTimeBudgetDef[] = ONE_TIME_BUDGET_BANDS.map((id) => {
  const r = ONE_TIME_BUDGET_BAND_TRY[id];
  return { id, minTry: r?.min ?? null, maxTry: r?.max ?? null };
});

/** Aylık bütçe bandının üst sınırı içinde kalan maliyet bantları (saf). 5000_plus → hepsi. */
export function costBandsWithinBudget(band: BudgetBand): CostBand[] {
  const max = BUDGET_BAND_TRY[band].max;
  return COST_BANDS.filter((c) => max === null || COST_BAND_TRY[c].min <= max);
}

/** Bir TL aralığı bandın üst sınırını aşıyor mu (aylık). Üst sınırı açık aralık (max null) yalnız 5000_plus içinde "uyar". */
export function exceedsBudget(cost: { min: number; max: number | null }, band: BudgetBand): boolean {
  const max = BUDGET_BAND_TRY[band].max;
  if (max === null) return false;
  return cost.min > max;
}
