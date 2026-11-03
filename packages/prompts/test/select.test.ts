import { describe, expect, it } from 'vitest';
import { compareVersions, highestVersion, loadPrompt, PromptError, selectVersion } from '../src/index.js';

describe('sürüm seçimi', () => {
  const avail = ['v1', 'v2', 'v10', 'v9'];

  it('varsayılan en yüksek sürümdür (sayısal karşılaştırma: v10 > v9)', () => {
    expect(highestVersion(avail)).toBe('v10');
    expect([...avail].sort(compareVersions)).toEqual(['v1', 'v2', 'v9', 'v10']);
    expect(selectVersion('r', avail)).toEqual({ version: 'v10', source: 'default', ignored: [] });
  });

  it('öncelik: açık > runtime_flags sabitlemesi > prompt_versions etkin > en yüksek', () => {
    const sources = { pinned: { r: 'v2' }, active: { r: 'v9' } };
    expect(selectVersion('r', avail, { version: 'v1', sources }).source).toBe('explicit');
    expect(selectVersion('r', avail, { sources })).toEqual({ version: 'v2', source: 'pinned', ignored: [] });
    expect(selectVersion('r', avail, { sources: { active: { r: 'v9' } } })).toEqual({ version: 'v9', source: 'active', ignored: [] });
    expect(selectVersion('r', avail, { sources: { pinned: { baska: 'v1' } } }).source).toBe('default');
  });

  it('veritabanının istediği sürüm derlemede yoksa sıradaki kaynağa geçer ve kaydeder', () => {
    const sel = selectVersion('r', avail, { sources: { pinned: { r: 'v7' }, active: { r: 'v8' } } });
    expect(sel).toEqual({
      version: 'v10',
      source: 'default',
      ignored: [
        { source: 'pinned', version: 'v7' },
        { source: 'active', version: 'v8' },
      ],
    });
    expect(selectVersion('r', avail, { sources: { pinned: { r: 'v7' }, active: { r: 'v2' } } }).version).toBe('v2');
  });

  it('açık istenen sürüm yoksa düşer (programcı hatası)', () => {
    expect(() => selectVersion('r', avail, { version: 'v3' })).toThrow(PromptError);
    expect(() => selectVersion('r', [])).toThrow(PromptError);
  });

  it('loadPrompt seçim bilgisini döndürür', () => {
    const p = loadPrompt('coach_chat', { sources: { pinned: { coach_chat: 'v99' } } });
    expect(p.meta.version).toBe('v1');
    expect(p.selection.source).toBe('default');
    expect(p.selection.ignored).toEqual([{ source: 'pinned', version: 'v99' }]);
    expect(loadPrompt('coach_chat', { sources: { active: { coach_chat: 'v1' } } }).selection.source).toBe('active');
    expect(() => loadPrompt('coach_chat', { version: 'v99' })).toThrow(/istenen sürüm v99 yok/);
    expect(() => loadPrompt('yok_boyle_rota')).toThrow(/bilinmeyen prompt rotası/);
  });
});

describe('rota varsayılanı (aktivasyon kapısı)', () => {
  it('kilitte varsayılan varsa yeni sürüm eklenince varsayılan v1 kalır', () => {
    expect(selectVersion('r', ['v1', 'v2'], { defaults: { r: 'v1' } })).toEqual({ version: 'v1', source: 'default', ignored: [] });
    expect(selectVersion('r', ['v1', 'v2'], { defaults: { r: 'v1' }, sources: { pinned: { r: 'v2' } } }).version).toBe('v2');
  });

  it('kilitteki varsayılan pakette yoksa ya da hiç yoksa en yüksek sürüm', () => {
    expect(selectVersion('r', ['v1', 'v2'], { defaults: { r: 'v9' } }).version).toBe('v2');
    expect(selectVersion('r', ['v1', 'v2'], { defaults: { baska: 'v1' } }).version).toBe('v2');
  });
});
