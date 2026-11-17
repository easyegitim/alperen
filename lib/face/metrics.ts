// SPEC 7.5: göz hattı yatay olacak şekilde döndürme, metrikler, 5 karenin medyanı. Saf fonksiyonlar.
import { IDX } from "./indices";
import { eulerFromMatrix } from "./pose";
import type { FrameAnalysis, GeometryResult, Point } from "./types";
import { classifyFaceShape } from "./faceShape";
import { computeSymmetry, derotate, type Symmetry } from "./symmetry";

export type Metrics = GeometryResult["metrics"];

export const d = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Normalize (0–1) noktaları piksele çevirir. */
export function toPixels(landmarks: Point[], width: number, height: number): Point[] {
  return landmarks.map((p) => ({ x: p.x * width, y: p.y * height, z: p.z }));
}

/** Göz dış köşeleri (33–263) yatay olacak şekilde, gözlerin orta noktası etrafında döndürür. */
export function rollCorrect(points: Point[]): { points: Point[]; rollDeg: number } {
  const r = points[IDX.eyeOuterR];
  const l = points[IDX.eyeOuterL];
  const angle = Math.atan2(l.y - r.y, l.x - r.x);
  const c = mid(r, l);
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const rotated = points.map((p) => {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos, z: p.z };
  });
  return { points: rotated, rollDeg: (angle * 180) / Math.PI };
}

/** Görüntü koordinatında y aşağı doğru artar; dış köşe yukarıdaysa pozitif (SPEC 7.5). */
export function eyeTilt(inner: Point, outer: Point, side: "right" | "left"): number {
  const dx = side === "right" ? inner.x - outer.x : outer.x - inner.x; // dışa doğru pozitif
  const dy = inner.y - outer.y; // dış köşe yukarıdaysa pozitif
  return (Math.atan2(dy, Math.abs(dx)) * 180) / Math.PI;
}

/** Aynı dönüşümle döndürülmüş saç çizgisi noktası (varsa) için y değeri alınır. */
export function computeMetrics(L: Point[], hairlineY: number | null): Metrics {
  const cheek = d(L[IDX.cheekR], L[IDX.cheekL]);
  const lengthRatio = d(L[IDX.top], L[IDX.menton]) / cheek;
  const jawRatio = d(L[IDX.gonionR], L[IDX.gonionL]) / cheek;
  const foreheadRatio = d(L[IDX.foreheadR], L[IDX.foreheadL]) / cheek;
  const fwhr = cheek / d(L[IDX.upperLipMid], mid(L[IDX.browTopR], L[IDX.browTopL]));
  const canthalTiltDeg =
    (eyeTilt(L[IDX.eyeInnerR], L[IDX.eyeOuterR], "right") + eyeTilt(L[IDX.eyeInnerL], L[IDX.eyeOuterL], "left")) / 2;

  const middle = L[IDX.subnasale].y - L[IDX.glabella].y;
  const lower = L[IDX.menton].y - L[IDX.subnasale].y;
  const upper = hairlineY !== null ? L[IDX.glabella].y - hairlineY : null;
  const hairlineFound = upper !== null && upper > 0;
  const total = (hairlineFound ? upper : 0) + middle + lower;
  const thirds = {
    upper: hairlineFound ? upper / total : null,
    middle: middle / total,
    lower: lower / total,
  };
  const lowerToMiddle = lower / middle;
  // fs-v2: saç çizgisi → çene ucu uzunluğu (roll düzeltilmiş eksende; x olarak orta hat 10 kullanılır).
  const faceLengthRatio = hairlineFound && hairlineY !== null ? Math.hypot(L[IDX.top].x - L[IDX.menton].x, hairlineY - L[IDX.menton].y) / cheek : null;

  // hybrid.v1 (engine spec §3.1): iris merkezleri arası / elmacık genişliği; göz–ağız mesafesi / 10–152 uzunluğu.
  const ipdRatio = d(L[IDX.irisR], L[IDX.irisL]) / cheek;
  const eyeMouthRatio =
    ((L[IDX.stomionUpper].y + L[IDX.stomionLower].y) / 2 - (L[IDX.irisR].y + L[IDX.irisL].y) / 2) /
    (L[IDX.menton].y - L[IDX.top].y);

  return { lengthRatio, jawRatio, foreheadRatio, fwhr, canthalTiltDeg, lowerToMiddle, thirds, hairlineFound, faceLengthRatio, ipdRatio, eyeMouthRatio };
}

