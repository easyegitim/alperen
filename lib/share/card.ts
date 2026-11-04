"use client";

// SPEC F10 / Faz 7 madde 6 + PLAN Faz 6 (KB §8 KARAR R2-Ö3, ONAYLI ÖNERİ R2-Ö2, K17): paylaşım kartı istemcide canvas ile
// üretilir; sunucuya hiçbir şey gitmez. Kart tanımı lib/share/spec.ts'teki ShareCardSpec'tir (saf; mobil aynı spec'i
// Skia ile çizer). shareSpecIssues boş değilse ÇİZİLMEZ (reklam kartında fotoğraf yok, berber kartında fotoğraf yok).
// Eski ShareCardInput + renderShareCard(input) imzası bir sürüm daha kalır (skor kartına çevrilir).
import { SUB_KEYS_V2 } from "@/lib/config/teaser";
import { SHARE_CARD_SIZES, shareSpecIssues, type ScoreShareSpec, type ShareCardFormat, type ShareCardSpec, type ShareSpecIssue } from "./spec";

export type { ShareCardFormat } from "./spec";

/** @deprecated Faz 6: ShareCardSpec kullan; bir sürüm sonra kalkar. */
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

export const CARD_SIZES: Record<ShareCardFormat, { w: number; h: number }> = SHARE_CARD_SIZES;

/** Çizimde kullanılan sabit etiketler; arayüz tr.json'dan (share.v2.labels.*) geçirir, yoksa Türkçe varsayılan. */
export type ShareCardLabels = { overall: string; potential: string };
const DEFAULT_LABELS: ShareCardLabels = { overall: "Genel skor", potential: "Potansiyel" };

export class ShareSpecError extends Error {
  readonly issues: ShareSpecIssue[];
  constructor(issues: ShareSpecIssue[]) {
    super(`share_spec_invalid: ${issues.join(",")}`);
    this.issues = issues;
  }
}

const fmt = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

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

/** Skor/en güçlü/berber kartı için ek yüzey: daire kırpımlı fotoğraf ve (varsa) degrade. */
export type CardDrawContext = ShareDrawContext & {
  save(): void;
  restore(): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  clip(): void;
  drawImage(image: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
  createLinearGradient?(x0: number, y0: number, x1: number, y1: number): CanvasGradient;
};

export type CardPhoto = CanvasImageSource & { width: number; height: number };

const BG = "#111111", FG = "#ffffff", MUTED = "#bdbdbd", FAINT = "#9a9a9a", TRACK = "#3a3a3a", BAR = "#f2f2f2", ACCENT = "#7c9cff";

function roundRect(ctx: ShareDrawContext, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, Math.max(w, r * 2), h, r);
  ctx.fill();
}

/** Satır kaydırma; kaç satır yazıldığını döner. */
function wrapText(ctx: ShareDrawContext, text: string, x: number, y: number, maxW: number, lineH: number, maxLines = 12): number {
  const words = text.split(" ");
  let line = "", lines = 0;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y + lines * lineH);
      lines++;
      line = word;
      if (lines >= maxLines) return lines;
    } else line = test;
  }
  if (line) {
    ctx.fillText(line, x, y + lines * lineH);
    lines++;
  }
  return lines;
}

function background(ctx: CardDrawContext, w: number, h: number) {
  if (ctx.createLinearGradient) {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, BG);
    g.addColorStop(1, "#2a2a2a");
    ctx.fillStyle = g;
  } else ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
}

function circlePhoto(ctx: CardDrawContext, photo: CardPhoto, cx: number, cy: number, r: number) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  const s = Math.min(photo.width, photo.height);
  ctx.drawImage(photo, (photo.width - s) / 2, (photo.height - s) / 2, s, s, cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
}

function footer(ctx: ShareDrawContext, spec: ShareCardSpec, w: number, h: number, pad: number) {
  const footY = h - (spec.format === "story" ? 220 : 150);
  ctx.textAlign = "left";
  ctx.font = "400 30px system-ui, sans-serif";
  ctx.fillStyle = FAINT;
  wrapText(ctx, spec.disclaimer, pad, footY, w - pad * 2, 38, 2);
  ctx.font = "500 34px system-ui, sans-serif";
  ctx.fillStyle = FG;
  ctx.fillText(spec.url, pad, h - 90);
}

/** Kart başlığı (uygulama adı) ve isteğe bağlı daire fotoğraf; içeriğin başlayacağı y'yi döner. */
function header(ctx: CardDrawContext, spec: ShareCardSpec, w: number, pad: number, photo: CardPhoto | null): number {
  let y = spec.format === "story" ? 260 : 110;
  ctx.fillStyle = FG;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.font = "600 44px system-ui, -apple-system, sans-serif";
  ctx.fillText(spec.appName, pad, y);
  y += 90;
  if (photo && spec.withPhoto) {
    const r = spec.format === "story" ? 180 : 130;
    circlePhoto(ctx, photo, w - pad - r, y + r, r);
  }
  return y;
}

/**
 * Spec'ten çizim (saf: tuval yaratmaz). shareSpecIssues boş değilse ShareSpecError fırlatır — reklam kartına ya da berber
 * kartına fotoğraf hiçbir yoldan giremez. Fotoğraf yalnız spec.withPhoto && photo verildiyse çizilir.
 */
