// tokens.json → app/tokens.css (BLUEPRINT §7 "Stil"). Deterministiktir: aynı tokens.json → bayt düzeyinde aynı CSS.
// Açık tema :root ve [data-theme="light"]; koyu tema [data-theme="dark"]. Fontlar /ds/fonts/ altından (sync-ds kopyalar).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PANEL_DIR = join(here, '..');
export const TOKENS_PATH = join(PANEL_DIR, '..', '..', 'packages', 'design-system', 'tokens.json');
export const CSS_PATH = join(PANEL_DIR, 'app', 'tokens.css');

function ref(value) {
  // '{primary}' → var(--primary)
  const m = /^\{([a-z0-9-]+)\}$/.exec(String(value));
  return m ? `var(--${m[1]})` : String(value);
}

function themeValue(token, theme) {
  const v = token.value;
  return typeof v === 'object' && v !== null ? ref(v[theme]) : ref(v);
}

export function render(tokens) {
  const out = [];
  out.push('/* Bu dosya scripts/tokens-to-css.mjs tarafından packages/design-system/tokens.json dosyasından üretilir; elle düzenlenmez. */');
  for (const f of tokens.type.fonts) {
    const file = f.file.replace(/^fonts\//, '');
    out.push(`@font-face { font-family: "${f.family}"; src: url("/ds/fonts/${file}") format("woff2"); font-weight: ${f.weight}; font-style: normal; font-display: swap; }`);
  }
  const themed = [...tokens.color.tokens, ...tokens.shadow.tokens];
  const flat = [...tokens.spacing.tokens, ...tokens.radius.tokens];
  const block = (selector, theme) => {
    const lines = [`${selector} {`];
    if (theme === 'light') {
      lines.push(`  --font-sans: ${tokens.type.families.sans};`);
      lines.push(`  --font-mono: ${tokens.type.families.mono};`);
      for (const t of flat) lines.push(`  --${t.name}: ${t.value};`);
      for (const g of tokens.type.groups) {
        for (const s of g.styles) {
          lines.push(`  --type-${s.name}-size: ${s.fontSize};`);
          lines.push(`  --type-${s.name}-line: ${s.lineHeight};`);
          lines.push(`  --type-${s.name}-weight: ${s.fontWeight};`);
        }
      }
    }
    for (const t of themed) lines.push(`  --${t.name}: ${themeValue(t, theme)};`);
    lines.push(`  color-scheme: ${theme};`);
    lines.push('}');
    return lines.join('\n');
  };
  out.push(block(':root, [data-theme="light"]', 'light'));
  out.push(block('[data-theme="dark"]', 'dark'));
  for (const g of tokens.type.groups) {
    for (const s of g.styles) {
      const family = g.family === 'mono' ? 'var(--font-mono)' : 'var(--font-sans)';
      const ls = s.letterSpacing ? ` letter-spacing: ${s.letterSpacing};` : '';
      out.push(`.t-${s.name} { font-family: ${family}; font-size: ${s.fontSize}; line-height: ${s.lineHeight}; font-weight: ${s.fontWeight};${ls} }`);
    }
  }
  return out.join('\n') + '\n';
}

export function generate() {
  const tokens = JSON.parse(readFileSync(TOKENS_PATH, 'utf8'));
  return render(tokens);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(CSS_PATH, generate());
  console.log('tokens-to-css: app/tokens.css yazıldı.');
}
