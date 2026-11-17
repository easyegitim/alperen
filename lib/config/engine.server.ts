import "server-only";

import type { LeverItemKey } from "@/content/levers";
import type { Observation } from "@/lib/ai/observationSchema";
import { OBSERVE_MAX_TOKENS, type EngineStatus } from "@/lib/config/ai.server";
import type { SubKeyV1 } from "@/lib/config/teaser";
import type { ModSub } from "@/lib/score/contract";

// hybrid.v1 motor yapılandırması (engine spec §1.1, §3–6). Yalnız sunucu: bantlar, ağırlıklar, deltalar, kapılar ve
// erişim kuralları istemciye gitmez; mobil ESLint "@/lib/config/*.server" içe aktarımını engeller. Böylece kilitli bir
// alt skor cihazda yeniden hesaplanamaz. Kullanıcı başına değişen hiçbir değer yoktur: herkes için aynı kurallar.

export const ENGINE = { version: "hybrid.v1", promptVersion: "observe.v2", calibrationVersion: "h1" } as const;

/**
 * Ölçüm ve hukuk hazırlığı (engine spec §9.2). Üretimde motor yalnız norms ve categories "fitted", legal "approved"
 * iken açılır (assertEngineReady). Değiştirmek SPEC Bölüm 19 sürüm kapısını ve kullanıcı onayını gerektirir.
 */
export const ENGINE_STATUS: EngineStatus = { norms: "provisional", categories: "provisional", legal: "pending" };

/** signals.norms: bant ve deltaların hangi önsel/ölçüm setinden geldiği. */
export const ENGINE_NORMS_ID = "prior-2026-10";

/** §5.1: 0,40 yapı (yalnız ceza) + 0,60 geliştirilebilir alanlar. */
export const WEIGHTS_H1: Record<SubKeyV1, number> = { harmony: 0.15, eyes: 0.1, jawline: 0.15, skin: 0.2, hair: 0.2, grooming: 0.2 };
/** §4.4: saç hariç (beyan edilen başörtüsü veya başta görünür saç yok). Saç ağırlığı yalnız cilt ve bakıma gider; yapı 0,40 kalır. */
export const WEIGHTS_H1_HAIR_EXCLUDED: Record<SubKeyV1, number> = { harmony: 0.15, eyes: 0.1, jawline: 0.15, skin: 0.3, hair: 0, grooming: 0.3 };

/** Referans profilin her alt skoru ve geneli. amp: yapısal alt skor ∈ [5,5 − amp, 5,5]. */
export const STRUCT = { reference: 5.5, amp: 2.0 } as const;

export type StructSub = "harmony" | "eyes" | "jawline";
export type ComponentKey = "symFace" | "vertical" | "eyeMouth" | "spacing" | "symEyes" | "tilt" | "jawWidth" | "symLower";

export type Band =
  | { kind: "twoSided"; c: number; h: number; r: number }
  | { kind: "oneSided"; h: number; r: number };

/**
 * pose-filtered: cihazda poz süzülmüş kareler (g = 1). pitch/yaw: son karenin pozuyla yumuşak kapı. none: kapı yok.
 */
export type GateKind = "poseFiltered" | "pitch" | "yaw" | "none";

/**
 * §3.5 bantları: herkes için tek bant (yayımlanan erkek ve kadın aralıklarının birleşimi). Cinsiyet, sunum veya köken
 * girdisi yoktur. Yalnız ceza; düz sıfır-ceza bölgesi. Bir yeniden uydurma (scripts/refit-engine.ts) bantları yalnız genişletebilir.
 */
