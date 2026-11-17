/**
 * Gömülü yazı tipleri: Lexend/JetBrains Mono (packages/doc-render/fonts, design-system/fonts kopyası) ve KaTeX
 * (yalnız woff2). Hepsi base64 data: URI'dir; HTML kendi kendine yeter, PDF'te ağ ya da dosya erişimi gerekmez.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const FONT_DIR = new URL('../fonts/', import.meta.url);

const FACES = [
  ['Lexend', 400, 'Lexend-400.woff2'],
  ['Lexend', 500, 'Lexend-500.woff2'],
  ['Lexend', 600, 'Lexend-600.woff2'],
  ['Lexend', 700, 'Lexend-700.woff2'],
  ['JetBrains Mono', 400, 'JetBrainsMono-400.woff2'],
] as const;

let brandCache: string | undefined;
let katexCache: string | undefined;

export function brandFontCss(): string {
  brandCache ??= FACES.map(([family, weight, file]) => {
    const b64 = readFileSync(new URL(file, FONT_DIR)).toString('base64');
    return `@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${b64}) format("woff2");}`;
  }).join('\n');
  return brandCache;
}

/** katex.min.css, yazı tipi başvuruları gömülü woff2 ile değiştirilmiş hâlde. */
export function katexCss(): string {
  if (katexCache) return katexCache;
  const require = createRequire(import.meta.url);
  const cssPath = require.resolve('katex/dist/katex.min.css');
  const dir = cssPath.slice(0, cssPath.lastIndexOf('/'));
  const css = readFileSync(cssPath, 'utf8');
  katexCache = css.replace(/src:url\(fonts\/([A-Za-z0-9_-]+)\.woff2\) format\("woff2"\),[^;}]*/g, (_m, name: string) => {
    const b64 = readFileSync(`${dir}/fonts/${name}.woff2`).toString('base64');
    return `src:url(data:font/woff2;base64,${b64}) format("woff2")`;
  });
  return katexCache;
}
