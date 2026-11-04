"use client";

// SPEC F10 / Faz 7 madde 6: paylaşım kartı istemcide canvas ile üretilir; sunucuya hiçbir şey gitmez.
export type ShareCardFormat = "story" | "square";

export type ShareCardInput = {
  overall: number;
  potential: number;
  subs: { label: string; value: number }[]; // en çok 3
  appName: string;
  url: string;
  photo?: ImageBitmap | null;
  format: ShareCardFormat;
  /** Sabit not (SPEC 4.3). */
  disclaimer: string;
};

export const CARD_SIZES: Record<ShareCardFormat, { w: number; h: number }> = {
  story: { w: 1080, h: 1920 },
  square: { w: 1080, h: 1080 },
};

const fmt = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export async function renderShareCard(input: ShareCardInput): Promise<Blob> {
  const { w, h } = CARD_SIZES[input.format];
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");

  // Arka plan: nötr koyu degrade (skorlar nötr renk skalasıyla gösterilir, SPEC 4.3)
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#111111");
  g.addColorStop(1, "#2a2a2a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const pad = 80;
  let y = input.format === "story" ? 260 : 110;
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "top";

  // Başlık
  ctx.font = "600 44px system-ui, -apple-system, sans-serif";
  ctx.fillText(input.appName, pad, y);
  y += 90;

  // İsteğe bağlı fotoğraf (daire)
  if (input.photo) {
    const r = input.format === "story" ? 180 : 130;
    const cx = w - pad - r;
    const cy = y + r;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    const s = Math.min(input.photo.width, input.photo.height);
    ctx.drawImage(input.photo, (input.photo.width - s) / 2, (input.photo.height - s) / 2, s, s, cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
  }

  // Genel skor
  ctx.font = "400 40px system-ui, sans-serif";
  ctx.fillStyle = "#bdbdbd";
  ctx.fillText("Genel skor", pad, y);
  y += 56;
  ctx.font = "700 220px system-ui, sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(fmt(input.overall), pad, y);
  y += 250;

  // Potansiyel
  ctx.font = "500 48px system-ui, sans-serif";
  ctx.fillStyle = "#e6e6e6";
  ctx.fillText(`Potansiyel ${fmt(input.potential)}  (+${fmt(Math.max(0, input.potential - input.overall))})`, pad, y);
  y += 110;

  // 3 alt skor çubuğu
  const barW = w - pad * 2;
  for (const s of input.subs.slice(0, 3)) {
    ctx.font = "400 36px system-ui, sans-serif";
    ctx.fillStyle = "#bdbdbd";
    ctx.fillText(s.label, pad, y);
    ctx.textAlign = "right";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(fmt(s.value), w - pad, y);
    ctx.textAlign = "left";
    y += 50;
    ctx.fillStyle = "#3a3a3a";
    roundRect(ctx, pad, y, barW, 16, 8);
    ctx.fillStyle = "#f2f2f2";
    roundRect(ctx, pad, y, (barW * Math.min(10, s.value)) / 10, 16, 8);
    y += 60;
  }

  // Alt bilgi
  const footY = h - (input.format === "story" ? 220 : 150);
  ctx.font = "400 30px system-ui, sans-serif";
  ctx.fillStyle = "#9a9a9a";
  wrapText(ctx, input.disclaimer, pad, footY, w - pad * 2, 38);
  ctx.font = "500 34px system-ui, sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(input.url, pad, h - 90);

  return canvas.convertToBlob({ type: "image/png" });
}

function roundRect(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, Math.max(w, r * 2), h, r);
  ctx.fill();
}

function wrapText(ctx: OffscreenCanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number) {
  const words = text.split(" ");
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y);
      line = word;
      y += lineH;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, y);
}

/** Web Share API (dosya destekliyorsa), yoksa indirme. */
export async function shareOrDownload(blob: Blob, filename: string, title: string): Promise<"shared" | "downloaded"> {
  const file = new File([blob], filename, { type: blob.type });
  if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return "shared";
    } catch {
      // kullanıcı vazgeçti → indirmeye düş
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return "downloaded";
}

