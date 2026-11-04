// Yüz şekli, fs-v2 (KB §4.10, PLAN_V2 1d). Kural tabanlı; eşikler tek nesnede. Ön değerlendirme (cihaz) ve sunucu
// yeniden hesabı aynı fonksiyonu kullanır (captureGate). Sonuç her zaman "en yakın iki şekil" taşır: "Kare, ovale yakın".
//
// Neden v2: ağın tepe noktası (10) saç çizgisi değildir; 10→152 uzunluğu gerçek yüz yüksekliğinin ~%85–92'sidir ve
// 234–454 genişliği elmacıktan biraz geniştir. v1 eşikleri (yuvarlak < 1,30) bu yüzden oval/uzun yüzleri "Yuvarlak"
// diyordu. v2: saç çizgisi bulunduysa saç çizgisi→çene uzunluğu (faceLengthRatio) kullanılır; bulunmadıysa 10→152
// uzunluğu MESH_TOP_TO_HAIRLINE ile ölçeklenir. Eşikler bu "etkin uzunluk" ölçeğinde yeniden konuldu; gönüllü
// fotoğraflarıyla kalibrasyon bekler (geçici değerler, docs/calibration.md).
import type { FaceShape, GeometryResult } from "./types";

export const FACE_SHAPE_VERSION = "fs-v2" as const;

export type ShapeMetrics = Pick<GeometryResult["metrics"], "lengthRatio" | "jawRatio" | "foreheadRatio"> & {
  faceLengthRatio?: number | null;
};

/** Saç çizgisi yoksa 10→152 uzunluğunu saç çizgisi tahminine çeviren katsayı (PLAN 1d: ×1,12). */
export const MESH_TOP_TO_HAIRLINE = 1.12;

export const FACE_SHAPE_THRESHOLDS = {
  /** Etkin uzunluk (saç çizgisi→çene ÷ elmacık) eşikleri. */
  longLengthMin: 1.42,
  squareJawMin: 0.9,
  squareLengthMax: 1.32,
  roundLengthMax: 1.22,
  roundJawMax: 0.9,
  heartForeheadOverJaw: 0.1,
  diamondForeheadMax: 0.8,
  diamondJawMax: 0.8,
  /** Bu kadar oran uzaklığı tam güven sayılır; altında orantılı. */
  fullConfidenceMargin: 0.1,
} as const;

/** fs-v2 etkin uzunluk: saç çizgisi varsa ölçülen, yoksa ağ tepesinden ölçeklenen. */
export function effectiveLengthRatio(m: ShapeMetrics): number {
  const hair = m.faceLengthRatio;
  return typeof hair === "number" && Number.isFinite(hair) && hair > 0 ? hair : m.lengthRatio * MESH_TOP_TO_HAIRLINE;
}

type Norm = { length: number; jawRatio: number; foreheadRatio: number };
type Condition = { value: (m: Norm) => number; op: ">=" | "<"; threshold: (m: Norm) => number };
type Rule = { shape: FaceShape; conditions: Condition[] };

const T = FACE_SHAPE_THRESHOLDS;
/** Sırayla denenir; ilk eşleşen kazanır. Hiçbiri → oval. */
const RULES: Rule[] = [
  { shape: "long", conditions: [{ value: (m) => m.length, op: ">=", threshold: () => T.longLengthMin }] },
  {
    shape: "square",
    conditions: [
      { value: (m) => m.jawRatio, op: ">=", threshold: () => T.squareJawMin },
      { value: (m) => m.length, op: "<", threshold: () => T.squareLengthMax },
    ],
  },
  {
    shape: "round",
    conditions: [
      { value: (m) => m.length, op: "<", threshold: () => T.roundLengthMax },
      { value: (m) => m.jawRatio, op: "<", threshold: () => T.roundJawMax },
    ],
  },
  { shape: "heart", conditions: [{ value: (m) => m.foreheadRatio, op: ">=", threshold: (m) => m.jawRatio + T.heartForeheadOverJaw }] },
  {
    shape: "diamond",
    conditions: [
      { value: (m) => m.foreheadRatio, op: "<", threshold: () => T.diamondForeheadMax },
      { value: (m) => m.jawRatio, op: "<", threshold: () => T.diamondJawMax },
    ],
  },
];

/** Koşul sağlanıyorsa pozitif (eşiğe uzaklık), sağlanmıyorsa negatif (eksik). */
function slack(c: Condition, m: Norm): number {
  const v = c.value(m);
  const t = c.threshold(m);
  return c.op === ">=" ? v - t : t - v;
}

/** "≥" eşitlikte sağlanır; "<" sıkı eşitsizliktir. */
function matches(rule: Rule, m: Norm) {
  return rule.conditions.every((c) => (c.op === ">=" ? slack(c, m) >= 0 : slack(c, m) > 0));
}

/** Kuralın "ne kadar uzak" olduğu: eşleşiyorsa en dar koşulun marjı (≥ 0), eşleşmiyorsa en büyük eksik (< 0). */
const distance = (r: Rule, m: Norm) => Math.min(...r.conditions.map((c) => slack(c, m)));

/**
 * Birincil şekil + en yakın ikinci şekil (KB: tek etiket yerine en yakın iki şekil) + güven (0–1).
 * Güven, birincil kuralın marjı ile daha önce denenen kuralların "neredeyse eşleşmesi"nin küçüğünden türer.
 */
export function classifyFaceShape(m: ShapeMetrics): GeometryResult["faceShape"] {
  const n: Norm = { length: effectiveLengthRatio(m), jawRatio: m.jawRatio, foreheadRatio: m.foreheadRatio };
  const idx = RULES.findIndex((r) => matches(r, n));
  const primary: FaceShape = idx === -1 ? "oval" : RULES[idx].shape;

  let margin = Infinity;
  let secondary: FaceShape | undefined;
  if (idx !== -1) {
    margin = distance(RULES[idx], n);
    // Eşleşen kuraldan önceki kurallardan biri az farkla kaçırıldıysa, o ikinci adaydır.
    for (let i = 0; i < idx; i++) {
      const deficit = -distance(RULES[i], n);
      if (deficit < margin) {
        margin = deficit;
        secondary = RULES[i].shape;
      }
    }
    if (!secondary) secondary = nextShapeIfCrossed(idx, n);
  } else {
    for (const r of RULES) {
      const deficit = -distance(r, n);
      if (deficit < margin) {
        margin = deficit;
        secondary = r.shape;
      }
    }
  }

  const confidence = Math.max(0, Math.min(1, margin / T.fullConfidenceMargin));
  const result: GeometryResult["faceShape"] = { primary, confidence: Number(confidence.toFixed(2)) };
  if (secondary && secondary !== primary) result.secondary = secondary;
  return result;
}

/** Eşleşen kuralın en dar koşulu aşılırsa hangi şekil olurdu? */
function nextShapeIfCrossed(idx: number, n: Norm): FaceShape {
  const rest = RULES.slice(idx + 1);
  const next = rest.find((r) => matches(r, n));
  return next ? next.shape : "oval";
}
