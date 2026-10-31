import { describe, expect, it } from 'vitest';
import { escapeMarkdownV2, formatDecimal, formatPercent, formatUsd, lineCount, plainText, splitLines, toMarkdownV2, truncate } from '../../src/telegram/format.ts';
import { unescapeV2 } from '../fakes/telegram.ts';

describe('format', () => {
  it('MarkdownV2 kaçışları: özel karakterlerin hepsi', () => {
    expect(escapeMarkdownV2('3/4 + 1/8 = 7/8. (a-b)!')).toBe('3/4 \\+ 1/8 \\= 7/8\\. \\(a\\-b\\)\\!');
    expect(escapeMarkdownV2('_*[]()~`>#+-=|{}.!\\')).toBe('\\_\\*\\[\\]\\(\\)\\~\\`\\>\\#\\+\\-\\=\\|\\{\\}\\.\\!\\\\');
  });

  it('**kalın** ve `kod` korunur, gerisi kaçışlanır', () => {
    expect(toMarkdownV2('**Sonuç:** `3/4 + 1/8 = 7/8`.')).toBe('*Sonuç:* `3/4 + 1/8 = 7/8`\\.');
    expect(unescapeV2(toMarkdownV2('**a.b** c-d `x_y`'))).toBe('a.b c-d x_y');
    expect(plainText('**a** `b` c')).toBe('a b c');
  });

  it('≤ 4 satır bölme', () => {
    const parts = splitLines('1\n2\n3\n4\n5\n6\n7\n8\n9', 4);
    expect(parts).toEqual(['1\n2\n3\n4', '5\n6\n7\n8', '9']);
    for (const p of parts) expect(lineCount(p)).toBeLessThanOrEqual(4);
    expect(splitLines('tek satır')).toEqual(['tek satır']);
  });

  it('Türkçe sayı biçimi: %62, 3,5 saat, 0,002 $', () => {
    expect(formatPercent(0.62)).toBe('%62');
    expect(formatDecimal(3.5)).toBe('3,5');
    expect(formatDecimal(3)).toBe('3');
    expect(formatUsd(0.002)).toBe('0,002 $');
    expect(formatUsd(12.4)).toBe('12,4 $');
    expect(formatUsd(24)).toBe('24 $');
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abc', 4)).toBe('abc');
  });
});
