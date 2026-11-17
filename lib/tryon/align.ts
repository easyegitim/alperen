// SPEC 10.4 adım 2: sabit noktalar üzerinden benzerlik dönüşümü (ölçek + döndürme + öteleme), en küçük kareler (Umeyama, yansımasız).
import type { Point } from "@/lib/face/types";

/** x' = a·x − b·y + tx ; y' = b·x + a·y + ty */
export type Similarity = { a: number; b: number; tx: number; ty: number };

export function estimateSimilarity(src: Point[], dst: Point[]): Similarity {
  const n = Math.min(src.length, dst.length);
  if (n < 2) throw new Error("need_at_least_2_points");
  let mx = 0, my = 0, ux = 0, uy = 0;
  for (let i = 0; i < n; i++) {
    mx += src[i].x; my += src[i].y; ux += dst[i].x; uy += dst[i].y;
  }
  mx /= n; my /= n; ux /= n; uy /= n;
  // Karmaşık sayı en küçük kareleri: dst ≈ s·e^{iθ}·src + t
  let sxx = 0, num_re = 0, num_im = 0;
  for (let i = 0; i < n; i++) {
    const x = src[i].x - mx, y = src[i].y - my, X = dst[i].x - ux, Y = dst[i].y - uy;
    sxx += x * x + y * y;
    num_re += x * X + y * Y;
    num_im += x * Y - y * X;
  }
  if (sxx === 0) throw new Error("degenerate_points");
  const a = num_re / sxx;
  const b = num_im / sxx;
  return { a, b, tx: ux - (a * mx - b * my), ty: uy - (b * mx + a * my) };
}

export function applySimilarity(t: Similarity, p: Point): Point {
  return { x: t.a * p.x - t.b * p.y + t.tx, y: t.b * p.x + t.a * p.y + t.ty };
}

export function similarityScale(t: Similarity): number {
  return Math.hypot(t.a, t.b);
}
export function similarityAngleDeg(t: Similarity): number {
  return (Math.atan2(t.b, t.a) * 180) / Math.PI;
}

/** Hizalama artığı: dönüşüm sonrası ortalama hata / göz bebekleri arası mesafe (SPEC 10.5: < 0,04). */
export function alignmentResidual(t: Similarity, src: Point[], dst: Point[], interpupillary: number): number {
  const n = Math.min(src.length, dst.length);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const p = applySimilarity(t, src[i]);
    sum += Math.hypot(p.x - dst[i].x, p.y - dst[i].y);
  }
  return interpupillary > 0 ? sum / n / interpupillary : Infinity;
}
