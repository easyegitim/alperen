// SPEC 9.4 (D10): yağ oranı/kalori içeriği yalnız VKİ ≥ 25 iken ve günlük açık ≤ 500 kcal. Saf fonksiyonlar.
export const BMI_OVERWEIGHT = 25;
export const BMI_OBESE = 30;
export const BMI_UNDERWEIGHT = 18.5;
export const MAX_DAILY_DEFICIT_KCAL = 500;

export type BodyMode =
  | "deficit" // VKİ ≥ 25: ılımlı açık, kayıp sınırı, protein, kuvvet, uyku, tuz/alkol
  | "debloat" // 18,5 ≤ VKİ < 25: kilo verme yok; şişlik azaltma + kuvvet
  | "none" // VKİ < 18,5 veya kısıtlama sinyali: kilo/kalori içeriği hiç yok
  | "unknown"; // boy/kilo verilmemiş: genel şişlik ipuçları

export type BodyRules = {
  mode: BodyMode;
  /** Modelin promptundaki faceContours.enabled. */
  faceContoursEnabled: boolean;
  dietitianSuggested: boolean;
  /** Nazik "bir hekim veya diyetisyenle konuşmak faydalı olabilir" notu. */
  gentleProfessionalNote: boolean;
};

/** Not alanında aşırı kısıtlama / hızlı kilo verme isteği (SPEC 9.4 üçüncü satır). */
const RESTRICTION_PATTERNS = [
  /a[cç]\s*kal/i,
  /h[ıi]zl[ıi]\s*(kilo|zay[ıi]f)/i,
  /\b\d{2,}\s*kilo\s*(ver|vermek|verme|at)/i,
  /\bzay[ıi]flama\s*(hap|çay|cay)/i,
  /oru[cç]\s*(protokol|tut)/i,
  /ö[gğ][üu]n\s*atl[aıi]/i,
  /kus(mak|uyorum|arak)/i,
  /yemek\s*yemiyorum/i,
  /detoks/i,
  /500\s*kalori/i,
  /\bçok\s*az\s*ye/i,
];

export function hasRestrictionSignal(note: string | undefined | null): boolean {
  if (!note) return false;
  return RESTRICTION_PATTERNS.some((re) => re.test(note));
}

export function bodyRules(input: { bmi: number | null; note?: string | null }): BodyRules {
  if (hasRestrictionSignal(input.note)) {
    return { mode: "none", faceContoursEnabled: false, dietitianSuggested: false, gentleProfessionalNote: true };
  }
  if (input.bmi === null) return { mode: "unknown", faceContoursEnabled: false, dietitianSuggested: false, gentleProfessionalNote: false };
  if (input.bmi < BMI_UNDERWEIGHT) return { mode: "none", faceContoursEnabled: false, dietitianSuggested: false, gentleProfessionalNote: true };
  if (input.bmi >= BMI_OVERWEIGHT) return { mode: "deficit", faceContoursEnabled: true, dietitianSuggested: input.bmi >= BMI_OBESE, gentleProfessionalNote: false };
  return { mode: "debloat", faceContoursEnabled: false, dietitianSuggested: false, gentleProfessionalNote: false };
}

/** Metinde kalori/kilo içeriği var mı (filtre ve testler için). */
export const WEIGHT_CONTENT_RE = /\b(kcal|kalori|kilo\s*ver|açık\s*(oluştur|yarat)|yağ\s*oran)/i;
