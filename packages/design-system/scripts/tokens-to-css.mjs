// tokens.json -> src/styles/tokens.css, src/styles/theme.css, tailwind.preset.ts
// Deterministiktir: aynı tokens.json -> bayt düzeyinde aynı çıktı.
//   node scripts/tokens-to-css.mjs           yazar
//   node scripts/tokens-to-css.mjs --check   dosyalar güncel değilse 1 ile çıkar (sapma denetimi)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, '..');
export const TOKENS_PATH = join(ROOT, 'tokens.json');
export const OUTPUTS = {
  tokens: join(ROOT, 'src', 'styles', 'tokens.css'),
  theme: join(ROOT, 'src', 'styles', 'theme.css'),
  preset: join(ROOT, 'tailwind.preset.ts'),
};

const HEADER = 'Bu dosya scripts/tokens-to-css.mjs tarafından tokens.json dosyasından üretilir; elle düzenlenmez.';

/** '{primary}' -> var(--og-primary); diğer değerler olduğu gibi. */
function ref(value) {
  const m = /^\{([a-z0-9-]+)\}$/.exec(String(value));
  return m ? `var(--og-${m[1]})` : String(value);
}

function themeValue(token, theme) {
  const v = token.value;
  return typeof v === 'object' && v !== null ? ref(v[theme]) : ref(v);
}

/** '{primary}' takma adını çözülmüş ham değere çevirir (preset sabitleri için). */
function resolved(tokens, token, theme) {
  const v = token.value;
  const raw = typeof v === 'object' && v !== null ? v[theme] : v;
  const m = /^\{([a-z0-9-]+)\}$/.exec(String(raw));
  if (!m) return String(raw);
  const target = tokens.color.tokens.find((t) => t.name === m[1]);
  if (!target) throw new Error(`Bilinmeyen takma ad: ${raw}`);
  return resolved(tokens, target, theme);
}

function allStyles(tokens) {
  return tokens.type.groups.flatMap((g) => g.styles.map((s) => ({ ...s, family: g.family })));
}

