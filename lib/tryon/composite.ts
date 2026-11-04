// SPEC 10.4 adım 1–5 ve 10.5 kontrolleri. Worker'da OffscreenCanvas ile çalışır; ana iş parçacığında da kullanılabilir.
import type { PresetKind, Protect } from "@/content/types";
import { ALIGN_POINTS, IDX } from "@/lib/face/indices";
import { computeMetrics, rollCorrect } from "@/lib/face/metrics";
import type { Point } from "@/lib/face/types";
import { alignmentResidual, estimateSimilarity, type Similarity } from "./align";
import { buildProtectMask } from "./mask";
import { compositePixels } from "./pixels";

export const TRYON_LIMITS = {
  /** Hizalama artığı / göz bebekleri arası mesafe (SPEC 10.5). */
  maxResidual: 0.04,
  /** lengthRatio ve jawRatio sapması (SPEC 10.5). */
  maxGeometryDrift: 0.03,
  /**
   * Sakal stillerinde algılayıcı sakalın dış hattını çene sayar. Sakal yalnız hacim ekler (sakalsız stilde yalnız
   * kaldırır); o yönde bu kadar sapmaya izin verilir, ters yön (kemik değişimi işareti) yine maxGeometryDrift ile sınırlı.
   */
  maxBeardVolumeDrift: 0.15,
  /** Kenar bandında parlaklık farkı eşiği (SPEC 10.4 adım 5; lib/tryon/pixels.ts). */
  edgeLumaDiff: 18,
  edgeBandPx: 12,
} as const;

export type CompositeInput = {
  /** Kullanıcının 1024 px kare kırpımı C. */
  c: ImageBitmap;
  /** Modelin ürettiği görsel G (herhangi boyut; C boyutuna ölçeklenir). */
  g: ImageBitmap;
  /** C üzerindeki noktalar (piksel). */
  landmarksC: Point[];
  /** G üzerindeki noktalar (G'nin kendi piksel uzayında; Face Landmarker ile bulunur). */
  landmarksG: Point[];
  protect: Protect;
};

export type CompositeResult = {
  image: ImageBitmap;
  residual: number;
  transform: Similarity;
  edgeLumaDiff: number;
  toneAdjusted: boolean;
};

/** Deneme türüne göre sapma kuralı: saç/renk iki yönlü %3; sakal eklemek büyümeye, sakalsız stil küçülmeye izin verir. */
export type DriftPolicy = "symmetric" | "beard_add" | "beard_remove";

export function driftPolicyFor(preset: { kind: PresetKind; id: string }): DriftPolicy {
  if (preset.kind !== "beard") return "symmetric";
  return preset.id === "clean_shaven" ? "beard_remove" : "beard_add";
}

/** Hizalama noktaları: sakal stillerinde çene ucu (152) sakalla yer değiştirir; yalnız üst yüz noktaları kullanılır. */
export function alignPointsFor(protect: Protect): readonly number[] {
  return protect === "above_lip" ? ALIGN_POINTS.filter((i) => i !== IDX.menton) : ALIGN_POINTS;
}

/** İşaretli göreli sapma (yeni − eski) / eski, kurala göre kabul. */
export function driftOk(d: { length: number; jaw: number }, policy: DriftPolicy = "symmetric"): boolean {
  const lim = TRYON_LIMITS.maxGeometryDrift, vol = TRYON_LIMITS.maxBeardVolumeDrift;
  const within = (v: number) => {
    if (policy === "beard_add") return v >= -lim && v <= vol;
    if (policy === "beard_remove") return v <= lim && v >= -vol;
    return Math.abs(v) <= lim;
  };
  return within(d.length) && within(d.jaw);
}

export class CompositeError extends Error {
  constructor(readonly reason: "no_face_in_output" | "alignment_residual" | "canvas") {
    super(reason);
  }
}

