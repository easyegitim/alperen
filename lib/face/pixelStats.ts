// SPEC 7.3 ışık ve netlik ölçümleri; saf fonksiyon (web worker ve mobil Skia aynı kodu kullanır). Birim testli.
export type PixelStats = { brightness: number | null; brightnessBalance: number | null; sharpness: number | null };

/**
 * RGBA (4 bayt/piksel) yüz kırpımından: ortalama parlaklık (0–255), sol/sağ yanak parlaklık farkı,
 * 128×128 gri yeniden örneklemede Laplace varyansı (netlik). Kırpım yüz kutusu olmalı (en az 8×8).
 */
export function pixelStatsFromRgba(img: ArrayLike<number>, w: number, h: number): PixelStats {
  if (w < 8 || h < 8 || img.length < w * h * 4) return { brightness: null, brightnessBalance: null, sharpness: null };
  let sum = 0, leftSum = 0, rightSum = 0, leftN = 0, rightN = 0;
  const gray = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const g = 0.299 * img[i] + 0.587 * img[i + 1] + 0.114 * img[i + 2];
      gray[y * w + x] = g;
      sum += g;
      // yanaklar: dikeyde %40–70 bandı, yatayda dış %30'lar
      if (y > h * 0.4 && y < h * 0.7) {
        if (x < w * 0.3) { leftSum += g; leftN++; } else if (x > w * 0.7) { rightSum += g; rightN++; }
      }
    }
  }
  const brightness = sum / (w * h);
  const brightnessBalance = leftN && rightN ? Math.abs(leftSum / leftN - rightSum / rightN) : null;

  const L = 128;
  const lap: number[] = [];
  const sample = (x: number, y: number) => gray[Math.min(h - 1, Math.floor((y * h) / L)) * w + Math.min(w - 1, Math.floor((x * w) / L))];
  for (let y = 1; y < L - 1; y++) {
    for (let x = 1; x < L - 1; x++) {
      lap.push(sample(x - 1, y) + sample(x + 1, y) + sample(x, y - 1) + sample(x, y + 1) - 4 * sample(x, y));
    }
  }
  const mean = lap.reduce((a, v) => a + v, 0) / lap.length;
  const sharpness = lap.reduce((a, v) => a + (v - mean) ** 2, 0) / lap.length;
  return { brightness, brightnessBalance, sharpness };
}

/** Normalize yüz kutusunu S×S ızgaraya piksel kutusuna çevirir (en az 8 px; sınırlara sığdırılır). */
export function faceBoxToPixels(b: { minX: number; minY: number; maxX: number; maxY: number }, S: number): { x0: number; y0: number; w: number; h: number } {
  const x0 = Math.max(0, Math.floor(b.minX * S)), y0 = Math.max(0, Math.floor(b.minY * S));
  const x1 = Math.min(S, Math.ceil(b.maxX * S)), y1 = Math.min(S, Math.ceil(b.maxY * S));
  return { x0, y0, w: x1 - x0, h: y1 - y0 };
}
