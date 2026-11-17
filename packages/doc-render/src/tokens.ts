/**
 * Tasarım sistemi değişkenleri: `@ogrenmen/design-system/styles/tokens.css` içindeki açık tema bloğu okunur
 * (basılı belge: koyu tema yok). @font-face satırları atılır; fontlar `fonts.ts` ile gömülür.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

let cache: { css: string; vars: Record<string, string> } | undefined;

function load() {
  if (cache) return cache;
  const require = createRequire(import.meta.url);
  const src = readFileSync(require.resolve('@ogrenmen/design-system/styles/tokens.css'), 'utf8');
  const m = /:root,\s*\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/.exec(src);
  if (!m?.[1]) throw new Error('doc-render: tokens.css açık tema bloğu bulunamadı');
  const vars: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const d = /^\s*(--og-[a-z0-9-]+):\s*([^;]+);/.exec(line);
    if (d?.[1] && d[2]) vars[d[1]] = d[2].trim();
  }
  const css = `:root {\n${Object.entries(vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n')}\n}`;
  cache = { css, vars };
  return cache;
}

/** `:root { --og-…: …; }` (açık tema). */
export const tokenCss = (): string => load().css;

/** Bir tasarım değişkeninin değeri (ör. `token('--og-primary')` -> "#0030a2"). */
export function token(name: string): string {
  const v = load().vars[name];
  if (v === undefined) throw new Error(`doc-render: bilinmeyen tasarım değişkeni ${name}`);
  return v;
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})/i.exec(hex);
  if (!m?.[1]) throw new Error(`doc-render: altılı renk bekleniyordu: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (c: number) => Math.round(c).toString(16).padStart(2, '0');

/** İki renk arasında doğrusal sRGB karışımı (t=0 a, t=1 b). */
export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const k = Math.min(1, Math.max(0, t));
  return `#${toHex(ar + (br - ar) * k)}${toHex(ag + (bg - ag) * k)}${toHex(ab + (bb - ab) * k)}`;
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Zemin üstünde daha okunur olan yazı rengi (mürekkep ya da beyaz). */
export function readableOn(bg: string): string {
  const ink = token('--og-ink');
  const white = token('--og-on-primary');
  return contrastRatio(bg, ink) >= contrastRatio(bg, white) ? ink : white;
}
