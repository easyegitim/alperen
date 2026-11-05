// Sonuç ekranı ve çekim kartındaki ölçü çizgileri (UI spec §2.5). Saf: yalnız piksel koordinatlarından çizgi listesi
// üretir. Çizim tarayıcıda, bellekteki fotoğraf üzerinde yapılır; çizgiler ve noktalar hiçbir yere gönderilmez.
import type { ExplainItem, StructuralExplainKey } from "@/lib/score/contract";
import { FACE_OVAL, IDX } from "./indices";
import type { Point } from "./types";

export const OVERLAY_LAYER_KEYS = ["oval", "midline", "vertical", "eyeAxis", "spacing", "widths"] as const;
export type OverlayLayerKey = (typeof OVERLAY_LAYER_KEYS)[number];

/** Katmanın bağlı olduğu yapısal açıklama anahtarı (motorun anahtarları). Yüz hattı tarif içindir, puana girmez. */
export const LAYER_EXPLAIN_KEY: Record<OverlayLayerKey, StructuralExplainKey | null> = {
  oval: null,
  midline: "symmetry",
  vertical: "vertical",
  eyeAxis: "tilt",
  spacing: "spacing",
  widths: "jawWidth",
};

export type Polyline = [number, number][];

const MIDLINE = [IDX.top, IDX.glabella, IDX.nasion, IDX.noseTip, IDX.subnasale, IDX.menton] as const;

function line(lm: readonly Point[], idx: readonly number[]): Polyline | null {
  const out: Polyline = [];
  for (const i of idx) {
    const p = lm[i];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    out.push([p.x, p.y]);
  }
  return out;
}

/** Piksel koordinatlı noktalardan katman çizgileri. Eksik nokta (ör. iris yoksa göz aralığı) o çizgiyi atlar. */
export function overlayLayers(landmarks: readonly Point[]): Record<OverlayLayerKey, Polyline[]> {
  const keep = (...ls: (Polyline | null)[]) => ls.filter((l): l is Polyline => l !== null);

  const oval = line(landmarks, [...FACE_OVAL, FACE_OVAL[0]]);

  // Dikey oranlar: kaş arası, burun altı ve çene ucu hizasında elmacıktan elmacığa yatay çizgiler.
  const left = landmarks[IDX.cheekR];
  const right = landmarks[IDX.cheekL];
  const horizontals = [IDX.glabella, IDX.subnasale, IDX.menton].map((i): Polyline | null => {
    const p = landmarks[i];
    if (!p || !left || !right) return null;
    return [
      [left.x, p.y],
      [right.x, p.y],
    ];
  });

  return {
    oval: keep(oval),
    midline: keep(line(landmarks, MIDLINE)),
    vertical: keep(...horizontals),
    eyeAxis: keep(line(landmarks, [IDX.eyeInnerR, IDX.eyeOuterR]), line(landmarks, [IDX.eyeInnerL, IDX.eyeOuterL])),
    spacing: keep(line(landmarks, [IDX.irisR, IDX.irisL])),
    widths: keep(line(landmarks, [IDX.cheekR, IDX.cheekL]), line(landmarks, [IDX.gonionR, IDX.gonionL])),
  };
}

export type CropRect = { x: number; y: number; width: number; height: number };

/**
 * Yüz kutusu + her yana pad × kutu kenarı; görüntü sınırlarına sığdırılır. aspect (genişlik/yükseklik) verilirse
 * kısa kenar büyütülerek oran tutturulur (görüntüye sığmıyorsa uzun kenar kırpılır).
 */
