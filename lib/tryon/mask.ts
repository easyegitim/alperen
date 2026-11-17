// SPEC 10.4 adım 3: koruma maskesi M (C koordinatlarında). 255 = kullanıcının orijinal pikseli korunur.
// PLAN_V2 5a/5d (CONTRACTS_V2 S2.6 MASK_REGIONS): features_only · features_cheeks · hair_only · beard_only eklendi.
// Saf; canvas/DOM yok (web worker ve mobil Skia ortak). Birim testli (tests/unit/tryonMask.test.ts).
import { CHEEK_REF, FACE_OVAL, IDX, LEFT_BROW, LEFT_EYE, LIPS, NOSE, RIGHT_BROW, RIGHT_EYE } from "@/lib/face/indices";
import type { Point } from "@/lib/face/types";
import type { Protect } from "@/content/types";
import { GLOW_UP_GATE } from "@/lib/config/tryon";

export const FEATHER_PX = 10;
export const BROW_MARGIN_PX = 4;
/** Özellik poligonları (göz, kaş, burun, dudak) yumuşatma kenarı içeride kalmasın diye bu kadar genişletilir. */
export const FEATURE_MARGIN_PX = 10;
/** Orta yanak: alt göz kapağının altından başlar (göz altı morluğu modele bırakılmaz). */
export const CHEEK_TOP_MARGIN_PX = 6;
/** hair_only: boyun koruması çene köşelerinden bu kadar dışarı taşar. */
export const NECK_MARGIN_PX = 12;

/** Nokta poligonun içinde mi (even-odd). */
export function pointInPolygon(x: number, y: number, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Yüz ovali poligonu (SPEC 7.4 sırası). */
export function faceOvalPolygon(L: Point[]): Point[] {
  return FACE_OVAL.map((i) => L[i]);
}

/** Poligonu ağırlık merkezinden dışa doğru px kadar genişletir (yumuşatma payı). */
export function dilatePolygon(poly: Point[], px: number): Point[] {
  if (poly.length === 0 || px === 0) return poly;
  let cx = 0, cy = 0;
  for (const p of poly) {
    cx += p.x; cy += p.y;
  }
  cx /= poly.length; cy /= poly.length;
  return poly.map((p) => {
    const d = Math.hypot(p.x - cx, p.y - cy) || 1;
    return { x: p.x + ((p.x - cx) / d) * px, y: p.y + ((p.y - cy) / d) * px };
  });
}

const pick = (L: Point[], idx: readonly number[]): Point[] => idx.map((i) => L[i]);

/** Kimlik öğeleri: sağ/sol göz, sağ/sol kaş, burun, dudaklar (genişletilmiş). */
export function featurePolygons(L: Point[], margin = FEATURE_MARGIN_PX): Point[][] {
  return [RIGHT_EYE, LEFT_EYE, RIGHT_BROW, LEFT_BROW, NOSE, LIPS].map((idx) => dilatePolygon(pick(L, idx), margin));
}

/**
 * Orta yanak (features_cheeks): göz dış köşesi ile burun kanadı arasında, alt göz kapağının altından burun altı
 * çizgisine kadar. Dış yanak, favori, çene altı ve bıyık dışarıda kalır → modele bırakılır (KB R2-C10/1, R1-E10).
 */
export function midCheekPolygons(L: Point[]): Point[][] {
  const subY = L[IDX.subnasale].y;
  const side = (eyeOuter: number, eyeInner: number, eyeBottom: number, noseAla: number): Point[] => {
    const top = L[eyeBottom].y + CHEEK_TOP_MARGIN_PX;
    const xOut = L[eyeOuter].x, xIn = L[eyeInner].x, xAla = L[noseAla].x;
    return [
      { x: xOut, y: top },
      { x: xIn, y: top },
      { x: xAla, y: (top + subY) / 2 },
      { x: xAla, y: subY },
      { x: xOut, y: subY },
    ];
  };
  return [
    side(IDX.eyeOuterR, IDX.eyeInnerR, CHEEK_REF.eyeBottomR, CHEEK_REF.noseAlaR),
    side(IDX.eyeOuterL, IDX.eyeInnerL, CHEEK_REF.eyeBottomL, CHEEK_REF.noseAlaL),
  ];
}

function fillPolygon(mask: Uint8ClampedArray, width: number, height: number, poly: Point[], yMin = 0, yMax = height - 1) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const y0 = Math.max(0, yMin, Math.floor(minY)), y1 = Math.min(height - 1, yMax, Math.ceil(maxY));
  const x0 = Math.max(0, Math.floor(minX)), x1 = Math.min(width - 1, Math.ceil(maxX));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (pointInPolygon(x + 0.5, y + 0.5, poly)) mask[y * width + x] = 255;
    }
  }
}

function fillRect(mask: Uint8ClampedArray, width: number, height: number, x0: number, y0: number, x1: number, y1: number) {
  const ax = Math.max(0, Math.floor(x0)), bx = Math.min(width - 1, Math.ceil(x1));
  const ay = Math.max(0, Math.floor(y0)), by = Math.min(height - 1, Math.ceil(y1));
  for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) mask[y * width + x] = 255;
}

function browTopY(L: Point[]): number {
  return Math.min(L[IDX.browTopR].y, L[IDX.browTopL].y) - BROW_MARGIN_PX;
}

