import { describe, expect, it } from 'vitest';
import { documentBlockRegen, examBlockRegen } from '../src/index.js';

describe('yeniden üretim daraltılmış şemaları', () => {
  it('not: yalnız blocks ve keys; blok kimliği ve türü document-ast ile aynı biçimde', () => {
    const heading = { type: 'heading', id: 'b1', section_no: 1, level: 2, text: 'Rasyonel sayılar' };
    expect(documentBlockRegen.isValid({ blocks: [heading], keys: [] })).toBe(true);
    expect(documentBlockRegen.isValid({ blocks: [heading], keys: [], kind: 'notes' })).toBe(false);
    expect(documentBlockRegen.isValid({ blocks: [], keys: [] })).toBe(false);
  });

  it('deneme: yalnız items ve keys; boş soru listesi reddedilir', () => {
    expect(examBlockRegen.isValid({ items: [], keys: [] })).toBe(false);
    expect(examBlockRegen.isValid({ items: [], keys: [], title: 'Deneme' })).toBe(false);
  });
});