export function renderTokensCss(tokens) {
  const themed = [...tokens.color.tokens, ...tokens.shadow.tokens];
  const flat = [...tokens.spacing.tokens, ...tokens.radius.tokens];
  const out = [];
  out.push(`/* ${HEADER} */`);
  for (const f of tokens.type.fonts) {
    const file = f.file.replace(/^fonts\//, '');
    out.push(
      `@font-face { font-family: "${f.family}"; src: url("../../fonts/${file}") format("woff2"); font-weight: ${f.weight}; font-style: normal; font-display: swap; }`,
    );
  }
  const block = (selector, theme, withFlat) => {
    const lines = [`${selector} {`];
    if (withFlat) {
      lines.push(`  --og-font-sans: ${tokens.type.families.sans};`);
      lines.push(`  --og-font-mono: ${tokens.type.families.mono};`);
      for (const t of flat) lines.push(`  --og-${t.name}: ${t.value};`);
      for (const s of allStyles(tokens)) {
        lines.push(`  --og-type-${s.name}-size: ${s.fontSize};`);
        lines.push(`  --og-type-${s.name}-line: ${s.lineHeight};`);
        lines.push(`  --og-type-${s.name}-weight: ${s.fontWeight};`);
        if (s.letterSpacing) lines.push(`  --og-type-${s.name}-tracking: ${s.letterSpacing};`);
      }
    }
    for (const t of themed) lines.push(`  --og-${t.name}: ${themeValue(t, theme)};`);
    lines.push(`  color-scheme: ${theme};`);
    lines.push('}');
    return lines.join('\n');
  };
  out.push(block(':root,\n[data-theme="light"]', 'light', true));
  out.push(block('[data-theme="dark"]', 'dark', false));
  // Tema açıkça seçilmediyse işletim sistemi tercihi geçerli (koyu mod).
  const dark = block(':root:not([data-theme="light"]):not([data-theme="dark"])', 'dark', false)
    .split('\n')
    .map((l) => `  ${l}`)
    .join('\n');
  out.push(`@media (prefers-color-scheme: dark) {\n${dark}\n}`);
  for (const s of allStyles(tokens)) {
    const family = s.family === 'mono' ? 'var(--og-font-mono)' : 'var(--og-font-sans)';
    const ls = s.letterSpacing ? ` letter-spacing: ${s.letterSpacing};` : '';
    out.push(
      `.og-text-${s.name} { font-family: ${family}; font-size: ${s.fontSize}; line-height: ${s.lineHeight}; font-weight: ${s.fontWeight};${ls} }`,
    );
  }
  return out.join('\n') + '\n';
}

export function renderThemeCss(tokens) {
  const lines = [];
  lines.push(`/* ${HEADER} */`);
  lines.push('/* Tailwind 4 eşlemesi: renk, yazı tipi, köşe, gölge ve yazı ölçeği tokens.css değişkenlerine bağlanır.');
  lines.push('   Boşluk ölçeği ayrıca tanımlanmaz: Tailwind varsayılanı 4px tabanlıdır ve space-N = N birimdir');
  lines.push('   (space-2 = p-2, space-4 = p-4, space-6 = p-6, space-8 = p-8, space-12 = p-12).');
  lines.push('   Kullanım (uygulamanın ana CSS dosyasında):');
  lines.push('     @import "tailwindcss";');
  lines.push('     @import "@ogrenmen/design-system/styles/tokens.css";');
  lines.push('     @import "@ogrenmen/design-system/styles/theme.css";');
  lines.push('     @import "@ogrenmen/design-system/styles/base.css";');
  lines.push('     @source "<design-system>/src";   (bileşen sınıflarının taranması için) */');
  lines.push('@theme inline {');
  for (const t of tokens.color.tokens) lines.push(`  --color-${t.name}: var(--og-${t.name});`);
  lines.push('  --font-sans: var(--og-font-sans);');
  lines.push('  --font-mono: var(--og-font-mono);');
  for (const t of tokens.radius.tokens) lines.push(`  --radius-${t.name.replace(/^radius-/, '')}: var(--og-${t.name});`);
  for (const t of tokens.shadow.tokens) lines.push(`  --shadow-${t.name.replace(/^shadow-/, '')}: var(--og-${t.name});`);
  for (const s of allStyles(tokens)) {
    lines.push(`  --text-${s.name}: ${s.fontSize};`);
    lines.push(`  --text-${s.name}--line-height: ${s.lineHeight};`);
    lines.push(`  --text-${s.name}--font-weight: ${s.fontWeight};`);
    if (s.letterSpacing) lines.push(`  --text-${s.name}--letter-spacing: ${s.letterSpacing};`);
  }
  lines.push('}');
  return lines.join('\n') + '\n';
}

export function renderPreset(tokens) {
  const colorNames = tokens.color.tokens.map((t) => t.name);
  const light = Object.fromEntries(tokens.color.tokens.map((t) => [t.name, resolved(tokens, t, 'light')]));
  const dark = Object.fromEntries(tokens.color.tokens.map((t) => [t.name, resolved(tokens, t, 'dark')]));
  const j = (v) => JSON.stringify(v, null, 2);
  const lines = [];
  lines.push(`// ${HEADER}`);
  lines.push('// Tailwind yapılandırma nesnesi (v3 biçimi, @config ile) ve ham tema değerleri. Tailwind 4 için asıl eşleme src/styles/theme.css içindedir.');
  lines.push('');
  lines.push(`export const colorNames = ${j(colorNames)} as const;`);
  lines.push('');
  lines.push('export type ColorName = (typeof colorNames)[number];');
  lines.push('');
  lines.push('/** Çözülmüş ham renk değerleri (takma adlar açılmış). Grafik ve test kodu için. */');
  lines.push(`export const themeValues: { light: Record<ColorName, string>; dark: Record<ColorName, string> } = ${j({ light, dark })};`);
  lines.push('');
  lines.push('/** Renkler CSS değişkenine bağlıdır; tema [data-theme] ile değişir. */');
  lines.push('export const colors = Object.fromEntries(colorNames.map((n) => [n, `var(--og-${n})`])) as Record<ColorName, string>;');
  lines.push('');
  lines.push('export const fontFamily = {');
  lines.push("  sans: 'var(--og-font-sans)',");
  lines.push("  mono: 'var(--og-font-mono)',");
  lines.push('};');
  lines.push('');
  lines.push('export const borderRadius = {');
  for (const t of tokens.radius.tokens) lines.push(`  '${t.name.replace(/^radius-/, '')}': 'var(--og-${t.name})',`);
  lines.push('};');
  lines.push('');
  lines.push('export const boxShadow = {');
  for (const t of tokens.shadow.tokens) lines.push(`  '${t.name.replace(/^shadow-/, '')}': 'var(--og-${t.name})',`);
  lines.push('};');
  lines.push('');
  lines.push('/** space-N adları Tailwind varsayılan 4px ölçeğiyle örtüşür; adlandırılmış karşılıklar: */');
  lines.push('export const spacing = {');
  for (const t of tokens.spacing.tokens) lines.push(`  '${t.name}': '${t.value}',`);
  lines.push('};');
  lines.push('');
  lines.push('export const fontSize: Record<string, [string, { lineHeight: string; fontWeight: string; letterSpacing?: string }]> = {');
  for (const s of allStyles(tokens)) {
    const extra = s.letterSpacing ? `, letterSpacing: '${s.letterSpacing}'` : '';
    lines.push(`  '${s.name}': ['${s.fontSize}', { lineHeight: '${s.lineHeight}', fontWeight: '${s.fontWeight}'${extra} }],`);
  }
  lines.push('};');
  lines.push('');
  lines.push('export const theme = { colors, fontFamily, borderRadius, boxShadow, spacing, fontSize };');
  lines.push('');
  lines.push('const preset = { theme: { extend: theme } };');
  lines.push('export default preset;');
  return lines.join('\n') + '\n';
}

export function generate() {
  const tokens = JSON.parse(readFileSync(TOKENS_PATH, 'utf8'));
  return {
    [OUTPUTS.tokens]: renderTokensCss(tokens),
    [OUTPUTS.theme]: renderThemeCss(tokens),
    [OUTPUTS.preset]: renderPreset(tokens),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const files = generate();
  if (process.argv.includes('--check')) {
    const stale = Object.entries(files).filter(([p, c]) => !existsSync(p) || readFileSync(p, 'utf8') !== c);
    if (stale.length) {
      for (const [p] of stale) console.error(`tokens: güncel değil -> ${p.replace(ROOT + '/', '')} (node scripts/tokens-to-css.mjs çalıştır)`);
      process.exit(1);
    }
    console.log('tokens: üretilen dosyalar tokens.json ile eşleşiyor.');
  } else {
    for (const [p, c] of Object.entries(files)) writeFileSync(p, c);
    console.log('tokens: tokens.css, theme.css ve tailwind.preset.ts yazıldı.');
  }
}
