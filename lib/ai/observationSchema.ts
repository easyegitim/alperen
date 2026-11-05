import { z } from "zod";

// observe.v1 gözlem şeması (engine spec §2.1; sözleşme C2). Saf. Serbest metin ve sayı yok: her string alan bir enum,
// tek diğer yaprak boolean. Yalnız görünür, geçici ve değiştirilebilir bakım, cilt yüzeyi, saç bakımı ve fotoğraf
// koşulları. Yüz/beden şekli, çekicilik, yaş, cinsiyet, etnik köken, din veya örtü etiketi yoktur.

export const ObservationOutput = z.object({
  photo: z.object({
    faceCount: z.enum(["one", "none", "multiple"]),
    lighting: z.enum(["even", "uneven", "harsh_or_dim"]),
    skinVisibility: z.enum(["clear", "partly_obscured", "obscured"]),
    retouch: z.enum(["none", "possible", "likely"]),
  }),
  skin: z.object({
    blemishes: z.enum(["none", "few", "several", "many", "unclear"]),
    blemishZone: z.enum(["none", "forehead", "cheeks", "chin_jaw", "t_zone", "widespread"]),
    texture: z.enum(["smooth", "slightly_uneven", "uneven", "unclear"]),
    evenness: z.enum(["even", "mostly_even", "uneven", "unclear"]),
    shine: z.enum(["balanced", "some", "very", "unclear"]),
    shineZone: z.enum(["none", "t_zone", "forehead", "cheeks", "widespread"]),
    visibleSkinConcern: z.boolean(),
    concernZone: z.enum(["none", "forehead", "cheeks", "chin_jaw", "widespread"]),
  }),
  hair: z.object({
    visibility: z.enum(["visible", "very_short", "partly_visible", "no_visible_hair", "not_visible"]),
    neatness: z.enum(["neat", "slightly_untidy", "untidy", "unclear"]),
    shape: z.enum(["defined", "softening", "grown_out", "unclear"]),
  }),
  grooming: z.object({
    brows: z.enum(["tidy", "few_strays", "unruly", "unclear"]),
    lips: z.enum(["smooth", "slightly_dry", "dry_cracked", "unclear"]),
    facialHair: z.enum(["none_visible", "stubble", "short_beard", "full_beard", "unclear"]),
    facialHairEdges: z.enum(["defined", "soft", "untidy", "not_applicable", "unclear"]),
  }),
});

export type Observation = z.infer<typeof ObservationOutput>;

type Group = keyof Observation;
/** "skin.blemishes" biçiminde alan yolu. */
export type FieldPath = { [G in Group]: { [K in keyof Observation[G]]: `${G}.${K & string}` }[keyof Observation[G]] }[Group];
/** Bir alan yolunun değer tipi. */
export type FieldValue<P extends FieldPath> = P extends `${infer G extends Group}.${infer K}`
  ? K extends keyof Observation[G]
    ? Observation[G][K]
    : never
  : never;

/** Derecelendirilen sıralı alanlar (§2.6 oylama kuralı; skora giren veya giremeyen ama sıralı olan bakım öğeleri). */
export const GRADED_ITEMS = [
  "skin.blemishes",
  "skin.texture",
  "skin.evenness",
  "skin.shine",
  "hair.neatness",
  "hair.shape",
  "grooming.brows",
  "grooming.lips",
] as const satisfies readonly FieldPath[];
export type GradedItem = (typeof GRADED_ITEMS)[number];

/** Tüm sıralı alanlar: derecelendirilenler + sakal hattı + fotoğraf kapıları. Kalan alanlar nominaldir. */
export const ORDINAL_FIELDS = [
  ...GRADED_ITEMS,
  "grooming.facialHairEdges",
  "photo.lighting",
  "photo.skinVisibility",
  "photo.retouch",
] as const satisfies readonly FieldPath[];
export type OrdinalField = (typeof ORDINAL_FIELDS)[number];

/**
 * Her sıralı alanın derecelendirilmiş değerleri, kötüden iyiye (fotoğraf alanlarında: zordan elverişliye).
 * "unclear" ve "not_applicable" sıraya girmez; oylamada ayrı ele alınır (§2.6).
 */
export const ORDER = {
  "skin.blemishes": ["many", "several", "few", "none"],
  "skin.texture": ["uneven", "slightly_uneven", "smooth"],
  "skin.evenness": ["uneven", "mostly_even", "even"],
  "skin.shine": ["very", "some", "balanced"],
  "hair.neatness": ["untidy", "slightly_untidy", "neat"],
  "hair.shape": ["grown_out", "softening", "defined"],
  "grooming.brows": ["unruly", "few_strays", "tidy"],
  "grooming.lips": ["dry_cracked", "slightly_dry", "smooth"],
  "grooming.facialHairEdges": ["untidy", "soft", "defined"],
  "photo.lighting": ["harsh_or_dim", "uneven", "even"],
  "photo.skinVisibility": ["obscured", "partly_obscured", "clear"],
  "photo.retouch": ["likely", "possible", "none"],
} as const satisfies { [P in OrdinalField]: readonly FieldValue<P>[] };

/** Bir gözlemden alan yolundaki değeri okur. */
export function readField<P extends FieldPath>(o: Observation, path: P): FieldValue<P> {
  const [g, k] = path.split(".") as [Group, string];
  return (o[g] as Record<string, unknown>)[k] as FieldValue<P>;
}
