import { describe, expect, it } from 'vitest';
import { actionKeyboard, b64ToUuid, decodeAnswer, encodeAnswer, KeyboardError, MAX_CALLBACK_BYTES, optionKeyboard, uuidToB64 } from '../../src/telegram/keyboard.ts';

const S = '5c661df7-8220-5b58-a114-d78ef1c4630e';
const Q = '1ef8248b-394b-52cb-acb2-ec045c1ea3d4';

describe('keyboard', () => {
  it('≤ 3 düğme tek satır, etiket ≤ 20 karakter', () => {
    const kb = actionKeyboard([
      { text: 'Metni oku', data: 'a' },
      { text: 'Onaylıyorum', data: 'b' },
      { text: 'Şimdi değil', data: 'c' },
    ]);
    expect(kb.inline_keyboard.length).toBe(1);
    expect(kb.inline_keyboard[0]?.length).toBe(3);
    expect(() => actionKeyboard([1, 2, 3, 4].map((i) => ({ text: `Seç ${i}`, data: String(i) })))).toThrow(KeyboardError);
    expect(() => actionKeyboard([{ text: 'Bu etiket yirmi karakterden uzun', data: 'x' }])).toThrow(/OGR-KB-001/);
    expect(() => actionKeyboard([])).toThrow(/OGR-KB-003/);
  });

  it('A·B·C·D şık klavyesi; callback_data ≤ 64 bayt, UUID gidiş-dönüş', () => {
    const kb = optionKeyboard((k) => encodeAnswer(S, Q, k));
    expect(kb.inline_keyboard[0]?.map((b) => b.text)).toEqual(['A', 'B', 'C', 'D']);
    for (const b of kb.inline_keyboard[0] ?? []) expect(new TextEncoder().encode(b.callback_data ?? '').length).toBeLessThanOrEqual(MAX_CALLBACK_BYTES);
    expect(decodeAnswer(encodeAnswer(S, Q, 'C'))).toEqual({ session: S, question: Q, key: 'C' });
    expect(b64ToUuid(uuidToB64(Q))).toBe(Q);
    expect(decodeAnswer('ans:bozuk')).toBeNull();
    expect(decodeAnswer(`ans:${uuidToB64(S)}:${uuidToB64(Q)}:E`)).toBeNull();
  });
});
