import { describe, expect, it } from 'vitest';
import { ciStatusFromMetrics, evaluatePilotGate, validatePilotGate } from '../lib/pilot-gate';
import { createMockDataSource } from '../lib/data/mock';
import type { PilotMetricRow } from '../lib/data';
import { readJson } from './helpers';

interface SharedGateCase {
  name: string;
  thresholds: unknown;
  metrics: Omit<PilotMetricRow, 'computed_at'>[];
  ci_status: Record<string, string>;
  expected?: { gate: 'AÇIK' | 'KAPALI'; verdicts: Record<string, string> };
  error?: string;
}

// M07 gate.py ile ortak vakalar (salt okunur): iki uygulama aynı girdide aynı kararı vermeli.
const SHARED = readJson<{ cases: SharedGateCase[] }>('pipelines/kulaklik_batch/tests/gate-cases.json').cases;

describe('pilot gate — ortak vakalar (pipelines/kulaklik_batch/tests/gate-cases.json)', () => {
  it('ortak vaka dosyası okunur ve hata vakaları içerir', () => {
    expect(SHARED.length).toBeGreaterThan(10);
    expect(SHARED.some((c) => c.error)).toBe(true);
  });

  it.each(SHARED.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const metrics = c.metrics.map((m) => ({ ...m, computed_at: m.period }));
    const res = evaluatePilotGate(c.thresholds, metrics, c.ci_status);
    if (c.error) {
      // geçersiz eşik: kapı asla AÇIK değil, hata görünür, PASS satırı yok
      expect(res.gate).toBe('KAPALI');
      expect(res.error).toContain(c.error);
      expect(validatePilotGate(c.thresholds)).toContain(c.error);
      expect(res.rows.filter((r) => r.verdict === 'PASS')).toEqual([]);
      return;
    }
    expect(res.error).toBeNull();
    expect(validatePilotGate(c.thresholds)).toBeNull();
    expect(res.gate).toBe(c.expected!.gate);
    const verdicts = Object.fromEntries(res.rows.map((r) => [r.metric, r.verdict]));
    for (const [metric, verdict] of Object.entries(c.expected!.verdicts)) expect(verdicts[metric], metric).toBe(verdict);
  });

  it('gate_stays_closed_on_malformed_or_empty_thresholds (regresyon)', () => {
    const period = '2026-10-19';
    const metrics: PilotMetricRow[] = [{ metric: 'degraded_share', period, value: 0.01, detail: { n: 40 }, computed_at: period }];
    // önceki sürüm bunların hepsinde AÇIK diyordu (tanınmayan anahtar / tırnaklı sayı / boş nesne → kontrol yok → PASS)
    for (const bad of [
      { degraded_share: { mx: 0.05 } },
      { degraded_share: { max: '0.05' } },
      { degraded_share: {} },
      { degraded_share: { required: true } },
      { degraded_share: { max: false } },
      { degraded_share: { max: 0.05, required: 'true' } },
      { degraded_share: { max: 0.05, n_min: -1 } },
      { degraded_share: null },
      { degraded_share: [0.05] },
      { isolation_tests: 'yes' },
      {},
      null,
      [],
    ]) {
      const res = evaluatePilotGate(bad, metrics, { isolation_tests: 'yes' });
      expect(res.gate, JSON.stringify(bad)).toBe('KAPALI');
      expect(res.error, JSON.stringify(bad)).toMatch(/^OGR-KLK-020 /);
    }
    // yalnız bilgi satırları: zorunlu ölçüt yok → boş küme kapıyı açmaz
    const info = evaluatePilotGate({ degraded_share: { max: 0.05, required: false } }, metrics);
    expect(info.rows[0]).toMatchObject({ verdict: 'PASS', required: false });
    expect(info.gate).toBe('KAPALI');
    expect(info.error).toBeNull();
    // geçerli eşik aynı veride açar (kontrol)
    expect(evaluatePilotGate({ degraded_share: { max: 0.05 } }, metrics).gate).toBe('AÇIK');
  });
});

interface PilotFixture {
  pilot_gate: Record<string, unknown>;
  pilot_metrics: PilotMetricRow[];
  expected: { metric: string; verdict: string; required: boolean; value: number | null }[];
  gate: string;
}

