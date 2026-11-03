export type ClassValue = string | false | null | undefined;

/** Sınıf adlarını birleştirir; yanlış değerleri atar. Çağıranın className'i en sona gelir. */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(' ');
}

/** Klavye odak halkası: her etkileşimli denetimde (odak asla gizlenmez). */
export const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-transparent focus-visible:shadow-focus-ring';