export const BANDS: Record<ComponentKey, { sub: StructSub; w: number; band: Band; gate: GateKind }> = {
  symFace: { sub: "harmony", w: 0.45, band: { kind: "oneSided", h: 0.02, r: 0.04 }, gate: "poseFiltered" },
  vertical: { sub: "harmony", w: 0.3, band: { kind: "twoSided", c: 1.11, h: 0.17, r: 0.25 }, gate: "pitch" },
  eyeMouth: { sub: "harmony", w: 0.25, band: { kind: "twoSided", c: 0.39, h: 0.035, r: 0.05 }, gate: "poseFiltered" },
  spacing: { sub: "eyes", w: 0.4, band: { kind: "twoSided", c: 0.4725, h: 0.0425, r: 0.04 }, gate: "yaw" },
  symEyes: { sub: "eyes", w: 0.35, band: { kind: "oneSided", h: 0.02, r: 0.04 }, gate: "poseFiltered" },
  tilt: { sub: "eyes", w: 0.25, band: { kind: "twoSided", c: 5.5, h: 8.5, r: 6 }, gate: "none" },
  jawWidth: { sub: "jawline", w: 0.55, band: { kind: "twoSided", c: 0.85, h: 0.1, r: 0.1 }, gate: "yaw" },
  symLower: { sub: "jawline", w: 0.45, band: { kind: "oneSided", h: 0.025, r: 0.045 }, gate: "poseFiltered" },
};

/** §3.2: tüm-kare metriklerinde yumuşak kapı ramp(|açı|, full, zero). */
export const POSE_GATES = { full: 8, zero: 12 } as const;

/** §3.2: ölçülemeyen bileşen puan düşürmez. Sabit; uydurulmaz. */
export const MISSING_PEN = 0;

/** Bakım öğeleri (content/levers.ts ile tek sözlük). */
export type ItemKey = LeverItemKey;

/** Öğe → gözlem alanı ve alt skor. */
export const ITEM_FIELDS = {
  blemishes: { sub: "skin", group: "skin", field: "blemishes" },
  texture: { sub: "skin", group: "skin", field: "texture" },
  evenness: { sub: "skin", group: "skin", field: "evenness" },
  shine: { sub: "skin", group: "skin", field: "shine" },
  hairNeat: { sub: "hair", group: "hair", field: "neatness" },
  hairShape: { sub: "hair", group: "hair", field: "shape" },
  brows: { sub: "grooming", group: "grooming", field: "brows" },
  lips: { sub: "grooming", group: "grooming", field: "lips" },
  facialHairEdges: { sub: "grooming", group: "grooming", field: "facialHairEdges" },
} as const satisfies Record<ItemKey, { sub: ModSub; group: keyof Observation; field: string }>;

/** Puanlanan öğeler, alt skora göre sabit sırada (evenness yok: gözlenir, puanlanmaz). */
export const SCORED_ITEMS: Record<ModSub, readonly ItemKey[]> = {
  skin: ["blemishes", "texture", "shine"],
  hair: ["hairNeat", "hairShape"],
  grooming: ["brows", "lips", "facialHairEdges"],
};

/**
 * §4.2–4.4 kategori deltaları (ham alt skor puanı; referans kategori 0). unclear / not_applicable → IMPUTE_DELTA.
 * Kaş ve sakal hattı yalnız ceza: tipik kategori referanstır, ne alınmış kaş ne sakal yokluğundan fazla kazandırır.
 */
export const CATEGORY_DELTAS = {
  blemishes: { none: 1.0, few: 0, several: -0.8, many: -1.6 },
  texture: { smooth: 1.0, slightly_uneven: 0, uneven: -0.8 },
  evenness: { even: 0, mostly_even: 0, uneven: 0 },
  shine: { balanced: 0.6, some: 0, very: -0.5 },
  hairNeat: { neat: 1.0, slightly_untidy: 0, untidy: -1.0 },
  hairShape: { defined: 1.0, softening: 0, grown_out: -1.0 },
  brows: { tidy: 0, few_strays: 0, unruly: -0.5 },
  lips: { smooth: 0.8, slightly_dry: 0, dry_cracked: -0.8 },
  facialHairEdges: { defined: 0, soft: 0, untidy: -0.5 },
} as const satisfies Record<ItemKey, Record<string, number>>;

