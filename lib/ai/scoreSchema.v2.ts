import { z } from "zod";
import { SUB_KEYS_V2 } from "@/lib/config/teaser";
import { VIEW_KEYS } from "@/lib/face/views";
import { FaceShapeKey, NOT_ASSESSED_REASONS, REGION_KEYS } from "@/lib/score/contract";

// hybrid.v2 puan cetveli çıktısı (PLAN_V2 3c; KB §4.1, §4.9, §4.11, §5). Claude bu şemayla yanıt verir
// (output_config.format json_schema). Metinler Türkçe; sayılar yalnız `score` ve `gain` alanlarında (düz yazıda sayı
// yok). Kod: ortanca, kalibrasyon, tavan ve kilit kurallarını uygular. Sayısal ve dizi sınırları şemada DEĞİL,
// normalizeScoreOutputV2'de uygulanır: toAnthropicJsonSchema min/max/maxItems'ı atar, Claude kısıtlanmaz; katı safeParse
// 4. gözlem ya da 10,2 puan gibi taşmalarda ~$0,10'luk tüm çalıştırmayı düşürüyordu. Enum ve zorunlu alanlar katı kalır.
// Şema, görsel, landmark, kimlik, yaş, etnik köken veya din içeren hiçbir alan taşımaz (K14).

export const CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;
export const LIGHTING = ["even", "uneven", "harsh_or_dim"] as const;
export const RETOUCH = ["none", "possible", "likely"] as const;
export const SKIN_VISIBILITY = ["clear", "partly_obscured", "obscured"] as const;
export const FACIAL_HAIR = ["none_visible", "stubble", "short_beard", "full_beard"] as const;
export const HAIR_LOSS_SIGNAL = ["none", "possible", "visible", "not_visible"] as const;
export const PHOTO_CARE = ["careful", "casual", "careless"] as const;

/** Bir plan adımına bağlı yükseltme (KB §4.9 "ne yapılırsa artar"; K2 her kazanç bir adıma bağlı). */
export const RaiseItem = z.object({
  /** content/ kataloğu kimliği (planSteps.ts listesinden); kod doğrular, bilinmeyen kimlik düşer. */
  stepId: z.string(),
  /** Beklenen etki, nötr dille, sayı yok ("hafif", "belirgin"). */
  effect: z.string(),
  /** Bu adımın alt skora ham katkısı (0–1,5; kod kenetler; yapısal alt skorlarda kod 0 yazar). */
  gain: z.number(),
});
export type RaiseItem = z.infer<typeof RaiseItem>;

export const SubAssessment = z.object({
  /** Cetvel puanı 1–10, bir ondalık (kod kenetler); kod ortanca ve kalibrasyon uygular. */
  score: z.number(),
  confidence: z.enum(CONFIDENCE_LEVELS),
  /** Neye baktık: 2–3 somut gözlem (kod ilk 3'ü alır). */
  lookedAt: z.array(z.string()),
  /** Puanı ne tuttu (ilk 3). */
  held: z.array(z.string()),
  /** Puanı ne aşağı çekti (en fazla 2, nötr dille; yapısal alanda "tarif", yargı yok). */
  lowered: z.array(z.string()),
  raise: z.array(RaiseItem),
});
export type SubAssessment = z.infer<typeof SubAssessment>;

export const RegionV2 = z.object({
  key: z.enum(REGION_KEYS),
  /** Önce somut bir güçlü yan. */
  strength: z.string(),
  /** Fotoğrafta görülen (tarif). */
  seen: z.string(),
  /** En fazla iki fırsat (kod ilk 2'yi alır); boş = "değişiklik gerekmez". Yapısal bölgelerde yalnız stil/algı. */
  improvements: z.array(z.string()),
});

