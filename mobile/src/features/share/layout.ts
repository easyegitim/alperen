// Paylaşım kartı düzeni (SPEC F10 v1 + KB §8 / CONTRACTS_V2 S3.3.1 v2 spec): skor · "En güçlü yanın" (sayı yok) · berber
// (fotoğraf yok). Saf; birim testli. Çizim Skia ile (renderCard.ts). Kart cihazda üretilir; sunucuya gitmez.
import type { ShareCardSpec } from "@/lib/share/spec";

export type ShareCardFormat = "story" | "square";
export const CARD_SIZES: Record<ShareCardFormat, { w: number; h: number }> = { story: { w: 1080, h: 1920 }, square: { w: 1080, h: 1080 } };

export type ShareCardInput = { overall: number; potential: number; subs: { label: string; value: number }[]; appName: string; url: string; disclaimer: string; format: ShareCardFormat; hasPhoto: boolean };

export type TextItem = { text: string; x: number; y: number; size: number; weight: "regular" | "bold"; align: "left" | "center"; color: string };
export type BarItem = { x: number; y: number; w: number; h: number; ratio: number; label: string };
export type Layout = { w: number; h: number; photo: { x: number; y: number; w: number; h: number } | null; texts: TextItem[]; bars: BarItem[] };

export const fmt1 = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function shareCardLayout(input: ShareCardInput): Layout {
  const { w, h } = CARD_SIZES[input.format];
  const cx = w / 2;
  const photoH = input.hasPhoto ? Math.round(h * (input.format === "story" ? 0.42 : 0.38)) : 0;
  const photo = input.hasPhoto ? { x: Math.round(w * 0.15), y: 120, w: Math.round(w * 0.7), h: photoH } : null;
  let y = input.hasPhoto ? 120 + photoH + 90 : Math.round(h * 0.2);
  const texts: TextItem[] = [{ text: input.appName, x: cx, y: 80, size: 40, weight: "bold", align: "center", color: "#a3a3a3" }];
  texts.push({ text: fmt1(input.overall), x: cx, y, size: 200, weight: "bold", align: "center", color: "#ffffff" });
  y += 70;
  texts.push({ text: `Potansiyel ${fmt1(input.potential)}`, x: cx, y, size: 56, weight: "regular", align: "center", color: "#d4d4d4" });
  y += 110;
  const bars: BarItem[] = [];
  const barW = Math.round(w * 0.7);
  for (const s of input.subs.slice(0, 3)) {
    texts.push({ text: `${s.label}  ${fmt1(s.value)}`, x: cx - barW / 2, y, size: 36, weight: "regular", align: "left", color: "#e5e5e5" });
    bars.push({ x: cx - barW / 2, y: y + 18, w: barW, h: 16, ratio: Math.max(0, Math.min(1, s.value / 10)), label: s.label });
    y += 90;
  }
  texts.push({ text: input.url, x: cx, y: h - 140, size: 34, weight: "regular", align: "center", color: "#a3a3a3" });
  texts.push({ text: input.disclaimer, x: cx, y: h - 80, size: 26, weight: "regular", align: "center", color: "#737373" });
  return { w, h, photo, texts, bars };
}

/** Uzun metni satırlara böler (karakter sayısına göre; çizici ölçmez). */
export function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > maxChars) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * v2 spec düzeni: score → v1 düzeni (potansiyel kilitliyse satır yok); strongest → başlık + tek cümle, SAYI YOK;
 * barber → stil adı + satırlar, fotoğraf yok. Çağıran önce shareSpecIssues ile doğrular; burada ek kural yok.
 */
export function shareLayoutFromSpec(spec: ShareCardSpec, hasPhoto: boolean): Layout {
  const { w, h } = CARD_SIZES[spec.format];
  const cx = w / 2;
  if (spec.kind === "score") {
    const l = shareCardLayout({ overall: spec.overall, potential: spec.potential ?? 0, subs: spec.subs, appName: spec.appName, url: spec.url, disclaimer: spec.disclaimer, format: spec.format, hasPhoto });
    if (spec.potential === null) l.texts = l.texts.filter((t) => !t.text.startsWith("Potansiyel "));
    return l;
  }
  const photoH = hasPhoto && spec.kind === "strongest" ? Math.round(h * (spec.format === "story" ? 0.42 : 0.38)) : 0;
  const photo = photoH ? { x: Math.round(w * 0.15), y: 120, w: Math.round(w * 0.7), h: photoH } : null;
  let y = photo ? 120 + photoH + 110 : Math.round(h * 0.3);
  const texts: TextItem[] = [{ text: spec.appName, x: cx, y: 80, size: 40, weight: "bold", align: "center", color: "#a3a3a3" }];
  if (spec.kind === "strongest") {
    for (const line of wrapText(spec.title, 22)) {
      texts.push({ text: line, x: cx, y, size: 84, weight: "bold", align: "center", color: "#ffffff" });
      y += 100;
    }
    y += 30;
    for (const line of wrapText(spec.line, 34)) {
      texts.push({ text: line, x: cx, y, size: 44, weight: "regular", align: "center", color: "#d4d4d4" });
      y += 58;
    }
  } else {
    texts.push({ text: spec.barber.styleName, x: cx, y, size: 84, weight: "bold", align: "center", color: "#ffffff" });
    y += 130;
    for (const line of spec.lines) {
      for (const part of wrapText(line, 30)) {
        texts.push({ text: part, x: cx, y, size: 52, weight: "regular", align: "center", color: "#e5e5e5" });
        y += 72;
      }
    }
  }
  texts.push({ text: spec.url, x: cx, y: h - 140, size: 34, weight: "regular", align: "center", color: "#a3a3a3" });
  texts.push({ text: spec.disclaimer, x: cx, y: h - 80, size: 26, weight: "regular", align: "center", color: "#737373" });
  return { w, h, photo, texts, bars: [] };
}