export function faceCrop(landmarks: readonly Point[], w: number, h: number, pad = 0.25, aspect?: number): CropRect {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of landmarks) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX) || w <= 0 || h <= 0) return { x: 0, y: 0, width: Math.max(w, 0), height: Math.max(h, 0) };

  const bw = maxX - minX;
  const bh = maxY - minY;
  let cw = bw + 2 * pad * bw;
  let ch = bh + 2 * pad * bh;
  if (aspect && aspect > 0) {
    if (cw / ch < aspect) cw = ch * aspect;
    else ch = cw / aspect;
    // Görüntüye sığmıyorsa oranı koruyarak küçült.
    const k = Math.min(1, w / cw, h / ch);
    cw *= k;
    ch *= k;
  }
  cw = Math.min(cw, w);
  ch = Math.min(ch, h);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const x = Math.max(0, Math.min(cx - cw / 2, w - cw));
  const y = Math.max(0, Math.min(cy - ch / 2, h - ch));
  return { x, y, width: cw, height: ch };
}

/** Açık açıklama öğelerinden "bu çekimde ölçülmedi" olan katmanlar. Yapısal öğe başka hiçbir durum taşımaz. */
export function notMeasuredLayers(items: readonly ExplainItem[]): OverlayLayerKey[] {
  const missing = new Set(items.filter((i) => i.status === "not_measured").map((i) => i.key));
  return OVERLAY_LAYER_KEYS.filter((k) => {
    const key = LAYER_EXPLAIN_KEY[k];
    return key !== null && missing.has(key);
  });
}

// ── v2: kilitli sonuç ekranındaki yuvarlak portre noktaları (KB P#6/P§6, PLAN 1f) ──────────────────────────────────
/**
 * 478 yerine 30–70 anahtar nokta: yüz hattı (36), kaş üstü, göz köşeleri, iris, burun hattı, dudak köşeleri, çene
 * köşeleri, alın. Alın/saç çizgisi noktası ağda yoktur (ağ tepesi 10 kullanılır). Yoğun sakalda çene hattı tahminidir.
 */
export const PORTRAIT_KEY_LANDMARKS: readonly number[] = Array.from(
  new Set<number>([
    ...FACE_OVAL,
    IDX.glabella, IDX.nasion, IDX.noseTip, IDX.subnasale, IDX.upperLipMid,
    IDX.foreheadR, IDX.foreheadL, IDX.browTopR, IDX.browTopL,
    IDX.eyeOuterR, IDX.eyeOuterL, IDX.eyeInnerR, IDX.eyeInnerL, IDX.irisR, IDX.irisL,
    IDX.mouthR, IDX.mouthL, IDX.stomionUpper, IDX.stomionLower,
    IDX.gonionR, IDX.gonionL, IDX.foreheadMid, IDX.noseBridge,
  ]),
);

export type PortraitGeometry = {
  /** Kare kırpım (kaynak piksel); yuvarlak portre bu kareden çizilir. */
  crop: CropRect;
  /** Çıktı tuvali piksel koordinatında anahtar noktalar (eksik nokta atlanır). */
  points: [number, number][];
  /** Aynı dönüşümle yüz hattı (kapalı) — ince kılavuz çizgisi için. */
  oval: Polyline | null;
};

/**
 * Yuvarlak portre: yüz kutusu + dolgu ile KARE kırpım (aspect 1), sonra outSize piksele ölçek. Noktalar ve fotoğraf
 * aynı kırpım/ölçek dönüşümünden geçer; dışarıya yalnız çizim gider, koordinatlar hiçbir yere gönderilmez.
 */
export function portraitGeometry(landmarks: readonly Point[], w: number, h: number, outSize: number, pad = 0.42): PortraitGeometry {
  const crop = faceCrop(landmarks, w, h, pad, 1);
  const k = crop.width > 0 ? outSize / crop.width : 1;
  const map = (p: Point): [number, number] => [(p.x - crop.x) * k, (p.y - crop.y) * k];
  const points: [number, number][] = [];
  for (const i of PORTRAIT_KEY_LANDMARKS) {
    const p = landmarks[i];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    points.push(map(p));
  }
  const oval = line(landmarks, [...FACE_OVAL, FACE_OVAL[0]]);
  return { crop, points, oval: oval ? oval.map(([x, y]) => map({ x, y })) : null };
}
