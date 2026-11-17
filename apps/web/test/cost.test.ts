import { describe, expect, it } from 'vitest';
import { capState, formatUsd, parseCostOverview } from '../src/lib/cost';

describe('capState', () => {
  it('tavana göre normal / yakın / aşıldı', () => {
    expect(capState(1, 10)).toBe('normal');
    expect(capState(8, 10)).toBe('near');
    expect(capState(10, 10)).toBe('over');
    expect(capState(12.5, 10)).toBe('over');
  });
  it('tavan yoksa normal', () => {
    expect(capState(100, 0)).toBe('normal');
  });
});

describe('formatUsd', () => {
  it('Türkçe ondalık virgül ve $', () => {
    expect(formatUsd(1.234)).toBe('1,23 $');
    expect(formatUsd(0)).toBe('0,00 $');
    expect(formatUsd(1234.5)).toBe('1.234,50 $');
    expect(formatUsd(0.0042)).toBe('0,0042 $');
  });
});

describe('parseCostOverview', () => {
  it('sayısal metinleri ve eksik alanları tolere eder', () => {
    const o = parseCostOverview({ today_usd: '0.5', month_usd: 2, by_student: [{ student_ref: 's_x', cost_usd: '1.2', over_cap: true }] });
    expect(o.todayUsd).toBe(0.5);
    expect(o.byStudent[0]).toMatchObject({ studentRef: 's_x', costUsd: 1.2, overCap: true, name: null });
    expect(o.byRoute).toEqual([]);
  });
  it('nesne değilse hata', () => {
    expect(() => parseCostOverview(null)).toThrow();
  });
});
