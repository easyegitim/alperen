// engine spec §3.3: sağ–sol ayna simetrisi. Saf, paylaşılan (web worker ve mobil aynı fonksiyonu kullanır).
// Çıktı yalnız üç RMS oranıdır (yüz genişliğine göre); koordinat, nokta dizisi veya kimlik bilgisi taşımaz.
// Ayna çiftleri (kişinin sağı, solu) ve orta hat noktaları /debug/landmarks sayfasında doğrulanır.
import { IDX } from "./indices";
import type { Point } from "./types";

/** Düşük derinlikli alın ve burun kökü noktaları; roll düzeltmesinden sonra orta hat göz hattına diktir. */
export const MIDLINE_POINTS = [10, 151, 9, 8, 168, 6] as const;

type Pair = readonly [right: number, left: number];

export const EYE_PAIRS: readonly Pair[] = [
  [133, 362],
  [159, 386],
  [145, 374],
  [70, 300],
  [105, 334],
  [107, 336],
];
export const MID_PAIRS: readonly Pair[] = [
  [234, 454],
  [93, 323],
  [129, 358],
  [98, 327],
  [50, 280],
  [205, 425],
];
/** (33, 263) yoktur: roll düzeltmesi bu çifti zaten yataylar. */
export const LOWER_PAIRS: readonly Pair[] = [
  [61, 291],
  [40, 270],
  [91, 321],
  [58, 288],
  [172, 397],
  [136, 365],
  [150, 379],
  [176, 400],
];

export type Symmetry = { face: number; eyes: number; lower: number };

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Sütun-öncelikli 4×4 facialTransformationMatrix'in dönme kısmı (satır-öncelikli 3×3). Sütunlar birim uzunluğa
 * getirilir, böylece matristeki olası tekdüze ölçek dönmeyi bozmaz. Geçersiz matriste null.
 */
export function rotationFromMatrix(m: ArrayLike<number>): number[][] | null {
  if (m.length < 16) return null;
  const R: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let c = 0; c < 3; c++) {
    const col = [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]];
    const n = Math.hypot(col[0], col[1], col[2]);
    if (!Number.isFinite(n) || n === 0) return null;
    for (let r = 0; r < 3; r++) R[r][c] = col[r] / n;
  }
  return R;
}

/**
 * Noktaları kafa pozunun tersine döndürür (engine spec §3.3 "önce de-rotasyon").
 * Girdi piksel biriminde (x·w, y·h, z·w). Görüntü ekseni (x sağa, y aşağı, z küçükse kameraya yakın) MediaPipe
 * metrik uzayına (x sağa, y yukarı, z kameraya doğru) C = diag(1, −1, −1) ile çevrilir; p' = C·Rᵀ·C·(p − merkez) + merkez.
 * Dönme merkezi ağırlık merkezidir; simetri ölçüleri ötelemeden bağımsızdır. Eksen işaretleri /debug/landmarks'ta doğrulanır.
 */
export function derotate(points: Point[], matrix: ArrayLike<number>): Point[] | null {
  const R = rotationFromMatrix(matrix);
  if (!R || points.length === 0) return null;
  let cx = 0,
    cy = 0,
    cz = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
    cz += p.z ?? 0;
  }
  cx /= points.length;
  cy /= points.length;
  cz /= points.length;
  return points.map((p) => {
    // C·(p − merkez)
    const X = p.x - cx;
    const Y = -(p.y - cy);
    const Z = -((p.z ?? 0) - cz);
    // Rᵀ·v
    const x = R[0][0] * X + R[1][0] * Y + R[2][0] * Z;
    const y = R[0][1] * X + R[1][1] * Y + R[2][1] * Z;
    const z = R[0][2] * X + R[1][2] * Y + R[2][2] * Z;
    // C·v + merkez
    return { x: cx + x, y: cy - y, z: cz - z };
  });
}

/**
 * Ayna asimetrisi (engine spec §3.3). L: de-rotasyon ve roll düzeltmesi yapılmış noktalar; faceWidth: d(234, 454).
 * Çift başına a = (|x_m − x_R| − |x_L − x_m|)/W, b = (y_R − y_L)/W; ortak kip (tüm çiftlerin medyanı) çıkarılır.
 * face: tüm çiftler; eyes: göz çiftleri; lower: alt çiftler + çene terimi c = (x152 − x_m)/W.
 */
export function computeSymmetry(L: Point[], faceWidth: number): Symmetry {
  if (!(faceWidth > 0)) throw new Error("face_width_invalid");
  const xm = median(MIDLINE_POINTS.map((i) => L[i].x));
  const raw = (pairs: readonly Pair[]) =>
    pairs.map(([r, l]) => ({
      a: (Math.abs(xm - L[r].x) - Math.abs(L[l].x - xm)) / faceWidth,
      b: (L[r].y - L[l].y) / faceWidth,
    }));
  const eye = raw(EYE_PAIRS);
  const midp = raw(MID_PAIRS);
  const low = raw(LOWER_PAIRS);
  const all = [...eye, ...midp, ...low];
  const ma = median(all.map((p) => p.a));
  const mb = median(all.map((p) => p.b));
  const sq = (p: { a: number; b: number }) => (p.a - ma) ** 2 + (p.b - mb) ** 2;
  const rms = (terms: number[]) => Math.sqrt(terms.reduce((s, t) => s + t, 0) / terms.length);
  const chin = (L[IDX.menton].x - xm) / faceWidth;
  return {
    face: rms(all.map(sq)),
    eyes: rms(eye.map(sq)),
    lower: rms([...low.map(sq), chin ** 2]),
  };
}
