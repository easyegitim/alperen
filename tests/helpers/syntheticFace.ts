// Sentetik 478 noktalık yüz (gerçek yüz değil). Yalnız SPEC 7.4 indeksleri anlamlıdır; kalanı elips üzerinde.
import { FACE_OVAL, IDX, LANDMARK_COUNT, LEFT_BROW, LEFT_EYE, LIPS, NOSE, RIGHT_BROW, RIGHT_EYE } from "@/lib/face/indices";
import type { Point } from "@/lib/face/types";

export type SyntheticParams = {
  /** Elmacık genişliği (piksel) */
  cheek: number;
  /** Yüz uzunluğu 10→152 */
  length: number;
  jaw: number;
  forehead: number;
  /** Dış göz köşesi iç köşeden bu kadar yukarıda (piksel) → pozitif canthal tilt */
  eyeLift?: number;
  cx?: number;
  cy?: number;
  /** Tüm noktalar bu açıyla (derece, saat yönü) döndürülür → roll */
  rollDeg?: number;
};

export function syntheticFace(p: SyntheticParams): Point[] {
  const { cheek, length: L, jaw, forehead, eyeLift = 0, cx = 500, cy = 500, rollDeg = 0 } = p;
  const pts: Point[] = [];
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const a = (i / LANDMARK_COUNT) * Math.PI * 2;
    pts.push({ x: cx + (cheek / 2) * 0.9 * Math.cos(a), y: cy + (L / 2) * 0.9 * Math.sin(a), z: 0 });
  }
  const set = (i: number, x: number, y: number) => (pts[i] = { x, y, z: 0 });
  set(IDX.top, cx, cy - L * 0.45);
  set(IDX.menton, cx, cy + L * 0.55);
  set(IDX.cheekR, cx - cheek / 2, cy);
  set(IDX.cheekL, cx + cheek / 2, cy);
  set(IDX.gonionR, cx - jaw / 2, cy + L * 0.35);
  set(IDX.gonionL, cx + jaw / 2, cy + L * 0.35);
  set(IDX.foreheadR, cx - forehead / 2, cy - L * 0.3);
  set(IDX.foreheadL, cx + forehead / 2, cy - L * 0.3);
  set(IDX.browTopR, cx - cheek * 0.2, cy - L * 0.2);
  set(IDX.browTopL, cx + cheek * 0.2, cy - L * 0.2);
  set(IDX.upperLipMid, cx, cy + L * 0.25);
  set(IDX.glabella, cx, cy - L * 0.22);
  set(IDX.nasion, cx, cy - L * 0.18);
  set(IDX.noseTip, cx, cy + L * 0.08);
  set(IDX.subnasale, cx, cy + L * 0.12);
  const eyeY = cy - L * 0.1;
  set(IDX.eyeOuterR, cx - cheek * 0.3, eyeY - eyeLift);
  set(IDX.eyeInnerR, cx - cheek * 0.1, eyeY);
  set(IDX.eyeInnerL, cx + cheek * 0.1, eyeY);
  set(IDX.eyeOuterL, cx + cheek * 0.3, eyeY - eyeLift);
  set(IDX.irisR, cx - cheek * 0.2, eyeY - eyeLift / 2);
  set(IDX.irisL, cx + cheek * 0.2, eyeY - eyeLift / 2);
  set(IDX.mouthR, cx - cheek * 0.18, cy + L * 0.3);
  set(IDX.mouthL, cx + cheek * 0.18, cy + L * 0.3);

  if (rollDeg !== 0) {
    const r = (rollDeg * Math.PI) / 180;
    const cos = Math.cos(r), sin = Math.sin(r);
    return pts.map((q) => ({ x: cx + (q.x - cx) * cos - (q.y - cy) * sin, y: cy + (q.x - cx) * sin + (q.y - cy) * cos, z: 0 }));
  }
  return pts;
}

/** Piksel noktaları 0–1'e normalize eder. */
export function normalize(pts: Point[], width: number, height: number): Point[] {
  return pts.map((p) => ({ x: p.x / width, y: p.y / height, z: p.z }));
}

/**
 * Şekil başına referans parametreler (fs-v2 kurallarının ortasına düşer). Saç çizgisi yok → etkin uzunluk =
 * length/cheek × 1,12: yuvarlak 1,10 · kare 1,25 · oval/kalp/elmas 1,32 · uzun 1,51.
 */
export const SHAPE_PARAMS: Record<string, SyntheticParams> = {
  oval: { cheek: 100, length: 118, jaw: 84, forehead: 88 },
  round: { cheek: 100, length: 98, jaw: 80, forehead: 85 },
  square: { cheek: 100, length: 112, jaw: 96, forehead: 92 },
  long: { cheek: 100, length: 135, jaw: 85, forehead: 88 },
  heart: { cheek: 100, length: 118, jaw: 72, forehead: 95 },
  diamond: { cheek: 100, length: 118, jaw: 70, forehead: 72 },
};

/**
 * Kontur listelerini (göz, kaş, burun, dudak; lib/face/indices.ts) IDX çıpalarının çevresine küçük elipsler olarak
 * yerleştirir; FACE_OVAL elips üzerine dizilir. Yalnız maske/glow-up testleri için (gerçek yüz değil).
 */
export function withContours(pts: Point[], p: SyntheticParams): Point[] {
  const { cheek, length: L, cx = 500, cy = 500 } = p;
  const L2 = pts.map((q) => ({ ...q }));
  // phase: listenin ilk indeksi elipste hangi açıya düşer (FACE_OVAL: 10 tepede; RIGHT_EYE: 33 dış köşe = görüntüde sol).
  const ellipse = (idx: readonly number[], ex: number, ey: number, rx: number, ry: number, phase: number, dir = 1) =>
    idx.forEach((i, k) => {
      const a = phase + dir * (k / idx.length) * Math.PI * 2;
      L2[i] = { x: ex + rx * Math.cos(a), y: ey + ry * Math.sin(a), z: 0 };
    });
  ellipse(FACE_OVAL, cx, cy + L * 0.05, cheek * 0.55, L * 0.52, -Math.PI / 2);
  const eyeY = cy - L * 0.1;
  ellipse(RIGHT_EYE, cx - cheek * 0.2, eyeY, cheek * 0.1, L * 0.045, Math.PI, -1); // 33 solda (dış), 145 altta, 133 sağda (iç)
  ellipse(LEFT_EYE, cx + cheek * 0.2, eyeY, cheek * 0.1, L * 0.045, 0); // 263 sağda (dış), 374 altta, 362 solda (iç)
  ellipse(RIGHT_BROW, cx - cheek * 0.2, cy - L * 0.19, cheek * 0.13, L * 0.025, -Math.PI / 2);
  ellipse(LEFT_BROW, cx + cheek * 0.2, cy - L * 0.19, cheek * 0.13, L * 0.025, -Math.PI / 2);
  ellipse(NOSE, cx, cy - L * 0.02, cheek * 0.09, L * 0.15, -Math.PI / 2); // 168 tepede, 2 altta
  ellipse(LIPS, cx, cy + L * 0.3, cheek * 0.18, L * 0.05, Math.PI); // 61 solda, 291 sağda
  // Göz köşeleri, alt göz kapağı (145/374), burun kanatları (129/358) ve burun altı (2) elipslerden gelir (CHEEK_REF ile tutarlı).
  return L2;
}