/** engine spec §3.2: karede poz eşikleri (derece). Simetri |yaw| ≤ 3 ve |pitch| ≤ 10; göz–ağız |pitch| ≤ 8. */
export const FRAME_POSE_LIMITS = { symmetryYaw: 3, symmetryPitch: 10, eyeMouthPitch: 8 } as const;

/**
 * Bir karenin simetrisi: noktalar piksel birimine (x·w, y·h, z·w) çevrilir, karenin matrisiyle de-rotasyon yapılır,
 * roll düzeltilir, sonra aynalanır (engine spec §3.3). Matris yoksa veya geçersizse null.
 */
export function frameSymmetry(frame: Pick<FrameAnalysis, "landmarks" | "width" | "height" | "matrix">): Symmetry | null {
  if (!frame.landmarks || !frame.matrix) return null;
  const px = frame.landmarks.map((p) => ({ x: p.x * frame.width, y: p.y * frame.height, z: (p.z ?? 0) * frame.width }));
  const der = derotate(px, frame.matrix);
  if (!der) return null;
  const { points } = rollCorrect(der);
  const w = d(points[IDX.cheekR], points[IDX.cheekL]);
  if (!(w > 0)) return null;
  const s = computeSymmetry(points, w);
  return Number.isFinite(s.face) && Number.isFinite(s.eyes) && Number.isFinite(s.lower) ? s : null;
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export type GeometryFrame = {
  frame: FrameAnalysis;
  /** Saç çizgisi noktası, kare piksel koordinatında (hairline.ts). */
  hairline: Point | null;
};

/**
 * Çekimden önceki karelerde (en çok 5) ayrı ayrı metrik hesaplar, her metriğin medyanını alır (SPEC 7.5).
 * Kalite alanı son kareden gelir. Ham noktalar sonuçta yer almaz.
 */
export function computeStableGeometry(frames: GeometryFrame[], capturedAt = new Date()): GeometryResult {
  const usable = frames.filter((f) => f.frame.landmarks && f.frame.faces === 1).slice(-5);
  if (usable.length === 0) throw new Error("no_landmarks");

  const per = usable.map(({ frame, hairline }) => {
    const px = toPixels(frame.landmarks!, frame.width, frame.height);
    const withHair = hairline ? [...px, hairline] : px;
    const { points } = rollCorrect(withHair);
    const hairY = hairline ? points[points.length - 1].y : null;
    const m = computeMetrics(points.slice(0, px.length), hairY);
    // engine spec §3.2: yeni metrikler yalnız matrisi olan karelerden; poz her karenin kendi matrisinden.
    const pose = frame.matrix ? eulerFromMatrix(frame.matrix) : null;
    const symOk =
      pose !== null && Math.abs(pose.yaw) <= FRAME_POSE_LIMITS.symmetryYaw && Math.abs(pose.pitch) <= FRAME_POSE_LIMITS.symmetryPitch;
    return {
      m,
      ipd: pose ? m.ipdRatio ?? null : null,
      eyeMouth: pose && Math.abs(pose.pitch) <= FRAME_POSE_LIMITS.eyeMouthPitch ? m.eyeMouthRatio ?? null : null,
      symmetry: symOk ? frameSymmetry(frame) : null,
    };
  });

  const med = (pick: (m: Metrics) => number | null) => {
    const vals = per.map((p) => pick(p.m)).filter((v): v is number => v !== null && Number.isFinite(v));
    return vals.length ? median(vals) : null;
  };
  // Yeterli nitelikli kare yoksa null: en az min(3, kullanılabilir kare) kare gerekir.
  const minFrames = Math.min(3, usable.length);
  const medQualified = (vals: (number | null)[]) => {
    const ok = vals.filter((v): v is number => v !== null && Number.isFinite(v));
    return ok.length >= minFrames && ok.length > 0 ? median(ok) : null;
  };
  const syms = per.map((p) => p.symmetry).filter((v): v is Symmetry => v !== null);
  const symmetry =
    syms.length >= minFrames && syms.length > 0
      ? { face: median(syms.map((x) => x.face)), eyes: median(syms.map((x) => x.eyes)), lower: median(syms.map((x) => x.lower)) }
      : null;

  const upper = med((m) => m.thirds.upper);
  const metrics: Metrics = {
    lengthRatio: med((m) => m.lengthRatio)!,
    jawRatio: med((m) => m.jawRatio)!,
    foreheadRatio: med((m) => m.foreheadRatio)!,
    fwhr: med((m) => m.fwhr)!,
    canthalTiltDeg: med((m) => m.canthalTiltDeg)!,
    lowerToMiddle: med((m) => m.lowerToMiddle)!,
    thirds: { upper, middle: med((m) => m.thirds.middle)!, lower: med((m) => m.thirds.lower)! },
    hairlineFound: per.filter((p) => p.m.hairlineFound).length * 2 > per.length,
    faceLengthRatio: med((m) => m.faceLengthRatio ?? null),
    ipdRatio: medQualified(per.map((p) => p.ipd)),
    eyeMouthRatio: medQualified(per.map((p) => p.eyeMouth)),
    symmetry,
  };
  if (!metrics.hairlineFound) {
    metrics.thirds.upper = null;
    metrics.faceLengthRatio = null;
  }

  const last = usable[usable.length - 1].frame;
  const pose = last.matrix ? eulerFromMatrix(last.matrix) : { yaw: 0, pitch: 0, roll: 0 };

  return {
    version: "geo-v1",
    quality: {
      yaw: round(pose.yaw, 1),
      pitch: round(pose.pitch, 1),
      roll: round(pose.roll, 1),
      brightness: round(last.brightness ?? 0, 0),
      sharpness: round(last.sharpness ?? 0, 0),
      passed: true,
    },
    metrics: roundMetrics(metrics),
    faceShape: classifyFaceShape(metrics),
    capturedAt: capturedAt.toISOString(),
  };
}

const round = (v: number, digits: number) => Number(v.toFixed(digits));

function roundMetrics(m: Metrics): Metrics {
  return {
    lengthRatio: round(m.lengthRatio, 3),
    jawRatio: round(m.jawRatio, 3),
    foreheadRatio: round(m.foreheadRatio, 3),
    fwhr: round(m.fwhr, 3),
    canthalTiltDeg: round(m.canthalTiltDeg, 1),
    lowerToMiddle: round(m.lowerToMiddle, 3),
    thirds: {
      upper: m.thirds.upper === null ? null : round(m.thirds.upper, 3),
      middle: round(m.thirds.middle, 3),
      lower: round(m.thirds.lower, 3),
    },
    hairlineFound: m.hairlineFound,
    faceLengthRatio: roundOpt(m.faceLengthRatio, 3),
    ipdRatio: roundOpt(m.ipdRatio, 3),
    eyeMouthRatio: roundOpt(m.eyeMouthRatio, 3),
    symmetry: m.symmetry ? { face: round(m.symmetry.face, 3), eyes: round(m.symmetry.eyes, 3), lower: round(m.symmetry.lower, 3) } : null,
  };
}

const roundOpt = (v: number | null | undefined, digits: number) => (v === null || v === undefined ? null : round(v, digits));
