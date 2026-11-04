export const MIN_AGE = 18;
export const MIN_BIRTH_YEAR = 1900;

/** Europe/Istanbul'a göre içinde bulunulan yıl. */
export function currentYearIstanbul(now: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Istanbul", year: "numeric" }).format(now));
}

/**
 * Yalnız doğum yılı alınır (SPEC 4.1 adım 3). Yıl farkı tam 18 olan kişi doğum gününe göre 17 de olabilir;
 * "kullanıcı güvenliği ve hukuk" önceliğiyle bu belirsiz yıl 18+ SAYILMAZ (yıl farkı ≥ 19 gerekir).
 * AÇIK: kurucu isterse eşik 18'e indirilir veya belirsiz yılda ay sorulur.
 */
export function isAdultByBirthYear(birthYear: number, currentYear: number = currentYearIstanbul()): boolean {
  if (!Number.isInteger(birthYear)) return false;
  return currentYear - birthYear > MIN_AGE;
}

/** Yaş seçicide listelenecek yıllar: en yeni önce, 1900'e kadar. */
export function selectableBirthYears(currentYear: number = currentYearIstanbul()): number[] {
  const years: number[] = [];
  for (let y = currentYear; y >= MIN_BIRTH_YEAR; y--) years.push(y);
  return years;
}

// ── v2: yaş bandı (KB P#1/Ç1, CONTRACTS_V2 §5) ───────────────────────────────────────────────────────────────────────
/** Umax tarzı serbest liste; under_18 FEATURE_UNDER_18 kapalıyken "yakında" ekranına düşer (PLAN Ç-G). */
export const AGE_BANDS = ["under_18", "18_24", "25_34", "35_49", "50_plus"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export function isAgeBand(v: unknown): v is AgeBand {
  return typeof v === "string" && (AGE_BANDS as readonly string[]).includes(v);
}

/** is_adult = band under_18 değil (sunucu yazar; under_18 sütunu generated). */
export function isAdultByAgeBand(band: AgeBand): boolean {
  return band !== "under_18";
}
