// Hayalet kılavuz (KB §8 ONAYLI ÖNERİ R2-Ö1; PLAN Faz 6; CONTRACTS_V2 Sprint 3 S3.3): yeniden analizde önceki
// fotoğrafın yüz çizgisi kamerada silik görünür; kullanıcı aynı açıya ve mesafeye oturur. KILAVUZ CİHAZDA ÜRETİLİR.
// Saklanan şey 478 noktalı dizi DEĞİL, 43 noktalık normalize edilmiş çizgi altkümesidir (GhostOutline); yalnız
// tarayıcı IndexedDB'sinde / uygulama sanal alanında (ilerleme kaydıyla birlikte) durur, hiçbir isteğe, analitiğe,
// loga girmez (CLAUDE.md fotoğraf/landmark kuralı; privacy.spec "oval"/"ghost" anahtarı gövdede yasak).
import { z } from "zod";
import { FACE_OVAL, IDX } from "./indices";
import type { Point } from "./types";

export const GHOST_GUIDE_VERSION = 1 as const;

/** Yüz ovali (36) + göz köşeleri (4) + burun ucu (1) + ağız köşeleri (2) = 43 nokta. */
export const GHOST_INDICES: readonly number[] = [...FACE_OVAL, IDX.eyeOuterR, IDX.eyeInnerR, IDX.eyeInnerL, IDX.eyeOuterL, IDX.noseTip, IDX.mouthR, IDX.mouthL];
export const GHOST_POINT_COUNT = GHOST_INDICES.length;
/** Önerilen çizim: silik çizgi (opaklık 0,35, 2 px, açık tema koyu / koyu tema açık renk). */
export const GHOST_STYLE = { opacity: 0.35, strokeWidth: 2 } as const;

/** Kaynak karede normalize (0–1) nokta. */
export const NormPoint = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);
export type NormPoint = z.infer<typeof NormPoint>;

export const GhostOutline = z.object({
  version: z.literal(GHOST_GUIDE_VERSION),
  /** Kaynak karenin en-boy oranı (w/h); önizleme farklı orandaysa "cover" eşlemesi için. */
  aspect: z.number().positive(),
  /** Kamera aynalı önizlemeden mi (web ön kamera = true). Eşleme sırasında hedef önizlemeyle karşılaştırılır. */
  mirrored: z.boolean(),
  oval: z.array(NormPoint).length(FACE_OVAL.length),
  eyes: z.array(NormPoint).length(4),
  nose: NormPoint,
  mouth: z.array(NormPoint).length(2),
  takenAt: z.number().int().nonnegative(),
});
export type GhostOutline = z.infer<typeof GhostOutline>;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/**
 * Landmark'lardan (kare pikselleri, frameW×frameH) çizgi altkümesi. 478'den az nokta ya da geçersiz kare → null.
 * Nokta kümesi dışındaki hiçbir koordinat tutulmaz; z atılır.
 */
export function ghostOutlineFromLandmarks(landmarks: readonly Point[], frameW: number, frameH: number, opts: { mirrored: boolean; takenAt: number }): GhostOutline | null {
  if (!(frameW > 0) || !(frameH > 0)) return null;
  const maxIdx = Math.max(...GHOST_INDICES);
  if (landmarks.length <= maxIdx) return null;
  const norm = (i: number): NormPoint => [r4(clamp01(landmarks[i].x / frameW)), r4(clamp01(landmarks[i].y / frameH))];
  return {
    version: GHOST_GUIDE_VERSION,
    aspect: r4(frameW / frameH),
    mirrored: opts.mirrored,
    oval: FACE_OVAL.map(norm),
    eyes: [IDX.eyeOuterR, IDX.eyeInnerR, IDX.eyeInnerL, IDX.eyeOuterL].map(norm),
    nose: norm(IDX.noseTip),
    mouth: [IDX.mouthR, IDX.mouthL].map(norm),
    takenAt: Math.max(0, Math.floor(opts.takenAt)),
  };
}

export type Polyline = [number, number][];
export type GhostPolylines = { oval: Polyline; eyes: Polyline; nose: [number, number]; mouth: Polyline };

/**
 * Önizleme piksellerine eşleme. Önizleme kaynak kareyi "cover" ile (kısa kenara göre ölçekle, ortala) gösterir —
 * SelfieCamera ve vision-camera önizlemesiyle aynı. mirror: hedef önizleme aynalıysa true; kaynakla farklıysa x çevrilir.
 */
export function ghostPolylines(outline: GhostOutline, viewport: { w: number; h: number }, opts: { mirror: boolean }): GhostPolylines {
  const srcW = outline.aspect, srcH = 1;
  const scale = Math.max(viewport.w / srcW, viewport.h / srcH);
  const dw = srcW * scale, dh = srcH * scale;
  const ox = (viewport.w - dw) / 2, oy = (viewport.h - dh) / 2;
  const flip = opts.mirror !== outline.mirrored;
  const map = ([nx, ny]: NormPoint): [number, number] => {
    const x = flip ? 1 - nx : nx;
    // +0: Math.round(-0.04) = -0; eşitlik testleri ve JSON için 0'a normalize edilir
    return [Math.round((ox + x * dw) * 10) / 10 + 0, Math.round((oy + ny * dh) * 10) / 10 + 0];
  };
  return { oval: outline.oval.map(map), eyes: outline.eyes.map(map), nose: map(outline.nose), mouth: outline.mouth.map(map) };
}

/** Kapalı oval için SVG/Skia yol dizgesi ("M x,y L … Z"). */
export function polylinePath(points: Polyline, close = false): string {
  if (points.length === 0) return "";
  const body = points.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ");
  return close ? `${body} Z` : body;
}

/** Saklanan kaydı güvenle okur (bozuk/eski sürüm → null); çizim öncesi tek kapı. */
export function parseGhostOutline(raw: unknown): GhostOutline | null {
  const r = GhostOutline.safeParse(raw);
  return r.success ? r.data : null;
}
