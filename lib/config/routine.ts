// Affedici seri (PLAN_V2 Faz 6 "Rutin: affedici seri (dinlenme günü, aylık dondurma) [ÖNERİ]"; CONTRACTS_V2 Sprint 3).
// ÖNERİ / CLAUDE NOTU: kurucu kararı yok; sayılar yer tutucudur ve env ile değişir. Kural: dinlenme günü otomatik
// (haftada N eksik gün seriyi bozmaz), dondurma kullanıcı eylemi (ayda M kez). Saf; sunucu ve mobil aynı dosyayı okur.
export type RoutineForgivingConfig = {
  /** Haftada kaç eksik gün otomatik affedilir (ISO haftası, Pzt–Paz). */
  restDaysPerWeek: number;
  /** Ayda kaç kez "seriyi dondur" kullanılabilir. */
  freezesPerMonth: number;
};

export const ROUTINE_FORGIVING = {
  restDaysPerWeek: 1,
  freezesPerMonth: 1,
  /** true: KB'de karar yok (ÖNERİ); arayüz "öneri aşamasında" notunu gösterir (routine.v2.placeholderNote). */
  placeholder: true,
} as const satisfies RoutineForgivingConfig & { placeholder: boolean };

export const ROUTINE_FORGIVING_LIMITS = { restDaysPerWeek: { min: 0, max: 3 }, freezesPerMonth: { min: 0, max: 4 } } as const;

function clampInt(raw: string | undefined, fallback: number, lim: { min: number; max: number }): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(lim.max, Math.max(lim.min, n));
}

/** Env: ROUTINE_REST_DAYS_PER_WEEK (0–3), ROUTINE_FREEZES_PER_MONTH (0–4). Mobilde EXPO_PUBLIC_ önekiyle aynı adlar. */
export function getRoutineForgiving(env: Record<string, string | undefined> = process.env): RoutineForgivingConfig {
  return {
    restDaysPerWeek: clampInt(env.ROUTINE_REST_DAYS_PER_WEEK ?? env.EXPO_PUBLIC_ROUTINE_REST_DAYS_PER_WEEK, ROUTINE_FORGIVING.restDaysPerWeek, ROUTINE_FORGIVING_LIMITS.restDaysPerWeek),
    freezesPerMonth: clampInt(env.ROUTINE_FREEZES_PER_MONTH ?? env.EXPO_PUBLIC_ROUTINE_FREEZES_PER_MONTH, ROUTINE_FORGIVING.freezesPerMonth, ROUTINE_FORGIVING_LIMITS.freezesPerMonth),
  };
}
