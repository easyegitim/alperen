import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { formatClock, formatDelta, formatDurationWords, formatNumber, formatPercent } from '../src/lib/format';
import { MathText, renderMath, renderMathML, splitMath, Tex } from '../src/math';

describe('biçimler', () => {
  it('yüzde Türkçe ve sınırlı', () => {
    expect(formatPercent(0.724)).toBe('%72');
    expect(formatPercent(1.4)).toBe('%100');
    expect(formatPercent(-1)).toBe('%0');
  });
  it('değişim işaretle yazılır', () => {
    expect(formatDelta(0.08)).toBe('+%8');
    expect(formatDelta(-0.03)).toBe('−%3');
    expect(formatDelta(0)).toBe('%0');
  });
  it('sayı Türkçe ondalık ve binlik', () => {
    expect(formatNumber(1.4)).toBe('1,4');
    expect(formatNumber(1284, 0)).toBe('1.284');
  });
  it('süre', () => {
    expect(formatClock(252)).toBe('04:12');
    expect(formatClock(3725)).toBe('1:02:05');
    expect(formatClock(-4)).toBe('00:00');
    expect(formatDurationWords(45)).toBe('45 sn');
    expect(formatDurationWords(720)).toBe('12 dk');
    expect(formatDurationWords(3900)).toBe('1 sa 5 dk');
  });
});

describe('KaTeX yardımcıları', () => {
  it('htmlAndMathml çıktısı MathML içerir', () => {
    const html = renderMath('\\frac{3}{4}');
    expect(html).toContain('<math');
    expect(html).toContain('katex-html');
  });
  it('yalnızca MathML', () => {
    const ml = renderMathML('x^2');
    expect(ml).toContain('<math');
    expect(ml).not.toContain('katex-html');
  });
  it('hatalı TeX fırlatmaz', () => {
    expect(() => renderMath('\\frac{')).not.toThrow();
  });
  it('trust kapalı: \\href güvenilmez', () => {
    expect(renderMath('\\href{javascript:alert(1)}{x}')).not.toContain('href="');
  });
  it('splitMath sınırlayıcıları ayırır', () => {
    expect(splitMath('a $x$ b $$y$$ c')).toEqual([
      { type: 'text', value: 'a ' },
      { type: 'math', value: 'x', display: false },
      { type: 'text', value: ' b ' },
      { type: 'math', value: 'y', display: true },
      { type: 'text', value: ' c' },
    ]);
    expect(splitMath('Fiyat 5\\$ ve 6\\$')).toEqual([{ type: 'text', value: 'Fiyat 5$ ve 6$' }]);
  });
  it('MathText ve Tex DOM üretir', () => {
    const { container } = render(
      <p>
        <MathText>{'Önce $\\frac{3}{4}$ yaz'}</MathText>
        <Tex tex="x^2" display />
      </p>,
    );
    expect(container.querySelectorAll('.katex').length).toBe(2);
    expect(container.querySelector('.og-math-display')).not.toBeNull();
    expect(container.querySelector('math')).not.toBeNull();
  });
});