export const ScoreOutputV2 = z.object({
  photo: z.object({
    faceCount: z.enum(["one", "none", "multiple"]),
    /** Hangi etiketli görünümler gerçekten o açıyı gösteriyor (profil değilse listelenmez). */
    viewsUsable: z.array(z.enum(VIEW_KEYS)),
    lighting: z.enum(LIGHTING),
    retouch: z.enum(RETOUCH),
    skinVisibility: z.enum(SKIN_VISIBILITY),
  }),
  subscores: z.object(Object.fromEntries(SUB_KEYS_V2.map((k) => [k, SubAssessment])) as Record<(typeof SUB_KEYS_V2)[number], typeof SubAssessment>),
  /** excluded: başörtüsü / görünür saç yok (ağırlık 0); not_visible: bu çekimde görülmedi. */
  notAssessed: z.array(z.object({ sub: z.enum(SUB_KEYS_V2), reason: z.enum(NOT_ASSESSED_REASONS) })),
  observations: z.object({
    facialHair: z.enum(FACIAL_HAIR),
    oilyHair: z.boolean(),
    photoCare: z.enum(PHOTO_CARE),
    /** Cilt yüzeyi: tarif, teşhis yok. */
    skinSurface: z.string(),
    /** Fotoğrafta görünen diğer bakım ayrıntıları (R1-W4; kod ilk 3'ü alır). */
    other: z.array(z.string()),
  }),
  /** Claude'un yüz şekli görüşü (çoklu açı); geometriyle kod uzlaştırır (Ç8). */
  faceShapeOpinion: z.object({ shape: FaceShapeKey, secondary: FaceShapeKey.nullable(), reason: z.string() }).nullable(),
  glassesDetected: z.boolean(),
  headCoveringDetected: z.boolean(),
  hairLossSignal: z.enum(HAIR_LOSS_SIGNAL),
  report: z.object({
    /** Açılış mektubu: 3–4 cümle; en güçlü yan ve en büyük fırsat. */
    letter: z.string(),
    /** Dokuz bölge; tekrar eden anahtar ilkiyle kalır, fazlası düşer (kod). */
    regions: z.array(RegionV2),
    /** Kapanış: değişim haftalar sürer; ışık ve açı; tıbbi tavsiye değildir. */
    closing: z.string(),
  }),
  /** Yalnız "… için bir dermatoloğa göstermek faydalı olabilir" kalıbı; teşhis yok (K11). */
  seeProfessional: z.object({ text: z.string() }).nullable(),
});
export type ScoreOutputV2 = z.infer<typeof ScoreOutputV2>;

/** Sözleşme sınırları (eski şema tavanları); normalizeScoreOutputV2 uygular. */
export const SCORE_V2_LIMITS = { score: [1, 10], gain: [0, 1.5], lookedAt: 3, held: 3, lowered: 2, raise: 3, improvements: 2, other: 3 } as const;

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);
const uniq = <T>(a: readonly T[]) => [...new Set(a)];

/**
 * Şema sonrası kenetleme: puan 1–10, kazanç 0–1,5, listeler sözleşme tavanına kırpılır, enum listeleri tekilleşir,
 * bölgelerde tekrar eden anahtar ilkiyle kalır. Saf; bir çalıştırmayı taşma yüzünden düşürmek yerine düzeltir.
 */
export function normalizeScoreOutputV2(out: ScoreOutputV2): ScoreOutputV2 {
  const seenRegion = new Set<string>();
  const regions = out.report.regions.filter((r) => (seenRegion.has(r.key) ? false : (seenRegion.add(r.key), true))).map((r) => ({ ...r, improvements: r.improvements.slice(0, SCORE_V2_LIMITS.improvements) }));
  const subscores = Object.fromEntries(
    Object.entries(out.subscores).map(([k, a]) => [
      k,
      {
        ...a,
        score: clamp(a.score, SCORE_V2_LIMITS.score[0], SCORE_V2_LIMITS.score[1]),
        lookedAt: a.lookedAt.slice(0, SCORE_V2_LIMITS.lookedAt),
        held: a.held.slice(0, SCORE_V2_LIMITS.held),
        lowered: a.lowered.slice(0, SCORE_V2_LIMITS.lowered),
        raise: a.raise.slice(0, SCORE_V2_LIMITS.raise).map((r) => ({ ...r, gain: clamp(r.gain, SCORE_V2_LIMITS.gain[0], SCORE_V2_LIMITS.gain[1]) })),
      },
    ]),
  ) as ScoreOutputV2["subscores"];
  return {
    ...out,
    photo: { ...out.photo, viewsUsable: uniq(out.photo.viewsUsable) },
    subscores,
    notAssessed: out.notAssessed.filter((n, i, arr) => arr.findIndex((m) => m.sub === n.sub) === i),
    observations: { ...out.observations, other: out.observations.other.slice(0, SCORE_V2_LIMITS.other) },
    report: { ...out.report, regions },
  };
}
