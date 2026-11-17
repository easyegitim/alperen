/**
 * Figür izin listesi tek kaynaktır: FIGURE_DESIGN.modules, yerel kum havuzunun (apps/worker/py/figure_render.py)
 * izin verdiği köklerin alt kümesidir; prompt metinleri sympy önermez; figureCodeIssues sandbox'ın yasakladığını
 * (sympy, savefig) da reddeder. Figür denetimi boş expected ile de bağlamı taşır.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FIGURE_DESIGN } from '../src/figure-style.js';
import { figureCheckUserText, loadPrompt } from '../src/index.js';
import { figureCodeIssues } from '../src/eval/score.js';

const SANDBOX = fileURLToPath(new URL('../../../apps/worker/py/figure_render.py', import.meta.url));

function sandboxRoots(): Set<string> {
  const src = readFileSync(SANDBOX, 'utf8');
  const m = /ALLOWED_MODULES = \{([\s\S]*?)\n\}/.exec(src);
  if (!m) throw new Error('ALLOWED_MODULES bulunamadı');
  return new Set([...m[1]!.matchAll(/"([\w.]+)"/g)].map((x) => x[1]!.split('.')[0]!));
}

describe('figür izin listesi tek kaynak', () => {
  it('FIGURE_DESIGN.modules, yerel kum havuzunun izin verdiği köklerin alt kümesi (sympy yok)', () => {
    const roots = sandboxRoots();
    for (const mod of FIGURE_DESIGN.modules) expect(roots.has(mod), mod).toBe(true);
    expect(FIGURE_DESIGN.modules).not.toContain('sympy');
  });

  it('notes ve deneme promptları sympy önermez; dosyayı yalnız save_figure yazar', () => {
    for (const route of ['notes_generation', 'exam_generation'] as const) {
      const text = loadPrompt(route).text;
      expect(text, route).not.toMatch(/numpy ve sympy/);
      expect(text, route).toContain('sympy kullanmaz');
      expect(text, route).toContain('kendi savefig çağrını yazmazsın');
    }
  });

  it('figureCodeIssues: sympy ve savefig reddedilir; izinli kod geçer', () => {
    const ok = 'fig, ax = plt.subplots()\nax.bar([1, 2], [3, 4])\nsave_figure(fig, 1)';
    expect(figureCodeIssues(ok, 'matplotlib', 1)).toEqual([]);
    expect(figureCodeIssues(`import sympy\n${ok}`, 'matplotlib', 1).join(';')).toMatch(/izinsiz modül: sympy/);
    expect(figureCodeIssues(ok.replace('save_figure(fig, 1)', 'fig.savefig("figure_1.svg")'), 'matplotlib', 1).join(';')).toMatch(/savefig/);
  });
});

describe('figür denetimi girdisi', () => {
  it('expected boşken bağlam ve alt metni yine taşınır', () => {
    const t = figureCheckUserText({ context: 'Grafikte Pazartesi 12 kişi var.', alt: 'Sütun grafiği: Pazartesi 12', expected: {} });
    expect(t).toContain('Pazartesi 12');
    expect(() => figureCheckUserText({ context: 'Grafikte 3 kişi var.', alt: 'Sütun grafiği: 3' })).not.toThrow();
  });
});