describe('pilot gate (ADR-0013; kulaklik metrics --gate ile aynı mantık)', () => {
  const fx = readJson<PilotFixture>('fixtures/panel/pilot.json');

  it('pilot_gate_matches_thresholds', () => {
    const res = evaluatePilotGate(fx.pilot_gate, fx.pilot_metrics);
    expect(res.rows.map(({ metric, verdict, required, value }) => ({ metric, verdict, required, value }))).toEqual(fx.expected);
    expect(res.gate).toBe('KAPALI');
    expect(fx.gate).toBe('KAPALI');
    expect(res.rows.find((r) => r.metric === 'question_accuracy')?.verdict).toBe('NO_DATA');
  });

  it('mock data source computes the same gate from dev-seed', async () => {
    const res = await createMockDataSource({ role: 'coordinator' }).pilotGate();
    expect(res.gate).toBe('KAPALI');
    expect(res.rows.map((r) => [r.metric, r.verdict])).toEqual(fx.expected.map((e) => [e.metric, e.verdict]));
  });

  it('opens only when every required metric passes; required:false rows never decide', () => {
    const period = '2026-10-19';
    const m = (metric: string, value: number | null, detail: Record<string, unknown> = {}): PilotMetricRow => ({ metric, period, value, detail, computed_at: period });
    const metrics = [
      m('question_accuracy', 0.95, { n: 40 }),
      m('diagnostic_agreement', 0.7, { n: 12 }),
      m('citation_relevance', null, { n_rated: 0 }),
      m('priority_uplift', -0.2),
      m('cost_per_student', 0.08),
      m('flagged_response_share', 0.02),
      m('degraded_share', 0.01),
    ];
    const ci = { isolation_tests: 'pass', key_leak_tests: 'pass' };
    const open = evaluatePilotGate(fx.pilot_gate, metrics, ci);
    expect(open.gate).toBe('AÇIK');
    expect(open.rows.find((r) => r.metric === 'priority_uplift')).toMatchObject({ verdict: 'FAIL', required: false });
    expect(open.rows.find((r) => r.metric === 'citation_relevance')).toMatchObject({ verdict: 'NO_DATA', required: false });
    // eşik tam sınırda geçer; bir zorunlu ölçüt n_min altında → NO_DATA → KAPALI
    expect(evaluatePilotGate(fx.pilot_gate, [...metrics.slice(1), m('question_accuracy', 0.9, { n: 30 })], ci).gate).toBe('AÇIK');
    expect(evaluatePilotGate(fx.pilot_gate, [...metrics.slice(1), m('question_accuracy', 0.99, { n: 29 })], ci).gate).toBe('KAPALI');
    expect(evaluatePilotGate(fx.pilot_gate, metrics, { isolation_tests: 'fail', key_leak_tests: 'pass' }).gate).toBe('KAPALI');
    // CI durumu veriden: pilot_metrics satırları (detail.status), ölçüt başına en son dönem
    const ciRows = [
      m('isolation_tests', null, { status: 'fail' }),
      { ...m('isolation_tests', null, { status: 'pass' }), period: '2026-10-26', computed_at: '2026-10-26' },
      { ...m('key_leak_tests', null, { status: 'pass' }), period: '2026-10-26', computed_at: '2026-10-26' },
    ];
    expect(ciStatusFromMetrics(ciRows)).toEqual({ isolation_tests: 'pass', key_leak_tests: 'pass' });
    const fromData = evaluatePilotGate(fx.pilot_gate, [...metrics, ...ciRows], ciStatusFromMetrics([...metrics, ...ciRows]));
    expect(fromData.gate).toBe('AÇIK');
    // CI satırlarının daha yeni dönemi sayısal ölçütlerin dönemini değiştirmez
    expect(fromData.period).toBe(period);
    expect(ciStatusFromMetrics(metrics)).toEqual({});
    expect(evaluatePilotGate(fx.pilot_gate, metrics, ciStatusFromMetrics(metrics)).rows.find((r) => r.metric === 'isolation_tests')?.verdict).toBe('NO_DATA');
    // eski dönem satırları yok sayılır
    const older = metrics.map((x) => ({ ...x, period: '2026-10-05', value: 0 }));
    expect(evaluatePilotGate(fx.pilot_gate, [...older, ...metrics], ci).gate).toBe('AÇIK');
  });
});