// ── Sanal deneme paylaşım görseli (PLAN 5e; KB §7.4 K16): etiket her çıktıya gömülür ──────────────────────────────

/** Çizim için gereken en küçük 2D bağlam yüzeyi (OffscreenCanvas ve test sahteleri ortak). */
export type ShareDrawContext = {
  fillStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  textBaseline: CanvasTextBaseline;
  textAlign: CanvasTextAlign;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
  beginPath(): void;
  roundRect(x: number, y: number, w: number, h: number, r: number): void;
  fill(): void;
};

export type TryonShareInput = {
  after: CanvasImageSource & { width: number; height: number };
  /** Zorunlu: common.aiGenerated ("Aura ile oluşturuldu · YZ simülasyonu"). Boş etiketle çizim reddedilir. */
  label: string;
  /** Stil adı (ör. "Buzz kesim + Van Dyke"); görselin altına yazılır. */
  title: string;
  appName: string;
};

/** Etiket kutusu yerleşimi (saf): sağ alt köşe, görsel genişliğine ölçekli. */
export function tryonLabelLayout(w: number, h: number, textWidth: number): { fontPx: number; padding: number; x: number; y: number; boxW: number; boxH: number } {
  const fontPx = Math.max(14, Math.round(w * 0.028));
  const padding = Math.round(fontPx * 0.6);
  const boxW = textWidth + padding * 2, boxH = fontPx + padding;
  return { fontPx, padding, x: w - boxW - fontPx, y: h - boxH - fontPx, boxW, boxH };
}

/**
 * Deneme sonucunu paylaşım görseline çizer: görsel + gömülü YZ etiketi (sağ alt) + stil adı ve uygulama adı (alt şerit).
 * Etiket boşsa Error: etiketsiz paylaşım görseli üretilmez (K16).
 */
export function drawTryonShare(ctx: ShareDrawContext, input: TryonShareInput, w: number, h: number): void {
  if (!input.label.trim()) throw new Error("ai_label_required");
  const imgH = Math.round(h * 0.88);
  ctx.fillStyle = "#111111";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(input.after, 0, 0, w, imgH);
  // YZ etiketi görselin ÜSTÜNE gömülür (kırpılsa da görselde kalır)
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  const probe = tryonLabelLayout(w, imgH, 0);
  ctx.font = `600 ${probe.fontPx}px system-ui, sans-serif`;
  const lay = tryonLabelLayout(w, imgH, ctx.measureText(input.label).width);
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.beginPath();
  ctx.roundRect(lay.x, lay.y, lay.boxW, lay.boxH, Math.round(lay.boxH / 2));
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.fillText(input.label, lay.x + lay.padding, lay.y + lay.padding / 2);
  // Alt şerit: stil adı + uygulama adı
  const stripY = imgH;
  const titlePx = Math.max(16, Math.round(w * 0.034));
  ctx.fillStyle = "#ffffff";
  ctx.font = `600 ${titlePx}px system-ui, sans-serif`;
  ctx.fillText(input.title, Math.round(w * 0.05), stripY + Math.round((h - imgH) * 0.22));
  ctx.fillStyle = "#bdbdbd";
  ctx.font = `400 ${Math.round(titlePx * 0.8)}px system-ui, sans-serif`;
  ctx.fillText(input.appName, Math.round(w * 0.05), stripY + Math.round((h - imgH) * 0.58));
}

/** Paylaşım / indirme görseli (JPEG): kare görsel + alt şerit. Sunucuya hiçbir şey gitmez. */
export async function renderTryonShareImage(input: TryonShareInput): Promise<Blob> {
  const w = input.after.width, h = Math.round(input.after.width / 0.88);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");
  drawTryonShare(ctx, input, w, h);
  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
}
