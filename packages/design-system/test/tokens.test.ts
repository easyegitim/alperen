import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error: .mjs betik, tür bildirimi yok
import { generate, ROOT } from '../scripts/tokens-to-css.mjs';
import { colorNames, themeValues } from '../tailwind.preset';

const tokens = JSON.parse(readFileSync(join(ROOT, 'tokens.json'), 'utf8'));

describe('tokens -> css', () => {
  const files = generate() as Record<string, string>;
  const css = readFileSync(join(ROOT, 'src/styles/tokens.css'), 'utf8');

  it('üretilen dosyalar diskteki dosyalarla bayt düzeyinde aynı (sapma yok)', () => {
    for (const [path, content] of Object.entries(files)) {
      expect(readFileSync(path, 'utf8')).toBe(content);
    }
  });

  it('her renk ve gölge token ı açık ve koyu temada tanımlı', () => {
    const light = css.split('[data-theme="dark"]')[0] ?? '';
    const dark = css.slice(css.indexOf('[data-theme="dark"]'));
    for (const t of [...tokens.color.tokens, ...tokens.shadow.tokens]) {
      expect(light, `açık tema ${t.name}`).toContain(`--og-${t.name}:`);
      expect(dark, `koyu tema ${t.name}`).toContain(`--og-${t.name}:`);
    }
  });

  it('takma ad (link) primary değişkenine bağlanır', () => {
    expect(css).toContain('--og-link: var(--og-primary);');
  });

  it('tip ölçeği yardımcı sınıfları ve fontlar var', () => {
    for (const s of ['display', 'title-1', 'title-2', 'title-3', 'body-lg', 'body', 'label', 'small', 'caption', 'code']) {
      expect(css).toContain(`.og-text-${s} {`);
    }
    expect(css).toContain('@font-face { font-family: "Lexend"');
    expect(css).toContain('prefers-color-scheme: dark');
  });

  it('preset ham değerleri tokens.json ile uyumlu ve takma ad çözülmüş', () => {
    expect(colorNames.length).toBe(tokens.color.tokens.length);
    expect(themeValues.light.primary).toBe('#0030a2');
    expect(themeValues.dark.primary).toBe('#7fb0ff');
    expect(themeValues.light.link).toBe(themeValues.light.primary);
  });

  it('Tailwind teması renkleri CSS değişkenine bağlar', () => {
    const theme = readFileSync(join(ROOT, 'src/styles/theme.css'), 'utf8');
    expect(theme).toContain('@theme inline');
    expect(theme).toContain('--color-primary: var(--og-primary);');
    expect(theme).toContain('--text-title-1--line-height: 40px;');
    expect(theme).toContain('--shadow-ai: var(--og-shadow-ai);');
  });
});
