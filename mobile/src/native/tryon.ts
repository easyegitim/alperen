// SPEC 10.4–10.5 mobil kompozit: Skia ile hizalama + piksel çekirdeği (lib/tryon/pixels.ts) + yeniden yüz bulma ve sapma.
// Görseller yalnız önbellek dosyalarında ve bellekte; sunucuya yalnız 1024 px C gider (/api/tryon).
import { AlphaType, ColorType, matchFont, PaintStyle, Skia, type SkImage } from "@shopify/react-native-skia";
import { File, Paths } from "expo-file-system";
import { Platform } from "react-native";
import type { Protect } from "@/content/types";
import { IDX } from "@/lib/face/indices";
import type { Point } from "@/lib/face/types";
import { alignmentResidual, estimateSimilarity } from "@/lib/tryon/align";
import { alignPointsFor, geometryDrift, TRYON_LIMITS, type DriftPolicy } from "@/lib/tryon/composite";
import { glowUpGate, rewriteHighFrequency, type GlowUpGateReason } from "@/lib/tryon/glowUp";
import { buildProtectMask, skinRegionMask } from "@/lib/tryon/mask";
import { compositePixels } from "@/lib/tryon/pixels";
import { toFrameAnalysis } from "@/mobile/src/features/capture/frame";
import { scalePoints, similarityToMatrix } from "@/mobile/src/features/tryon/matrix";
import { detectFaceOnImage } from "./faceLandmarker";
import { deleteQuietly } from "./images";

export type TryonOutcome =
  | { ok: true; uri: string; base64: string; residual: number; toneAdjusted: boolean }
  | { ok: false; reason: "no_face_in_output" | "alignment_residual" | "geometry_drift" | "canvas" | GlowUpGateReason };

export type CompositeOptions = {
  /**
   * glow_up cilt katmanı (KB Ç9; PLAN 5d): modelin çıktısı cilt bölgesinde doku/ton kapısından geçer (lib/tryon/glowUp.ts),
   * sonra orijinal ince doku (ben/çil/iz/gözenek) geri yazılır. Kapı geçmezse görsel gösterilmez (çağıran kota iadesi ister).
   */
  glowUp?: boolean;
};

const RGBA = { colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul } as const;

async function writeTemp(base64: string, name: string): Promise<File> {
  const f = new File(Paths.cache, name);
  f.write(base64, { encoding: "base64" });
  return f;
}

async function landmarksPx(path: string): Promise<{ points: Point[]; width: number; height: number } | null> {
  const bundle = await detectFaceOnImage(path);
  const fa = toFrameAnalysis(bundle, Date.now());
  if (!fa.landmarks) return null;
  return { points: fa.landmarks.map((p) => ({ x: p.x * fa.width, y: p.y * fa.height })), width: fa.width, height: fa.height };
}

function readRgba(img: SkImage, W: number, H: number): Uint8ClampedArray | null {
  const px = img.readPixels(0, 0, { width: W, height: H, ...RGBA });
  if (!px) return null;
  return px instanceof Uint8ClampedArray ? px : new Uint8ClampedArray(px.buffer, px.byteOffset, px.byteLength);
}

/**
 * C: 1024 px kare kırpım (uri) + C üzerindeki noktalar (piksel). gBase64: modelin ürettiği görsel.
 * Adımlar: G'de yüz bul → benzerlik dönüşümü → G' = hizalı G → maske → kompozit → kompozitte yüz bul → geometri sapması.
 */