/** Referans (tipik) kategori: delta 0; oylamada iki oy ayrışırsa sonuç buna doğru çekilir (§2.6). */
export const REF_CATEGORY = {
  blemishes: "few",
  texture: "slightly_uneven",
  evenness: "mostly_even",
  shine: "some",
  hairNeat: "slightly_untidy",
  hairShape: "softening",
  brows: "few_strays",
  lips: "slightly_dry",
  facialHairEdges: "soft",
} as const satisfies { [K in ItemKey]: keyof (typeof CATEGORY_DELTAS)[K] };

/** Belirsiz öğenin değeri (önsel 0; uydurma ancak §12 kapısıyla). */
export const IMPUTE_DELTA: Record<ItemKey, number> = {
  blemishes: 0,
  texture: 0,
  evenness: 0,
  shine: 0,
  hairNeat: 0,
  hairShape: 0,
  brows: 0,
  lips: 0,
  facialHairEdges: 0,
};

/** §4.2: güzelleştirme filtresi cildi referansın üstüne çıkaramaz (yalnız pozitif cilt deltaları çarpılır). */
export const RETOUCH_FACTOR: Record<Observation["photo"]["retouch"], number> = { none: 1, possible: 0.5, likely: 0 };
/** §4.5: kısmen kapalı κ'yı küçültmez (sakal, kâkül ve uzun saç için tavan farkı yaratırdı). */
export const SKIN_VISIBILITY_FACTOR: Record<Observation["photo"]["skinVisibility"], number> = { clear: 1, partly_obscured: 1, obscured: 0 };

/** §6.1: 8–12 haftada gerçekçi hedef. one_better: bir kategori iyi; best: en iyi; none: kazanç yok. */
export const REACH: Record<ItemKey, "one_better" | "best" | "none"> = {
  blemishes: "one_better",
  texture: "one_better",
  evenness: "none",
  shine: "best",
  hairNeat: "best",
  hairShape: "best",
  brows: "best",
  lips: "best",
  facialHairEdges: "best",
};

/** §6.2: alt skor kazanç tavanları (ham puan). maxAboveOverall 1,5 ve absoluteMax 9,5 POTENTIAL'dan gelir. */
export const POTENTIAL_H1 = { caps: { skin: 2.0, hair: 2.0, grooming: 2.0 } } as const;

/** §2.5 gözlem orkestrasyonu. maxTokens izi B'nin OBSERVE_MAX_TOKENS sabitidir (tek kaynak). */
export const OBSERVE = {
  calls: 3,
  quorum: 2,
  deadlineMs: 40_000,
  attemptTimeoutMs: 30_000,
  retryMinRemainingMs: 18_000,
  maxAttempts: 5,
  maxTokens: OBSERVE_MAX_TOKENS,
  /** agreement bu değerin altındaysa yalnız sağlık logu (skoru etkilemez). */
  lowAgreementLog: 0.6,
} as const;

/** §9.6 koç raporu (iz D). */
export const COACH = { maxTokens: 16_000, attemptTimeoutMs: 90_000, minRemainingForRetryMs: 45_000, deadlineMs: 110_000 } as const;

/** §3.6 sunucu çekim kapısı (istemci kapısından geniş; yalnız kurcalanmış veya eski çekimleri durdurur). */
export const SERVER_CAPTURE_GATE = { yawMax: 12, pitchMax: 15, rollMax: 10, brightness: [55, 225] as const, sharpnessMin: 35 } as const;

/** §4.5 tek adım bütçeleri (genel skor puanı); saç hariç satırlarda belgelenmiş istisna. */
export const FLIP_BUDGET = { standard: 0.2, hairExcluded: 0.3 } as const;
export const GATE_BUDGET = { standard: 0.35, hairExcluded: 0.4 } as const;

/** §6.3 "önce odaklan". */
export const IMPROVE_FIRST = { n: 3, minGain: 0.05 } as const;

/** §5.3 genişletme kolu; h1'de 1,0. Değişirse yeni calibration_version (h1.1) ve kullanıcı onayı gerekir. */
export const MOD_GAIN = 1.0;
