// hybrid.v1 istemci sözlüğü (UI spec §1.1, engine spec §7.3/§8, sözleşme C5). Saf, paylaşılan, mobilden içe aktarılabilir.
// Yalnız sözlük: eşik, bant, delta veya ağırlık burada yok (bunlar server-only motor dosyalarında).
// Motor analyses.signals'ın istemciye giden kısmını tam bu biçimde yazar; bu tipleri yeniden tanımlamaz.
import { z } from "zod";
import { SUB_KEYS, SUB_KEYS_V2, type SubKey } from "@/lib/config/teaser";
import type { FaceShape } from "@/lib/face/types";

export const ENGINE_NAMES = ["hybrid.v1", "hybrid.v2", "legacy"] as const;
export type EngineName = (typeof ENGINE_NAMES)[number];

export const MOD_SUBS = ["skin", "hair", "grooming"] as const;
export type ModSub = (typeof MOD_SUBS)[number];

export type SubKind = "structural" | "partial" | "modifiable";

/** Motorun 9 kaldıracı (engine spec §6.4). Anahtar sırası = "önce odaklan" eşitlik sırası. */
export const LEVER_SUB = {
  lv_blemish_care: "skin",
  lv_texture_smooth: "skin",
  lv_daily_spf: "skin",
  lv_shine_balance: "skin",
  lv_hair_styling: "hair",
  lv_haircut_refresh: "hair",
  lv_brow_tidy: "grooming",
  lv_lip_care: "grooming",
  lv_beard_lineup: "grooming",
} as const satisfies Record<string, ModSub>;
export type LeverKey = keyof typeof LEVER_SUB;
export const LEVER_KEYS = Object.keys(LEVER_SUB) as LeverKey[];
export const BEARD_LEVERS: readonly LeverKey[] = ["lv_beard_lineup"];

export const STRUCTURAL_EXPLAIN_KEYS = ["symmetry", "vertical", "eyeMouth", "spacing", "tilt", "jawWidth"] as const;
/** evenness gözlenir ama puanlanmaz; açıklama öğesi yoktur. */
export const MOD_EXPLAIN_KEYS = ["blemishes", "texture", "shine", "hairNeat", "hairShape", "brows", "lips", "facialHairEdges"] as const;
export type StructuralExplainKey = (typeof STRUCTURAL_EXPLAIN_KEYS)[number];
export type ModExplainKey = (typeof MOD_EXPLAIN_KEYS)[number];
/** Yapısal öğeler yalnız ölçüldü/ölçülmedi taşır; hiçbir yapısal durum yüzü yargılamaz. */
export type ExplainItem =
  | { key: StructuralExplainKey; status: "measured" | "not_measured" }
  | { key: ModExplainKey; status: "best" | "partial" | "unclear" };

/** Saç ipucu yoktur (hiçbir metin örtülü saçı göstermeyi istemez). */
export const CAPTURE_HINTS = ["lighting", "pose", "skin_visibility", "retouch"] as const;
export type CaptureHint = (typeof CAPTURE_HINTS)[number];

/** excluded: beyan edilen başörtüsü veya başta görünür saç yok (ağırlık 0; herkese açık).
 *  not_visible: bu çekimde görünmedi (referansla doldurulur; yalnız alt skor açıksa gösterilir). */
export const NOT_ASSESSED_REASONS = ["excluded", "not_visible"] as const;
export type NotAssessedReason = (typeof NOT_ASSESSED_REASONS)[number];
export type NotAssessed = { sub: ModSub; reason: NotAssessedReason };

/** gain: genel skor puanı, 1 ondalık, > 0. */
export type ImproveItem = { sub: ModSub; lever: LeverKey; gain: number };

const ExplainItemSchema = z.union([
  z.object({ key: z.enum(STRUCTURAL_EXPLAIN_KEYS), status: z.enum(["measured", "not_measured"]) }),
  z.object({ key: z.enum(MOD_EXPLAIN_KEYS), status: z.enum(["best", "partial", "unclear"]) }),
]);

