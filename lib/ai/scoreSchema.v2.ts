import { z } from "zod";
import { SUB_KEYS_V2 } from "@/lib/config/teaser";
import { VIEW_KEYS } from "@/lib/face/views";
import { FaceShapeKey, NOT_ASSESSED_REASONS, REGION_KEYS } from "@/lib/score/contract";

// hybrid.v2 puan cetveli çıktısı (PLAN_V2 3c; KB §4.1, §4.9, §4.11, §5). Claude bu şemayla yanıt verir
// (output_config.format json_schema; sınırlar sunucuda). Metinler Türkçe; sayılar yalnız `score` ve `gain`
// alanlarında (düz yazıda sayı yok). Kod: ortanca, kalibrasyon, tavan ve kilit kurallarını uygular.
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
  /** Bu adımın alt skora ham katkısı (0–1,5; yapısal alt skorlarda kod 0 yazar). */
  gain: z.number().min(0).max(1.5),
});
export type RaiseItem = z.infer<typeof RaiseItem>;

export const SubAssessment = z.object({
  /** Cetvel puanı 1–10, bir ondalık; kod ortanca ve kalibrasyon uygular. */
  score: z.number().min(1).max(10),
  confidence: z.enum(CONFIDENCE_LEVELS),
  /** Neye baktık: 2–3 somut gözlem. */
  lookedAt: z.array(z.string()).max(3),
  /** Puanı ne tuttu. */
  held: z.array(z.string()).max(3),
  /** Puanı ne aşağı çekti (en fazla 2, nötr dille; yapısal alanda "tarif", yargı yok). */
  lowered: z.array(z.string()).max(2),
  raise: z.array(RaiseItem).max(3),
});
export type SubAssessment = z.infer<typeof SubAssessment>;

export const RegionV2 = z.object({
  key: z.enum(REGION_KEYS),
  /** Önce somut bir güçlü yan. */
  strength: z.string(),
  /** Fotoğrafta görülen (tarif). */
  seen: z.string(),
  /** En fazla iki fırsat; boş = "değişiklik gerekmez". Yapısal bölgelerde yalnız stil/algı. */
  improvements: z.array(z.string()).max(2),
});

export const ScoreOutputV2 = z.object({
  photo: z.object({
    faceCount: z.enum(["one", "none", "multiple"]),
    /** Hangi etiketli görünümler gerçekten o açıyı gösteriyor (profil değilse listelenmez). */
    viewsUsable: z.array(z.enum(VIEW_KEYS)).max(VIEW_KEYS.length),
    lighting: z.enum(LIGHTING),
    retouch: z.enum(RETOUCH),
    skinVisibility: z.enum(SKIN_VISIBILITY),
  }),
  subscores: z.object(Object.fromEntries(SUB_KEYS_V2.map((k) => [k, SubAssessment])) as Record<(typeof SUB_KEYS_V2)[number], typeof SubAssessment>),
  /** excluded: başörtüsü / görünür saç yok (ağırlık 0); not_visible: bu çekimde görülmedi. */
  notAssessed: z.array(z.object({ sub: z.enum(SUB_KEYS_V2), reason: z.enum(NOT_ASSESSED_REASONS) })).max(SUB_KEYS_V2.length),
  observations: z.object({
    facialHair: z.enum(FACIAL_HAIR),
    oilyHair: z.boolean(),
    photoCare: z.enum(PHOTO_CARE),
    /** Cilt yüzeyi: tarif, teşhis yok. */
    skinSurface: z.string(),
    /** Fotoğrafta görünen diğer bakım ayrıntıları (R1-W4). */
    other: z.array(z.string()).max(3),
  }),
  /** Claude'un yüz şekli görüşü (çoklu açı); geometriyle kod uzlaştırır (Ç8). */
  faceShapeOpinion: z.object({ shape: FaceShapeKey, secondary: FaceShapeKey.nullable(), reason: z.string() }).nullable(),
  glassesDetected: z.boolean(),
  headCoveringDetected: z.boolean(),
  hairLossSignal: z.enum(HAIR_LOSS_SIGNAL),
  report: z.object({
    /** Açılış mektubu: 3–4 cümle; en güçlü yan ve en büyük fırsat. */
    letter: z.string(),
    regions: z.array(RegionV2).max(REGION_KEYS.length),
    /** Kapanış: değişim haftalar sürer; ışık ve açı; tıbbi tavsiye değildir. */
    closing: z.string(),
  }),
  /** Yalnız "… için bir dermatoloğa göstermek faydalı olabilir" kalıbı; teşhis yok (K11). */
  seeProfessional: z.object({ text: z.string() }).nullable(),
});
export type ScoreOutputV2 = z.infer<typeof ScoreOutputV2>;
