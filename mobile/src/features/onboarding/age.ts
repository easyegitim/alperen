import { MIN_BIRTH_YEAR, currentYearIstanbul } from "@/lib/onboarding/age";

/** Doğum yılı metin girişi: 4 haneli, 1900..bu yıl. Yaş kararı sunucuda (POST /api/onboarding/age). */
export function parseBirthYear(input: string, currentYear = currentYearIstanbul()): number | null {
  const s = input.trim();
  if (!/^\d{4}$/.test(s)) return null;
  const y = Number(s);
  if (y < MIN_BIRTH_YEAR || y > currentYear) return null;
  return y;
}