/** analyses.signals'ın istemciyle ilgili kısmı (SignalsV1 bunu genişletir); present.ts'te ayrıştırılır. Bilinmeyen anahtarlar atılır. */
export const ClientSignals = z.object({
  engine: z.literal("hybrid.v1"),
  improveFirst: z
    .array(
      z.object({
        sub: z.enum(MOD_SUBS),
        lever: z.enum(LEVER_KEYS as [LeverKey, ...LeverKey[]]),
        gain: z.number().positive().max(2),
      }),
    )
    .max(3),
  explain: z.partialRecord(z.enum(SUB_KEYS), z.array(ExplainItemSchema).max(8)),
  notAssessed: z.array(z.object({ sub: z.enum(MOD_SUBS), reason: z.enum(NOT_ASSESSED_REASONS) })),
  captureHints: z.array(z.enum(CAPTURE_HINTS)),
});
export type ClientSignals = z.infer<typeof ClientSignals>;

export function isModSub(k: SubKey): k is ModSub {
  return (MOD_SUBS as readonly string[]).includes(k);
}

// ─── hybrid.v2 istemci sözleşmesi (CONTRACTS_V2.md §3; KB §3.3, §4.5–4.10, §5) ─────────────────────────────────────
// Saf, paylaşılan. Ağırlık, cetvel, eşik yok. Sunucu (present.ts toClientAnalysisV2) kilit kurallarını uygular.


/** analyses.status (migration 0010). processing = eski motorlar (legacy, hybrid.v1) iş sırasında. */
export const ANALYSIS_STATUSES = ["device_only", "queued", "running", "processing", "completed", "failed"] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

/** İstemci aşaması; "processing" satırları istemciye "running" olarak gider. */
export const ANALYSIS_STAGES = ["device_only", "queued", "running", "completed", "failed"] as const;
export type AnalysisStage = (typeof ANALYSIS_STAGES)[number];

