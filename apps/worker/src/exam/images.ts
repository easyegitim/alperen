/**
 * Deneme sayfası alımı (docs/PLAN-v2.md §8 "Alım"): EXIF döndürme, basit eğrilik düzeltme, en uzun kenar ≤ 2576 px,
 * JPEG kalite 85. Sınıflamanın bildirdiği 90/180/270 döndürme sonradan `rotatePage` ile uygulanır. Şekil kırpımı
 * (`cropBox`) model kutusu (0..1 oranlı, normalleştirilmiş sayfaya göre) ile yapılır.
 *
 * Eğrilik: küçültülmüş gri görüntüde -4°..+4° (0,5° adım) döndürülüp satır toplamlarının varyansı ölçülür (yatay metin
 * satırları hizalandığında satır profili en keskin olur). 0,5°'nin altı düzeltilmez. PDF sayfaları işlenmez.
 */
import sharp from 'sharp';

export const MAX_EDGE = 2576;
export const JPEG_QUALITY = 85;
const SKEW_PROBE_WIDTH = 480;
const SKEW_MAX_DEG = 4;
const SKEW_STEP_DEG = 0.5;
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

export interface NormalizedPage {
  bytes: Buffer;
  mime: 'image/jpeg';
  width: number;
  height: number;
  /** EXIF yönü uygulandı mı (1 dışı yön). */
  exifRotated: boolean;
  /** Uygulanan eğrilik düzeltmesi (derece; 0: yok). */
  skewDeg: number;
  /** Boyut küçültüldü mü. */
  resized: boolean;
  /** Geometri değişti mi (EXIF, eğrilik ya da sınıflama döndürmesi): kırpım kutuları orijinale değil bu görüntüye göredir. */
  geometryChanged: boolean;
}

/** Satır profili keskinliği: satır başına koyu piksel sayısının varyansı. */
function rowVariance(data: Buffer, width: number, height: number): number {
  let sum = 0;
  let sumSq = 0;
  for (let y = 0; y < height; y++) {
    let dark = 0;
    const row = y * width;
    for (let x = 0; x < width; x++) if (data[row + x]! < 128) dark++;
    sum += dark;
    sumSq += dark * dark;
  }
  const mean = sum / height;
  return sumSq / height - mean * mean;
}

/** Görüntünün eğrilik açısı (derece; düzeltmek için bu açıyla döndürülür). Yetersiz içerikte 0. */
export async function estimateSkew(input: Buffer): Promise<number> {
  const probe = await sharp(input).greyscale().resize({ width: SKEW_PROBE_WIDTH, withoutEnlargement: true }).png().toBuffer();
  let best = 0;
  let bestScore = -1;
  let zeroScore = -1;
  for (let a = -SKEW_MAX_DEG; a <= SKEW_MAX_DEG + 1e-9; a += SKEW_STEP_DEG) {
    const angle = Math.round(a * 10) / 10;
    const { data, info } = await sharp(probe)
      .rotate(angle, { background: WHITE })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const score = rowVariance(data, info.width, info.height);
    if (angle === 0) zeroScore = score;
    if (score > bestScore + 1e-9) {
      bestScore = score;
      best = angle;
    }
  }
  // Boş sayfa ya da kararsız profil: belirgin kazanç yoksa döndürme yapılmaz.
  if (zeroScore <= 0 || bestScore < zeroScore * 1.05) return 0;
  return Math.abs(best) < SKEW_STEP_DEG ? 0 : best;
}

/** EXIF döndürme → (isteğe bağlı) eğrilik düzeltme → ≤ 2576 px → JPEG q85. */
export async function normalizePage(input: Buffer, opts: { deskew?: boolean } = {}): Promise<NormalizedPage> {
  const meta = await sharp(input, { failOn: 'none' }).metadata();
  const orientation = meta.orientation ?? 1;
  // sharp bir boru hattında tek döndürme yapar: önce EXIF yönü ayrı geçişte uygulanır
  const oriented = await sharp(input, { failOn: 'none' }).rotate().png().toBuffer();
  const skewDeg = opts.deskew === false ? 0 : await estimateSkew(oriented);
  const straight = skewDeg !== 0 ? await sharp(oriented).rotate(skewDeg, { background: WHITE }).png().toBuffer() : oriented;
  const sm = await sharp(straight).metadata();
  const longest = Math.max(sm.width ?? 0, sm.height ?? 0);
  const resized = longest > MAX_EDGE;
  const out = await sharp(straight)
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: WHITE })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return {
    bytes: out.data,
    mime: 'image/jpeg',
    width: out.info.width,
    height: out.info.height,
    exifRotated: orientation !== 1,
    skewDeg,
    resized,
    geometryChanged: orientation !== 1 || skewDeg !== 0,
  };
}

/** Sınıflamanın bildirdiği saat yönü döndürmesi (0/90/180/270). */
export async function rotatePage(page: NormalizedPage, degrees: 0 | 90 | 180 | 270): Promise<NormalizedPage> {
  if (degrees === 0) return page;
  const out = await sharp(page.bytes).rotate(degrees).jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  return { ...page, bytes: out.data, width: out.info.width, height: out.info.height, geometryChanged: true };
}

export interface BoxRatio {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Kutunun piksel karşılığı (sayfa içine kırpılır, çevresine `pad` oranında pay). */
export function boxPixels(box: BoxRatio, width: number, height: number, pad = 0.01): { left: number; top: number; width: number; height: number } {
  const x0 = Math.max(0, box.x - pad);
  const y0 = Math.max(0, box.y - pad);
  const x1 = Math.min(1, box.x + box.w + pad);
  const y1 = Math.min(1, box.y + box.h + pad);
  const left = Math.floor(x0 * width);
  const top = Math.floor(y0 * height);
  return {
    left,
    top,
    width: Math.max(1, Math.min(width - left, Math.ceil(x1 * width) - left)),
    height: Math.max(1, Math.min(height - top, Math.ceil(y1 * height) - top)),
  };
}

/** Şekil kırpımı (PNG). */
export async function cropBox(bytes: Buffer, box: BoxRatio, pad = 0.01): Promise<{ bytes: Buffer; width: number; height: number }> {
  const meta = await sharp(bytes).metadata();
  const r = boxPixels(box, meta.width ?? 1, meta.height ?? 1, pad);
  const out = await sharp(bytes).extract(r).png().toBuffer({ resolveWithObject: true });
  return { bytes: out.data, width: out.info.width, height: out.info.height };
}
