import { describe, expect, it } from 'vitest';
import { RouteConfigError } from '../src/errors.js';
import {
  assertBreakpoints,
  buildSystemBlocks,
  buildTurnSystem,
  istanbulDate,
  renderTurnContext,
  sortTools,
  supportsSystemMessages,
} from '../src/prompt.js';
import { MODELS } from '../src/routes.js';

const POLICY = { productTtl: '1h', courseTtl: '1h', dossierTtl: '5m', tail: false } as const;

describe('istem blokları', () => {
  it('üç blok, doğru cache_control', () => {
    expect(buildSystemBlocks({ product: 'P', course: 'C', dossier: 'D' }, POLICY)).toEqual([
      { type: 'text', text: 'P', cache_control: { type: 'ephemeral', ttl: '1h' } },
      { type: 'text', text: 'C', cache_control: { type: 'ephemeral', ttl: '1h' } },
      { type: 'text', text: 'D', cache_control: { type: 'ephemeral' } },
    ]);
    expect(buildSystemBlocks({ product: 'P' }, { ...POLICY, productTtl: null })).toEqual([{ type: 'text', text: 'P' }]);
    expect(() => buildSystemBlocks({ product: ' ' }, POLICY)).toThrow(RouteConfigError);
  });

  it('tur sistem mesajı deterministik; Istanbul günü', () => {
    expect(buildTurnSystem({ date: '2026-11-02', mode: 'solve', exam: 'TYT 2027-06-20' })).toEqual({
      role: 'system',
      content: 'Bugün 2026-11-02. Mod: çözümü göster. Sınav: TYT 2027-06-20.',
    });
    // 2026-11-01 22:30 UTC = 2026-11-02 01:30 İstanbul
    expect(istanbulDate(new Date('2026-11-01T22:30:00Z'))).toBe('2026-11-02');
    expect(renderTurnContext({ now: new Date('2026-11-01T22:30:00Z') })).toBe('Bugün 2026-11-02.');
  });

  it('sistem mesajı: üç modelde role:"system" (Haiku 400 dönerse geçit yedeğe geçer)', () => {
    expect(supportsSystemMessages(MODELS.opus)).toBe(true);
    expect(supportsSystemMessages(MODELS.sonnet)).toBe(true);
    expect(supportsSystemMessages(MODELS.haiku)).toBe(true);
  });

  it('araçlar ada göre sıralanır (kararlı)', () => {
    expect(sortTools([{ name: 'b' }, { name: 'a' }, { name: 'c' }]).map((t) => t.name)).toEqual(['a', 'b', 'c']);
  });

  it('kesme noktası denetimi: >4 ve 5dk sonrası 1sa reddedilir', () => {
    const b = (ttls: ('1h' | '5m')[]) => ({
      system: ttls.map((t) => ({ type: 'text', text: 'x', cache_control: t === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' } })),
      messages: [],
    });
    expect(() => assertBreakpoints(b(['1h', '1h', '5m']))).not.toThrow();
    expect(() => assertBreakpoints(b(['1h', '5m', '1h']))).toThrow(/1 saatlik/);
    expect(() => assertBreakpoints(b(['1h', '1h', '5m', '5m', '5m']))).toThrow(/en çok 4/);
  });
});
