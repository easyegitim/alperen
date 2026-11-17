// Sentetik, 3-B ayna simetrik yüz (gerçek yüz değil; fotoğraf veya gerçek nokta verisi içermez).
// Simetri, ipd ve göz–ağız metriklerinin kullandığı indeksler anlamlıdır; kalan noktalar elips üzerinde dolgudur.
// Koordinatlar görüntü eksenindedir: x sağa, y aşağı, z küçükse kameraya yakın (MediaPipe ile aynı); birim piksel.
import { IDX, LANDMARK_COUNT } from "@/lib/face/indices";
import type { Point } from "@/lib/face/types";

type Mirrored = { right: number; left: number; x: number; y: number; z: number };
type Single = { i: number; y: number; z: number };

/** Orta hat noktaları (x = 0). */
const MIDLINE: Single[] = [
  { i: IDX.top, y: -190, z: 5 },
  { i: IDX.foreheadMid, y: -150, z: -10 },
  { i: IDX.glabella, y: -100, z: -25 },
  { i: IDX.midBrow, y: -90, z: -28 },
  { i: IDX.nasion, y: -70, z: -30 },
  { i: IDX.noseBridge, y: -45, z: -38 },
  { i: IDX.noseTip, y: 25, z: -75 },
  { i: IDX.subnasale, y: 40, z: -50 },
  { i: IDX.upperLipMid, y: 88, z: -40 },
  { i: IDX.stomionUpper, y: 100, z: -35 },
  { i: IDX.stomionLower, y: 104, z: -35 },
  { i: IDX.menton, y: 190, z: -20 },
];

/** Ayna çiftleri: sağ nokta −x'te, sol +x'te; çift başına farklı (gerçekçi) derinlik. */
const PAIRS: Mirrored[] = [
  { right: IDX.cheekR, left: IDX.cheekL, x: 150, y: -10, z: 60 },
  { right: IDX.gonionR, left: IDX.gonionL, x: 128, y: 120, z: 25 },
  { right: IDX.foreheadR, left: IDX.foreheadL, x: 110, y: -140, z: 30 },
  { right: IDX.browTopR, left: IDX.browTopL, x: 75, y: -78, z: -5 },
  { right: IDX.eyeOuterR, left: IDX.eyeOuterL, x: 105, y: -46, z: 10 },
  { right: IDX.eyeInnerR, left: IDX.eyeInnerL, x: 35, y: -40, z: -10 },
  { right: IDX.irisR, left: IDX.irisL, x: 70, y: -40, z: -15 },
  { right: IDX.mouthR, left: IDX.mouthL, x: 50, y: 103, z: -20 },
  { right: 159, left: 386, x: 70, y: -48, z: -10 },
  { right: 145, left: 374, x: 70, y: -33, z: -10 },
  { right: 70, left: 300, x: 115, y: -70, z: 10 },
  { right: 107, left: 336, x: 30, y: -75, z: -20 },
  { right: 93, left: 323, x: 145, y: 30, z: 50 },
  { right: 129, left: 358, x: 30, y: 25, z: -35 },
  { right: 98, left: 327, x: 22, y: 38, z: -40 },
  { right: 50, left: 280, x: 80, y: 20, z: -15 },
  { right: 205, left: 425, x: 75, y: 50, z: -10 },
  { right: 40, left: 270, x: 25, y: 92, z: -30 },
  { right: 91, left: 321, x: 35, y: 112, z: -25 },
  { right: 58, left: 288, x: 125, y: 95, z: 30 },
  { right: 136, left: 365, x: 110, y: 145, z: 15 },
  { right: 150, left: 379, x: 80, y: 170, z: 0 },
  { right: 176, left: 400, x: 40, y: 185, z: -12 },
];

/** Yüzün merkeze göre önden (poz 0) noktaları, piksel. Yüz genişliği d(234, 454) = 300. */
export function frontalFace(): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const a = (i / LANDMARK_COUNT) * Math.PI * 2;
    pts.push({ x: 120 * Math.cos(a), y: 170 * Math.sin(a), z: 0 });
  }
  for (const m of MIDLINE) pts[m.i] = { x: 0, y: m.y, z: m.z };
  for (const p of PAIRS) {
    pts[p.right] = { x: -p.x, y: p.y, z: p.z };
    pts[p.left] = { x: p.x, y: p.y, z: p.z };
  }
  return pts;
}

/** Satır-öncelikli R = Rz(roll) · Ry(yaw) · Rx(pitch) (lib/face/pose.ts eulerFromMatrix ile tutarlı). */
export function rotation(pitchDeg: number, yawDeg: number, rollDeg: number): number[][] {
  const [a, b, c] = [pitchDeg, yawDeg, rollDeg].map((d) => (d * Math.PI) / 180);
  const cx = Math.cos(a), sx = Math.sin(a), cy = Math.cos(b), sy = Math.sin(b), cz = Math.cos(c), sz = Math.sin(c);
  return [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ];
}

/** Sütun-öncelikli 4×4 facialTransformationMatrix (isteğe bağlı tekdüze ölçekle). */
export function poseMatrix(pitchDeg: number, yawDeg: number, rollDeg: number, scale = 1): number[] {
  const R = rotation(pitchDeg, yawDeg, rollDeg);
  const m = new Array<number>(16).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m[c * 4 + r] = R[r][c] * scale;
  m[15] = 1;
  return m;
}

/**
 * Yüzü pozla döndürür (metrik uzayda: x sağa, y yukarı, z kameraya doğru) ve görüntü eksenine geri çevirir.
 * Ortografik izdüşüm; z piksel biriminde kalır.
 */
export function posedFace(pose: { pitch?: number; yaw?: number; roll?: number } = {}, base: Point[] = frontalFace()): Point[] {
  const R = rotation(pose.pitch ?? 0, pose.yaw ?? 0, pose.roll ?? 0);
  return base.map((p) => {
    const X = p.x, Y = -p.y, Z = -(p.z ?? 0);
    const x = R[0][0] * X + R[0][1] * Y + R[0][2] * Z;
    const y = R[1][0] * X + R[1][1] * Y + R[1][2] * Z;
    const z = R[2][0] * X + R[2][1] * Y + R[2][2] * Z;
    return { x, y: -y, z: -z };
  });
}

export const FRAME_W = 720;
export const FRAME_H = 960;

/** Görüntüde (cx, cy) merkezli noktaları 0–1'e normalize eder (z / genişlik, MediaPipe gibi). */
export function toNormalized(pts: Point[], cx = 360, cy = 470): Point[] {
  return pts.map((p) => ({ x: (p.x + cx) / FRAME_W, y: (p.y + cy) / FRAME_H, z: (p.z ?? 0) / FRAME_W }));
}
