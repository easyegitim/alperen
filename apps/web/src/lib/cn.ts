/** Sınıf adlarını birleştirir (yanlış değerleri atar). */
export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}
