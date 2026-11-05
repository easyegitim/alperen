// Benzerlik dönüşümü (lib/tryon/align.ts) → Skia 3×3 satır-öncelikli matris. Saf; birim testli.
import type { Similarity } from "@/lib/tryon/align";

/** canvas.setTransform(a, b, -b, a, tx, ty) karşılığı: [a, -b, tx, b, a, ty, 0, 0, 1]. */
export function similarityToMatrix(t: Similarity): number[] {
  return [t.a, -t.b, t.tx, t.b, t.a, t.ty, 0, 0, 1];
}

/** G noktalarını C boyutuna ölçekler (compositeTryon adım 1). */
export function scalePoints(points: { x: number; y: number }[], sx: number, sy: number): { x: number; y: number }[] {
  return points.map((p) => ({ x: p.x * sx, y: p.y * sy }));
}
