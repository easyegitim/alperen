import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkSpend, pgSpendQuery, rpcSpendQuery, type SpendQuery } from '../src/spendGate.js';

afterEach(() => vi.restoreAllMocks());

const rowQuery = (row: Record<string, unknown> | null): SpendQuery => async () => (row ? [row] : []);

describe('harcama kapısı (checkSpend)', () => {
  it('izinli: paid_allowed = true, downgrade yok', async () => {
    expect(await checkSpend(rowQuery({ paid_allowed: true, downgrade: false, state: 'normal' }), 'coach_chat', 's_1')).toEqual({ allowed: true, downgrade: false, state: 'normal' });
  });

  it('yumuşak tavan: downgrade = true taşınır', async () => {
    expect(await checkSpend(rowQuery({ paid_allowed: true, downgrade: true, state: 'soft_cap' }), 'coach_chat')).toEqual({ allowed: true, downgrade: true, state: 'soft_cap' });
  });

  it('sorgu fırlatırsa kapalı başarısız + tek OGR günlüğü', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await checkSpend(async () => { throw new Error('bağlantı yok'); }, 'report.generate');
    expect(r).toEqual({ allowed: false, downgrade: false, state: 'unknown' });
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0]?.[0])).toMatch(/^OGR-LLM-011/);
  });

  it('satır dönmezse kapalı başarısız', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await checkSpend(rowQuery(null), 'memory.compact')).toEqual({ allowed: false, downgrade: false, state: 'unknown' });
  });

  it('pg ve RPC uyarlayıcıları amaç ve öğrenci kodunu geçirir', async () => {
    const calls: unknown[] = [];
    const pg = pgSpendQuery({ query: async (text, values) => (calls.push([text, values]), { rows: [{ paid_allowed: true, downgrade: false, state: 'normal' }] }) });
    expect((await checkSpend(pg, 'diagnosis.run', 's_2')).allowed).toBe(true);
    expect(calls[0]).toEqual([expect.stringMatching(/check_spend\(\$1, \$2\)/), ['diagnosis.run', 's_2']]);
    const rpc = rpcSpendQuery({ rpc: async (fn, args) => (calls.push([fn, args]), { data: [{ paid_allowed: false, downgrade: false, state: 'disabled' }], error: null }) });
    expect(await checkSpend(rpc, 'parent_chat')).toEqual({ allowed: false, downgrade: false, state: 'disabled' });
    expect(calls[1]).toEqual(['check_spend', { p_purpose: 'parent_chat', p_student_ref: null }]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = rpcSpendQuery({ rpc: async () => ({ data: null, error: { message: 'izin yok' } }) });
    expect((await checkSpend(bad, 'coach_chat')).state).toBe('unknown');
  });
});
