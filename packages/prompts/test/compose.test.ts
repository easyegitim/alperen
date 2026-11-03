import { describe, expect, it } from 'vitest';
import { PROMPT_SOURCES } from '../src/bundle.gen.js';
import {
  allPrompts,
  estimateTokens,
  listPromptRoutes,
  loadPrompt,
  MIN_CACHEABLE_TOKENS,
  promptRegistry,
  PromptError,
  PromptRegistry,
  sha256,
} from '../src/index.js';

const ROUTE = (fm: string, body = '# Görev\nrota gövdesi') => `---\n${fm}\n---\n${body}\n`;
const FM = (extra: Partial<Record<string, string>> = {}) => {
  const base: Record<string, string> = {
    route: 'demo',
    version: 'v1',
    model: 'claude-haiku-5-5',
    effort: 'low',
    schema: 'null',
    tools: '[]',
    role: 'analyst',
    layers: '[product.v1, roles/analyst.v1]',
    ...extra,
  };
  return Object.entries(base)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
};
const LAYERS = { 'layers/product.v1.md': '# Ürün\nürün metni\n', 'layers/roles/analyst.v1.md': '\n# Rol\nrol metni\n\n' };

describe('katman birleştirme', () => {
  it('ürün + rol + rota sırasıyla, tek boş satırla birleşir', () => {
    const reg = new PromptRegistry({ ...LAYERS, 'demo/v1.md': ROUTE(FM()) });
    const p = reg.load('demo');
    expect(p.text).toBe('# Ürün\nürün metni\n\n# Rol\nrol metni\n\n# Görev\nrota gövdesi');
    expect(p.parts).toEqual([
      { kind: 'layer', key: 'layers/product.v1.md' },
      { kind: 'layer', key: 'layers/roles/analyst.v1.md' },
      { kind: 'route', key: 'demo/v1.md' },
    ]);
    expect(p.hash).toBe(sha256(p.text));
    expect(p.estimatedTokens).toBe(estimateTokens(p.text));
  });

  it('extends hedef gövdeyi bu gövdenin önüne ekler; tek düzeyli ve aynı rollü olmalı', () => {
    const reg = new PromptRegistry({
      ...LAYERS,
      'demo/v1.md': ROUTE(FM(), 'temel gövde'),
      'derin/v1.md': ROUTE(FM({ route: 'derin', extends: 'demo/v1' }), 'ek gövde'),
    });
    expect(reg.load('derin').text.endsWith('temel gövde\n\nek gövde')).toBe(true);
    expect(reg.load('derin').parts.map((p) => p.kind)).toEqual(['layer', 'layer', 'extends', 'route']);
    const chained = new PromptRegistry({
      ...LAYERS,
      'demo/v1.md': ROUTE(FM()),
      'derin/v1.md': ROUTE(FM({ route: 'derin', extends: 'demo/v1' })),
      'enderin/v1.md': ROUTE(FM({ route: 'enderin', extends: 'derin/v1' })),
    });
    expect(() => chained.load('enderin')).toThrow(/tek düzeylidir/);
    const missing = new PromptRegistry({ ...LAYERS, 'derin/v1.md': ROUTE(FM({ route: 'derin', extends: 'demo/v1' })) });
    expect(() => missing.load('derin')).toThrow(/extends hedefi yok/);
  });

  it('meta denetimleri: dizin/dosya adı, katman sırası, rol katmanı, şema adı, araç sırası', () => {
    const bad = (key: string, fm: string) => () => new PromptRegistry({ ...LAYERS, [key]: ROUTE(fm) });
    expect(bad('baska/v1.md', FM())).toThrow(/dizin adıyla/);
    expect(bad('demo/v2.md', FM())).toThrow(/dosya adıyla/);
    expect(bad('demo/v1.md', FM({ layers: '[roles/analyst.v1, product.v1]' }))).toThrow(/ilk katman/);
    expect(bad('demo/v1.md', FM({ layers: '[product.v1, roles/coach.v1]' }))).toThrow(/rolün katmanı/);
    expect(bad('demo/v1.md', FM({ schema: 'olmayan-sema' }))).toThrow(/kayıt defterinde olmayan şema/);
    expect(bad('demo/v1.md', FM({ tools: '[b, a]' }))).toThrow(/sıralı/);
    expect(bad('demo/v1.md', FM({ model: 'claude-3-opus' }))).toThrow(PromptError);
    expect(bad('demo/v1.md', `${FM()}\nbilinmeyen: x`)).toThrow(PromptError);
    expect(() => new PromptRegistry({ ...LAYERS, 'demo/v1.md': ROUTE(FM(), '') })).toThrow(/gövde boş/);
    expect(() => new PromptRegistry({ 'demo/v1.md': ROUTE(FM()) }).load('demo')).toThrow(/katman yok/);
    expect(() => new PromptRegistry({ 'tuhaf.md': 'x' })).toThrow(/tanınmayan kaynak yolu/);
  });

  it('deterministiktir: aynı kaynaklardan iki kayıt defteri bayt bayt aynı metni üretir', () => {
    const a = new PromptRegistry(PROMPT_SOURCES).all();
    const b = new PromptRegistry({ ...PROMPT_SOURCES }).all();
    expect(a.map((p) => [p.meta.route, p.hash])).toEqual(b.map((p) => [p.meta.route, p.hash]));
    expect(loadPrompt('solution_diagnosis').text).toBe(loadPrompt('solution_diagnosis').text);
    // Değişken bilgi (tarih) sistem metnine girmez.
    for (const p of a) expect(p.text).not.toMatch(/20\d\d-\d\d-\d\d/);
  });

  it('her rota promptu önbellek eşiğini (512 token) aşar; ürün ve rol katmanı ilk iki parçadır', () => {
    for (const p of allPrompts()) {
      expect(p.estimatedTokens, `${p.meta.route}@${p.meta.version}`).toBeGreaterThanOrEqual(MIN_CACHEABLE_TOKENS);
      expect(p.text.startsWith(promptRegistry().layer('product.v1'))).toBe(true);
      expect(p.parts[1]?.key).toBe(`layers/roles/${p.meta.role}.v1.md`);
    }
  });

  it('rota listesi', () => {
    expect(listPromptRoutes()).toEqual([
      'coach_chat',
      'coach_deep',
      'conversation_summary',
      'curriculum_draft',
      'curriculum_research',
      'memory_delta',
      'parent_chat',
      'solution_diagnosis',
      'suggestions_copy',
    ]);
  });
});