export async function compositeTryon(input: CompositeInput): Promise<CompositeResult> {
  const W = input.c.width, H = input.c.height;
  // 1) G, C boyutuna ölçeklenir; G noktaları da aynı ölçekle.
  const sx = W / input.g.width, sy = H / input.g.height;
  const LG = input.landmarksG.map((p) => ({ x: p.x * sx, y: p.y * sy }));
  const LC = input.landmarksC;

  // 2) Benzerlik dönüşümü L_G → L_C (sabit noktalar), artık kontrolü.
  const points = alignPointsFor(input.protect);
  const src = points.map((i) => LG[i]);
  const dst = points.map((i) => LC[i]);
  const t = estimateSimilarity(src, dst);
  const ipd = Math.hypot(LC[IDX.irisR].x - LC[IDX.irisL].x, LC[IDX.irisR].y - LC[IDX.irisL].y);
  const residual = alignmentResidual(t, src, dst, ipd);
  if (!(residual < TRYON_LIMITS.maxResidual)) throw new CompositeError("alignment_residual");

  const canvasG = new OffscreenCanvas(W, H);
  const ctxG = canvasG.getContext("2d", { willReadFrequently: true });
  const canvasC = new OffscreenCanvas(W, H);
  const ctxC = canvasC.getContext("2d", { willReadFrequently: true });
  if (!ctxG || !ctxC) throw new CompositeError("canvas");
  // G' = hizalanmış G: önce C boyutuna ölçekle, sonra benzerlik dönüşümü.
  ctxG.setTransform(t.a, t.b, -t.b, t.a, t.tx, t.ty);
  ctxG.drawImage(input.g, 0, 0, W, H);
  ctxG.setTransform(1, 0, 0, 1, 0, 0);
  ctxC.drawImage(input.c, 0, 0);
  const gp = ctxG.getImageData(0, 0, W, H);
  const cp = ctxC.getImageData(0, 0, W, H);

  // 3–5) Maske (10 px yumuşatma), kenar bandı ton düzeltmesi ve karışım: saf çekirdek (lib/tryon/pixels.ts)
  const mask = buildProtectMask(LC, W, H, input.protect);
  const { out: outData, edgeLumaDiff, toneAdjusted } = compositePixels(gp.data, cp.data, mask, W, H);
  const out = ctxC.createImageData(W, H);
  out.data.set(outData);
  ctxC.putImageData(out, 0, 0);
  const image = canvasC.transferToImageBitmap();
  return { image, residual, transform: t, edgeLumaDiff, toneAdjusted };
}

/**
 * SPEC 10.5: kompozit sonrası tekrar landmark; lengthRatio ve jawRatio orijinalden %3'ten fazla sapmamalı.
 * Sakal stillerinde yalnız sakal yönündeki sapma maxBeardVolumeDrift'e kadar kabul edilir (driftOk).
 */
export function geometryDrift(
  landmarksOriginal: Point[],
  landmarksComposite: Point[],
  policy: DriftPolicy = "symmetric",
): { length: number; jaw: number; ok: boolean } {
  const a = computeMetrics(rollCorrect(landmarksOriginal).points, null);
  const b = computeMetrics(rollCorrect(landmarksComposite).points, null);
  const length = (b.lengthRatio - a.lengthRatio) / a.lengthRatio;
  const jaw = (b.jawRatio - a.jawRatio) / a.jawRatio;
  return { length: Math.abs(length), jaw: Math.abs(jaw), ok: driftOk({ length, jaw }, policy) };
}

/** YZ etiketini (common.aiGenerated: "Aura ile oluşturuldu · YZ simülasyonu") görsele gömer (SPEC 10.7 indirme). */
export async function stampAiLabel(image: ImageBitmap, label: string): Promise<Blob> {
  const canvas = new OffscreenCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new CompositeError("canvas");
  ctx.drawImage(image, 0, 0);
  const fontPx = Math.max(14, Math.round(image.width * 0.028));
  ctx.font = `600 ${fontPx}px system-ui, sans-serif`;
  const padding = Math.round(fontPx * 0.6);
  const textW = ctx.measureText(label).width;
  const x = image.width - textW - padding * 2 - fontPx, y = image.height - fontPx * 2 - padding;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(x, y, textW + padding * 2, fontPx + padding);
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "top";
  ctx.fillText(label, x + padding, y + padding / 2);
  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
}