export async function compositeTryonNative(cUri: string, landmarksC: Point[], gBase64: string, protect: Protect, policy: DriftPolicy, opts: CompositeOptions = {}): Promise<TryonOutcome> {
  const gFile = await writeTemp(gBase64, `aura-g-${Date.now()}.jpg`);
  let outFile: File | null = null;
  try {
    const g = await landmarksPx(gFile.uri);
    if (!g) return { ok: false, reason: "no_face_in_output" };

    const cImg = Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(cUri));
    const gImg = Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(gFile.uri));
    if (!cImg || !gImg) return { ok: false, reason: "canvas" };
    const W = cImg.width(), H = cImg.height();

    // 1–2) G → C boyutu; benzerlik dönüşümü L_G → L_C (sabit noktalar), artık kontrolü
    const LG = scalePoints(g.points, W / gImg.width(), H / gImg.height());
    // v2: sakal parçası varsa (policy) ya da sakal bölgesini modele bırakan maskede çene ucu hizalamaya girmez.
    const points = alignPointsFor(protect, policy);
    const src = points.map((i) => LG[i]);
    const dst = points.map((i) => landmarksC[i]);
    const t = estimateSimilarity(src, dst);
    const ipd = Math.hypot(landmarksC[IDX.irisR].x - landmarksC[IDX.irisL].x, landmarksC[IDX.irisR].y - landmarksC[IDX.irisL].y);
    const residual = alignmentResidual(t, src, dst, ipd);
    if (!(residual < TRYON_LIMITS.maxResidual)) return { ok: false, reason: "alignment_residual" };

    // G' çizimi: önce C boyutuna ölçek, sonra benzerlik dönüşümü
    const surface = Skia.Surface.Make(W, H);
    if (!surface) return { ok: false, reason: "canvas" };
    const canvas = surface.getCanvas();
    canvas.concat(similarityToMatrix(t));
    canvas.drawImageRect(gImg, Skia.XYWHRect(0, 0, gImg.width(), gImg.height()), Skia.XYWHRect(0, 0, W, H), Skia.Paint());
    const gAligned = surface.makeImageSnapshot();
    const gp = readRgba(gAligned, W, H);
    const cp = readRgba(cImg, W, H);
    gAligned.dispose();
    gImg.dispose();
    if (!gp || !cp) return { ok: false, reason: "canvas" };

    // 3–5) maske + karışım (saf çekirdek)
    const mask = buildProtectMask(landmarksC, W, H, protect);
    const { out, toneAdjusted } = compositePixels(gp, cp, mask, W, H);
    if (opts.glowUp) {
      // 6) glow_up: kapı geri yazımdan ÖNCE modelin çıktısını ölçer; sonra orijinal ince doku geri yazılır.
      const region = skinRegionMask(landmarksC, W, H);
      const gate = glowUpGate(cp, out, region, W, H);
      if (!gate.ok && gate.reason) {
        cImg.dispose();
        return { ok: false, reason: gate.reason };
      }
      rewriteHighFrequency(out, cp, region, W, H);
    }
    const outImg = Skia.Image.MakeImage({ width: W, height: H, ...RGBA }, Skia.Data.fromBytes(new Uint8Array(out.buffer)), W * 4);
    cImg.dispose();
    if (!outImg) return { ok: false, reason: "canvas" };
    const base64 = outImg.encodeToBase64(undefined, 92);
    outImg.dispose();
    outFile = await writeTemp(base64, `aura-out-${Date.now()}.jpg`);

    // 10.5) kompozitte tekrar yüz; geometri sapması ≤ %3
    const o = await landmarksPx(outFile.uri);
    if (!o) return { ok: false, reason: "no_face_in_output" };
    const drift = geometryDrift(landmarksC, o.points, policy);
    if (!drift.ok) return { ok: false, reason: "geometry_drift" };
    const uri = outFile.uri;
    outFile = null; // başarı: dosya sonuç ekranında kullanılır, kullanıcı ayrılınca silinir
    return { ok: true, uri, base64, residual, toneAdjusted };
  } finally {
    await deleteQuietly(gFile.uri);
    if (outFile) await deleteQuietly(outFile.uri);
  }
}

/** YZ etiketini (common.aiGenerated: "Aura ile oluşturuldu · YZ simülasyonu") gömer (SPEC 10.7 indirme/paylaşma). */
export async function stampAiLabelBase64(uri: string, label: string): Promise<string> {
  const img = Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(uri));
  if (!img) throw new Error("canvas");
  const W = img.width(), H = img.height();
  const surface = Skia.Surface.Make(W, H);
  if (!surface) throw new Error("canvas");
  const canvas = surface.getCanvas();
  canvas.drawImageRect(img, Skia.XYWHRect(0, 0, W, H), Skia.XYWHRect(0, 0, W, H), Skia.Paint());
  const fontPx = Math.max(14, Math.round(W * 0.028));
  const font = matchFont({ fontFamily: Platform.select({ ios: "Helvetica", default: "sans-serif" }), fontSize: fontPx, fontWeight: "bold" });
  const padding = Math.round(fontPx * 0.6);
  const textW = font.measureText(label).width;
  const x = W - textW - padding * 2 - fontPx, y = H - fontPx * 2 - padding;
  const bg = Skia.Paint();
  bg.setColor(Skia.Color("rgba(0,0,0,0.55)"));
  canvas.drawRect(Skia.XYWHRect(x, y, textW + padding * 2, fontPx + padding), bg);
  const fg = Skia.Paint();
  fg.setStyle(PaintStyle.Fill);
  fg.setColor(Skia.Color("#ffffff"));
  canvas.drawText(label, x + padding, y + padding / 2 + fontPx * 0.85, fg, font);
  const out = surface.makeImageSnapshot().encodeToBase64(undefined, 92);
  img.dispose();
  return out;
}
