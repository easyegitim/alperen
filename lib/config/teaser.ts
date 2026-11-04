import { z } from "zod";

// SPEC 5.3 (VARSAYILAN). Mod ve alt skor PostHog bayrağıyla A/B test edilebilir.
export const TEASER_MODES = ["shape_plus_one", "overall_only", "shape_only"] as const;
export type TeaserMode = (typeof TEASER_MODES)[number];

/** legacy ve hybrid.v1 motorlarının 6 alt skoru (SPEC 8.1). Bu motorların şemaları ve ağırlıkları yalnız bu listeyi kullanır. */
export const SUB_KEYS_V1 = ["harmony", "eyes", "jawline", "skin", "hair", "grooming"] as const;
export type SubKeyV1 = (typeof SUB_KEYS_V1)[number];

/** hybrid.v2 (KB §4.11, R1-W5): kaşlar ayrı alt skor. Sıra = ekran sırası. */
export const SUB_KEYS_V2 = [...SUB_KEYS_V1, "brows"] as const;
export type SubKeyV2 = (typeof SUB_KEYS_V2)[number];

/**
 * Alt skor anahtarı (tüm motorlar): v1 altılısı + "brows". Record<SubKey, …> her sabitte kaş girdisi ister;
 * eski satırlarda kaş değeri yoktur ve present.ts bunu "değerlendirilmedi" (null, kilitsiz) olarak sunar.
 */
export type SubKey = SubKeyV2;

/**
 * Geriye uyumlu liste: eski motor kodu, teaser ve mevcut arayüz 6 anahtar üzerinden döner. hybrid.v2 arayüzü
 * SUB_KEYS_V2 kullanır (CONTRACTS_V2.md §3).
 */
export const SUB_KEYS: readonly SubKeyV1[] = SUB_KEYS_V1;

export function isSubKey(v: string): v is SubKey {
  return (SUB_KEYS_V2 as readonly string[]).includes(v);
}

const TeaserEnv = z.object({
  TEASER_MODE: z.enum(TEASER_MODES).default("shape_plus_one"),
  TEASER_SUBSCORE: z.enum(SUB_KEYS_V1).default("skin"),
});

export type TeaserConfig = { mode: TeaserMode; subscore: SubKeyV1 };

/** Geçersiz veya eksik değerde varsayılana düşer; asla fırlatmaz. */
export function getTeaserConfig(env: Record<string, string | undefined> = process.env): TeaserConfig {
  const parsed = TeaserEnv.safeParse({
    TEASER_MODE: env.TEASER_MODE || undefined,
    TEASER_SUBSCORE: env.TEASER_SUBSCORE || undefined,
  });
  const v = parsed.success ? parsed.data : TeaserEnv.parse({});
  return { mode: v.TEASER_MODE, subscore: v.TEASER_SUBSCORE };
}
