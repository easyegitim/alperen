import { describe, expect, it } from 'vitest';
import { alertSince, band, clock, dateTime, hours, initialLabel, percent, sinceText, usd } from '../lib/format';

describe('format (egitmen-paneli.md "Sayılar ve zaman")', () => {
  it('percent and hours use Turkish form', () => {
    expect(percent(0.72)).toBe('%72');
    expect(percent(0.40732)).toBe('%41');
    expect(hours(1.4)).toBe('1,4 saat');
    expect(hours(2)).toBe('2 saat');
  });
  it('usd keeps small review costs readable', () => {
    expect(usd(0.002)).toBe('0,002 $');
    expect(usd(0.41)).toBe('0,41 $');
    expect(usd(0.000238)).toBe('0,0002 $');
    expect(usd(12.5)).toBe('12,50 $');
    expect(usd(0)).toBe('0 $');
  });
  it('absolute time is Istanbul time "19 Eki 14:32"', () => {
    expect(dateTime('2026-10-19T11:32:00Z')).toBe('19 Eki 14:32');
    expect(dateTime('2026-12-31T22:05:00Z')).toBe('1 Oca 01:05');
  });
  it('relative durations: "14 saattir cevapsız", "3 gündür sessiz"', () => {
    const now = '2026-10-20T09:00:00Z';
    expect(sinceText('2026-10-19T19:00:00Z', now)).toBe('14 saattir');
    expect(alertSince('unanswered', '2026-10-19T19:00:00Z', now)).toBe('14 saattir cevapsız');
    expect(alertSince('silent', '2026-10-17T09:00:00Z', now)).toBe('3 gündür sessiz');
    expect(sinceText('2026-10-20T08:35:00Z', now)).toBe('25 dakikadır');
  });
  it('clock and bands', () => {
    expect(clock(6)).toBe('00:06');
    expect(clock(3723)).toBe('1:02:03');
    expect(band(0.39)).toBe('düşük');
    expect(band(0.4)).toBe('orta');
    expect(band(0.7)).toBe('yüksek');
  });
  it('initialLabel mirrors person_labels(): first token + initial of last token', () => {
    expect(initialLabel('Elif Kaya', 's_x')).toBe('Elif K.');
    expect(initialLabel('Zeynep Nur Çelik', 's_x')).toBe('Zeynep Ç.');
    expect(initialLabel('Elif', 's_x')).toBe('Elif E.');
    expect(initialLabel(null, 's_qk7m2rx4tn5a')).toBe('s_qk7m2rx4tn5a');
  });
});