/** Kart kart açılış (P#23): analyses.sections_ready bu anahtarlardan oluşur; sıra = açılış sırası. */
export const SECTION_KEYS = ["device", "overall", "subscores", "potential", "faceShape", "explanations", "improveFirst", "report"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

/** Rapor bölgeleri (KB §5/2): kaş, göz çevresi, burun, dudak ve gülüş, elmacık ve yanak, çene hattı, cilt, saç, sakal. */
export const REGION_KEYS = ["brows", "eyeArea", "nose", "lipsSmile", "cheeks", "jawline", "skin", "hair", "beard"] as const;
export type RegionKey = (typeof REGION_KEYS)[number];

/** Ölçüler kartındaki oranlar (KB §5/3): cihaz değerleri tek kaynak (P#12). */
export const MEASURE_KEYS = ["canthalTiltDeg", "jawRatio", "fwhr", "thirds"] as const;
export type MeasureKey = (typeof MEASURE_KEYS)[number];

export const FaceShapeKey = z.enum(["oval", "round", "square", "long", "heart", "diamond"]);

/** Ödeme öncesi cihaz sonucu (P§1, P#9, P#12): herkese açık. analyses.device_result ile aynı biçim. */
export const DeviceResult = z.object({
  ratios: z.object({
    canthalTiltDeg: z.number(),
    jawRatio: z.number(),
    fwhr: z.number(),
    thirds: z.object({ upper: z.number().nullable(), middle: z.number(), lower: z.number() }),
  }),
  faceShapePrelim: z.object({ primary: FaceShapeKey, secondary: FaceShapeKey.optional(), confidence: z.number().min(0).max(1) }),
});
export type DeviceResult = z.infer<typeof DeviceResult>;

/** [alt, üst]; tek ondalık; değer aralığın içindedir (KB §4.5). */
export type ScoreRange = [number, number];
export type ScoreV2 = { value: number; range: ScoreRange };
/** Genel skor: yüzdelik yalnız burada ve yalnız FEATURE_PERCENTILE açıkken (Ç6); davet kilidinde range ve percentile null. */
export type OverallV2 = { value: number; range: ScoreRange | null; percentile: number | null };
/** delta = round1(max(0, potential − overall)); en fazla +1,5, en çok 9,5 (K2). */
export type PotentialV2 = { value: number; range: ScoreRange; delta: number };

/** KB §4.9 beş satır. Metinler denetimden (audit) ve safety.ts'ten geçmiş, nötr dille. */
export const ExplanationV2 = z.object({
  lookedAt: z.array(z.string().max(200)).max(3),
  held: z.array(z.string().max(200)).max(3),
  lowered: z.array(z.string().max(200)).max(2),
  raise: z.array(z.object({ step: z.string().max(160), effect: z.string().max(120) })).max(3),
  confidenceNote: z.string().max(200),
});
export type ExplanationV2 = z.infer<typeof ExplanationV2>;

/** "Önce odaklan" (P#13: 3 satır). stepId katalog kimliği (kod doğrular); gain genel skor puanı. */
export const ImproveItemV2 = z.object({ sub: z.enum(SUB_KEYS_V2), stepId: z.string().max(80), step: z.string().max(160), gain: z.number().min(0).max(1.5) });
export type ImproveItemV2 = z.infer<typeof ImproveItemV2>;

/** Rapor v3 iskeleti (KB §5). Plan ve "iyileşmiş halin" ayrı uçlardan gelir. */
export const ReportV3 = z.object({
  version: z.literal("report.v3"),
  /** 3–4 cümle: en güçlü yan ve en büyük fırsat. */
  letter: z.string().max(900),
  regions: z
    .array(
      z.object({
        key: z.enum(REGION_KEYS),
        strength: z.string().max(300),
        seen: z.string().max(400),
        /** En fazla iki fırsat (improvements); boş dizi = "değişiklik gerekmez". */
        improvements: z.array(z.string().max(300)).max(2),
      }),
    )
    .max(REGION_KEYS.length),
  /** Dengeli aralık çubuğu: kıyas yalnız aralıkla (yüzdelik yok). */
  measures: z.array(z.object({ key: z.enum(MEASURE_KEYS), value: z.number(), balancedRange: z.tuple([z.number(), z.number()]) })).max(MEASURE_KEYS.length),
  /** Değişim haftalar sürer; ışık ve açı; "Tıbbi tavsiye değildir." */
  closing: z.string().max(600),
});
export type ReportV3 = z.infer<typeof ReportV3>;

/** Yüz şekli (Ç8): ön değerlendirme kalır; detaylı farklıysa ikisi birlikte ve nedeniyle; kullanıcı düzeltmesi geçerli olur. */
export type FaceShapeV2 = {
  prelim: DeviceResult["faceShapePrelim"];
  /** Yalnız açık sonuçta (ödeme sonrası); Claude + çoklu açı. */
  detailed?: { shape: FaceShape; secondary?: FaceShape; reason: string };
  /** true: ön ve detaylı aynı; false: "emin değiliz", ikisi gösterilir; null: detaylı yok. */
  agree: boolean | null;
  /** profiles.face_shape_override ("Bence değil"); saç/sakal önerileri buna göre. */
  override?: FaceShape;
};

/** analyses.signals (v2) — istemciye giden kısmı; sunucu kısmı (runs, ham puanlar) asla gitmez. */
export const ClientSignalsV2 = z.object({
  engine: z.literal("hybrid.v2"),
  explanations: z.partialRecord(z.enum(SUB_KEYS_V2), ExplanationV2),
  improveFirst: z.array(ImproveItemV2).max(3),
  notAssessed: z.array(z.object({ sub: z.enum(SUB_KEYS_V2), reason: z.enum(NOT_ASSESSED_REASONS) })),
  faceShapeDetailed: z.object({ shape: FaceShapeKey, secondary: FaceShapeKey.optional(), reason: z.string().max(300) }).nullable(),
  /** Çekim ipuçları (ışık, poz, …) herkese açık. */
  captureHints: z.array(z.enum(CAPTURE_HINTS)),
  /** Kaç açı kullanıldı (güven notu için; fotoğraf içermez). */
  viewsUsed: z.array(z.string()).max(6),
});
export type ClientSignalsV2 = z.infer<typeof ClientSignalsV2>;

/** Başarısızlık: hak düşmez; yeniden deneme akışı (P#22 notu). */
export type AnalysisFailure = { code: "AI_FAILED" | "AI_TIMEOUT" | "AI_SAFETY_BLOCKED" | "NO_FACE" | "CAPTURE_QUALITY"; retryable: boolean };

export function isSubKeyV2(k: string): k is SubKey {
  return (SUB_KEYS_V2 as readonly string[]).includes(k);
}
