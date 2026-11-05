import { describe, expect, it } from 'vitest';
import { parseFrontMatter, PromptError } from '../src/index.js';

describe('front-matter ayrıştırma', () => {
  it('düz değer, null, satır içi ve blok liste, yorum', () => {
    const src = [
      '---',
      '# yorum',
      'route: coach_chat',
      'version: "v1"',
      "description: 'Koç: sohbet'",
      'schema: null',
      'other: ~',
      'tools: [b_tool, "a tool"]',
      'empty: []',
      'layers:',
      '  - product.v1',
      '  - roles/coach.v1',
      '---',
      '',
      '# Gövde',
      'metin',
      '',
    ].join('\n');
    const { data, body } = parseFrontMatter(src);
    expect(data).toEqual({
      route: 'coach_chat',
      version: 'v1',
      description: 'Koç: sohbet',
      schema: null,
      other: null,
      tools: ['b_tool', 'a tool'],
      empty: [],
      layers: ['product.v1', 'roles/coach.v1'],
    });
    expect(body).toBe('# Gövde\nmetin');
  });

  it('CRLF satır sonlarını LF sayar', () => {
    const { data, body } = parseFrontMatter('---\r\nroute: x\r\n---\r\nbir\r\niki\r\n');
    expect(data.route).toBe('x');
    expect(body).toBe('bir\niki');
  });

  it.each([
    ['açılış yok', 'route: x\n---\nmetin'],
    ['kapanış yok', '---\nroute: x\nmetin'],
    ['yinelenen anahtar', '---\nroute: x\nroute: y\n---\nmetin'],
    ['kapanmamış tırnak', '---\nroute: "x\n---\nmetin'],
    ['anahtarsız liste öğesi', '---\n  - a\n---\nmetin'],
    ['bozuk satır', '---\nbu bir satır\n---\nmetin'],
    ['kapanmamış liste', '---\ntools: [a, b\n---\nmetin'],
    ['boş liste öğesi', '---\ntools: [a, , b]\n---\nmetin'],
    ['kapanış satırında ek', '---\nroute: x\n---ek\nmetin'],
  ])('reddeder: %s', (_name, src) => {
    expect(() => parseFrontMatter(src)).toThrow(PromptError);
    try {
      parseFrontMatter(src);
    } catch (err) {
      expect((err as PromptError).code).toBe('OGR-PRM-001');
    }
  });
});
