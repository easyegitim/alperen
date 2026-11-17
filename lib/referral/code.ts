// Davet kodu (KB P#15/Ç12). Saf; tarayıcı ve Node (globalThis.crypto). Kod kişisel veri taşımaz (rastgele).
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // karıştırılabilen karakterler (0/O, 1/I) yok
export const REFERRAL_CODE_RE = /^DV-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

export function generateReferralCode(random: (n: number) => Uint8Array = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n))): string {
  const bytes = random(8);
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return `DV-${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Kullanıcı girişini normalize eder: boşluk/tire toleransı, büyük harf (alfabede O/I/0/1 yok); geçersizse null. */
export function normalizeReferralCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^DV/, "");
  if (raw.length !== 8) return null;
  const code = `DV-${raw.slice(0, 4)}-${raw.slice(4)}`;
  return REFERRAL_CODE_RE.test(code) ? code : null;
}