export function drawShareCard(ctx: CardDrawContext, spec: ShareCardSpec, w: number, h: number, photo: CardPhoto | null = null, labels: ShareCardLabels = DEFAULT_LABELS): void {
  const issues = shareSpecIssues(spec);
  if (issues.length) throw new ShareSpecError(issues);
  const pad = 80;
  background(ctx, w, h);
  let y = header(ctx, spec, w, pad, spec.kind === "barber" ? null : photo);

  if (spec.kind === "score") {
    ctx.font = "400 40px system-ui, sans-serif";
    ctx.fillStyle = MUTED;
    ctx.fillText(labels.overall, pad, y);
    y += 56;
    ctx.font = "700 220px system-ui, sans-serif";
    ctx.fillStyle = FG;
    ctx.fillText(fmt(spec.overall), pad, y);
    y += 250;
    if (spec.potential !== null) {
      ctx.font = "500 48px system-ui, sans-serif";
      ctx.fillStyle = "#e6e6e6";
      ctx.fillText(`${labels.potential} ${fmt(spec.potential)}  (+${fmt(Math.max(0, spec.potential - spec.overall))})`, pad, y);
      y += 110;
    }
    const barW = w - pad * 2;
    for (const s of spec.subs.slice(0, 3)) {
      ctx.font = "400 36px system-ui, sans-serif";
      ctx.fillStyle = MUTED;
      ctx.textAlign = "left";
      ctx.fillText(s.label, pad, y);
      ctx.textAlign = "right";
      ctx.fillStyle = FG;
      ctx.fillText(fmt(s.value), w - pad, y);
      ctx.textAlign = "left";
      y += 50;
      ctx.fillStyle = TRACK;
      roundRect(ctx, pad, y, barW, 16, 8);
      ctx.fillStyle = BAR;
      roundRect(ctx, pad, y, (barW * Math.min(10, s.value)) / 10, 16, 8);
      y += 60;
    }
  } else if (spec.kind === "strongest") {
    // SAYI YOK (S3.3.1): başlık + tek nötr cümle; süs olarak dolu bir vurgu şeridi.
    ctx.fillStyle = ACCENT;
    roundRect(ctx, pad, y, 120, 12, 6);
    y += 60;
    ctx.font = "700 88px system-ui, sans-serif";
    ctx.fillStyle = FG;
    const lines = wrapText(ctx, spec.title, pad, y, w - pad * 2 - (photo && spec.withPhoto ? 300 : 0), 104, 4);
    y += lines * 104 + 40;
    if (spec.line) {
      ctx.font = "400 44px system-ui, sans-serif";
      ctx.fillStyle = MUTED;
      wrapText(ctx, spec.line, pad, y, w - pad * 2, 60, 4);
    }
  } else {
    // Berber kartı (KB §8 R2-Ö2): stil adı büyük, ölçü satırları liste; görsel yok (S2.14 #27).
    ctx.font = "700 84px system-ui, sans-serif";
    ctx.fillStyle = FG;
    const lines = wrapText(ctx, spec.barber.styleName, pad, y, w - pad * 2, 98, 3);
    y += lines * 98 + 50;
    ctx.font = "400 46px system-ui, sans-serif";
    for (const l of spec.lines) {
      ctx.fillStyle = ACCENT;
      roundRect(ctx, pad, y + 18, 18, 18, 9);
      ctx.fillStyle = FG;
      const n = wrapText(ctx, l, pad + 48, y, w - pad * 2 - 48, 58, 3);
      y += n * 58 + 26;
    }
    if (spec.barber.notes) {
      y += 20;
      ctx.font = "400 36px system-ui, sans-serif";
      ctx.fillStyle = MUTED;
      wrapText(ctx, spec.barber.notes, pad, y, w - pad * 2, 48, 4);
    }
  }
  footer(ctx, spec, w, h, pad);
}

/** Eski girdi → skor kartı spec'i (kişisel paylaşım; fotoğraf bayrağı girdideki fotoğraftan). */
export function specFromLegacyInput(input: ShareCardInput): ScoreShareSpec {
  return {
    kind: "score",
    format: input.format,
    audience: "personal",
    appName: input.appName,
    url: input.url,
    disclaimer: input.disclaimer,
    withPhoto: Boolean(input.photo),
    overall: input.overall,
    potential: input.potential,
    // Eski girdide anahtar yok: sıra anahtarı yalnız tip doldurur (çizim etiketi kullanır).
    subs: input.subs.slice(0, 3).map((s, i) => ({ key: SUB_KEYS_V2[i] ?? SUB_KEYS_V2[0], label: s.label, value: s.value })),
  };
}

function isSpec(v: ShareCardSpec | ShareCardInput): v is ShareCardSpec {
  return "kind" in v;
}

/**
 * Kartı JPEG blob olarak üretir (OffscreenCanvas). spec geçersizse ShareSpecError. Hiçbir şey ağa çıkmaz.
 * Eski ShareCardInput çağrısı bir sürüm daha çalışır.
 */
export async function renderShareCard(spec: ShareCardSpec | ShareCardInput, photo: CardPhoto | null = null, labels: ShareCardLabels = DEFAULT_LABELS): Promise<Blob> {
  const s = isSpec(spec) ? spec : specFromLegacyInput(spec);
  const p = isSpec(spec) ? photo : (spec.photo ?? null);
  const { w, h } = CARD_SIZES[s.format];
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");
  drawShareCard(ctx, s, w, h, p, labels);
  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
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