/**
 * Keskin maske (0/255):
 * - below_brows: yüz ovali, üst sınırı kaş üstü çizgisinin (105, 334) 4 px üstünde kesilir (alın modele kalır).
 * - above_lip: kaş üstünden burun altına (2) kadar, yüz ovali içinde (alt yüz modele kalır).
 * - features_only: göz/kaş/burun/dudak poligonları; cilt modele kalır (glow_up; opaklık buildProtectMask'te).
 * - features_cheeks: features_only + orta yanak; dış yanak, favori, çene altı, bıyık modele kalır (sakal stilleri).
 * - hair_only: yüz ovali (alın dahil) + boyun korunur; yalnız saç değişir.
 * - beard_only: kaş üstündeki her şey (saç, alın) + özellik poligonları korunur; yalnız sakal bölgesi değişir.
 */
export function rasterizeMask(L: Point[], width: number, height: number, protect: Protect): Uint8ClampedArray {
  const mask = new Uint8ClampedArray(width * height);
  const oval = faceOvalPolygon(L);
  const browTop = browTopY(L);
  switch (protect) {
    case "below_brows":
      fillPolygon(mask, width, height, oval, Math.floor(browTop));
      break;
    case "above_lip":
      fillPolygon(mask, width, height, oval, Math.floor(browTop), Math.ceil(L[IDX.subnasale].y));
      break;
    case "features_only":
      for (const poly of featurePolygons(L)) fillPolygon(mask, width, height, poly);
      break;
    case "features_cheeks":
      for (const poly of [...featurePolygons(L), ...midCheekPolygons(L)]) fillPolygon(mask, width, height, poly);
      break;
    case "hair_only": {
      fillPolygon(mask, width, height, oval);
      const x0 = Math.min(L[IDX.gonionR].x, L[IDX.gonionL].x) - NECK_MARGIN_PX;
      const x1 = Math.max(L[IDX.gonionR].x, L[IDX.gonionL].x) + NECK_MARGIN_PX;
      fillRect(mask, width, height, x0, L[IDX.menton].y - NECK_MARGIN_PX, x1, height - 1);
      break;
    }
    case "beard_only":
      fillRect(mask, width, height, 0, 0, width - 1, browTop);
      for (const poly of featurePolygons(L)) fillPolygon(mask, width, height, poly);
      break;
  }
  return mask;
}

/**
 * Cilt bölgesi (glow_up kapısı, lib/tryon/glowUp.ts): kaş altı yüz ovali eksi özellik poligonları (0/255).
 * Doku oranı ve ton kayması yalnız bu bölgede ölçülür; ben/çil/iz/gözenek geri yazımı da burada.
 */
export function skinRegionMask(L: Point[], width: number, height: number): Uint8ClampedArray {
  const mask = rasterizeMask(L, width, height, "below_brows");
  const cut = new Uint8ClampedArray(width * height);
  for (const poly of featurePolygons(L)) fillPolygon(cut, width, height, poly);
  for (let i = 0; i < mask.length; i++) if (cut[i]) mask[i] = 0;
  return mask;
}

/** Ayrılabilir kutu bulanıklığı ×3 ≈ Gauss (SPEC: 10 px yumuşatma). */
export function feather(mask: Uint8ClampedArray, width: number, height: number, radius = FEATHER_PX): Uint8ClampedArray {
  let src = Float32Array.from(mask);
  const r = Math.max(1, Math.round(radius / 2));
  for (let pass = 0; pass < 3; pass++) {
    const tmp = new Float32Array(width * height);
    // yatay
    for (let y = 0; y < height; y++) {
      let acc = 0;
      const row = y * width;
      for (let x = -r; x <= r; x++) acc += src[row + clamp(x, 0, width - 1)];
      for (let x = 0; x < width; x++) {
        tmp[row + x] = acc / (2 * r + 1);
        acc += src[row + clamp(x + r + 1, 0, width - 1)] - src[row + clamp(x - r, 0, width - 1)];
      }
    }
    // dikey
    const out = new Float32Array(width * height);
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[clamp(y, 0, height - 1) * width + x];
      for (let y = 0; y < height; y++) {
        out[y * width + x] = acc / (2 * r + 1);
        acc += tmp[clamp(y + r + 1, 0, height - 1) * width + x] - tmp[clamp(y - r, 0, height - 1) * width + x];
      }
    }
    src = out;
  }
  return Uint8ClampedArray.from(src, (v) => Math.round(v));
}

/** Bölgeye göre koruma opaklığı: features_only 0,8 (KB Ç9 / PLAN 5d; GLOW_UP_GATE), diğerleri 1. */
export function protectOpacity(protect: Protect): number {
  return protect === "features_only" ? GLOW_UP_GATE.featuresOnlyOpacity : 1;
}

export function buildProtectMask(L: Point[], width: number, height: number, protect: Protect): Uint8ClampedArray {
  const m = feather(rasterizeMask(L, width, height, protect), width, height);
  const opacity = protectOpacity(protect);
  if (opacity >= 1) return m;
  for (let i = 0; i < m.length; i++) m[i] = Math.round(m[i] * opacity);
  return m;
}

/** Maske kenarındaki bant (SPEC 10.4 adım 5, 12 px): 8 < M < peak − 8 olan pikseller (peak: 255; features_only'de 204). */
export function edgeBand(mask: Uint8ClampedArray, peak = 255): Uint32Array {
  const idx: number[] = [];
  const hi = peak - 8;
  for (let i = 0; i < mask.length; i++) if (mask[i] > 8 && mask[i] < hi) idx.push(i);
  return Uint32Array.from(idx);
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
