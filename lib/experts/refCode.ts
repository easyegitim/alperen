import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// SPEC 12.3 adım 4–5: benzersiz ref_code ve partnerin e-postadaki imzalı linkle durum güncellemesi.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // karıştırılabilen karakterler yok

export function generateRefCode(): string {
  const bytes = randomBytes(8);
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return `AU-${s.slice(0, 4)}-${s.slice(4)}`;
}

export const REFERRAL_STATUSES = ["sent", "contacted", "booked", "completed", "cancelled"] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

function secret(env: Record<string, string | undefined>): string {
  const s = env.REFERRAL_SIGNING_SECRET;
  if (!s) throw new Error("REFERRAL_SIGNING_SECRET eksik");
  return s;
}

export function signStatusLink(refCode: string, status: ReferralStatus, env: Record<string, string | undefined> = process.env): string {
  return createHmac("sha256", secret(env)).update(`${refCode}:${status}`).digest("hex");
}

export function verifyStatusLink(refCode: string, status: string, sig: string, env: Record<string, string | undefined> = process.env): boolean {
  if (!(REFERRAL_STATUSES as readonly string[]).includes(status)) return false;
  const expected = Buffer.from(signStatusLink(refCode, status as ReferralStatus, env), "hex");
  const given = Buffer.from(sig || "", "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}
