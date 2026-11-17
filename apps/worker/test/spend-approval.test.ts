/**
 * Harcama tavanı tek seferlik muafiyeti (0050, spend.ts `approvedGenerationBlock`): kayıtlı eğitmen onayı yalnız
 * downgrade (yumuşak tavan) durumunda, yalnız o istek için ve bir kez tüketilir; paid_allowed = false (kapatma anahtarı)
 * iken onaya bakılmaz; onaysız durdurma spend_cap_holds'a kaydedilir. Veritabanı, consume/record RPC'lerinin anlamını
 * taşıyan durumlu bir sahte yönlendiricidir.
 */
import { describe, expect, it } from 'vitest';
import type { SpendDecision } from '@ogrenmen/llm';
import { approvedGenerationBlock, SPEND_BLOCKED_REASON, SPEND_CAP_REASON } from '../src/jobs/spend.js';
import { silentLogger } from '../src/log.js';
import { routedDb } from './support.js';

const REQ = '55555555-5555-4555-8555-555555555555';
const OTHER = '66666666-6666-4666-8666-666666666666';
const DOWNGRADE: SpendDecision = { allowed: true, downgrade: true, state: 'soft_cap' };
const KILLED: SpendDecision = { allowed: false, downgrade: true, state: 'disabled' };
const NORMAL: SpendDecision = { allowed: true, downgrade: false, state: 'normal' };

/** spend_cap_holds'un sahte hâli: istek → {approved, consumed}. */
function holdsDb(approved: string[] = []) {
  const holds = new Map<string, { approved: boolean; consumed: boolean }>(approved.map((id) => [id, { approved: true, consumed: false }]));
  const db = routedDb([
    [
      /consume_spend_cap_approval/,
      (v) => {
        const h = holds.get(String(v?.[1]));
        if (v?.[0] !== 'document' || !h || !h.approved || h.consumed) return [{ ok: false }];
        h.consumed = true;
        return [{ ok: true }];
      },
    ],
    [
      /record_spend_cap_hold/,
      (v) => {
        const id = String(v?.[1]);
        const h = holds.get(id);
        if (!h || h.consumed) holds.set(id, { approved: false, consumed: false });
        return [{}];
      },
    ],
  ]);
  return { db, holds, ctx: { db, log: silentLogger } };
}

describe('approvedGenerationBlock', () => {
  it('onaylı istek downgrade altında bir kez çalışır, onay tüketilir (ikinci çalıştırma yine durur)', async () => {
    const { ctx, holds } = holdsDb([REQ]);
    expect(await approvedGenerationBlock(ctx, DOWNGRADE, { kind: 'document', requestId: REQ })).toBeNull();
    expect(holds.get(REQ)).toEqual({ approved: true, consumed: true });
    expect(await approvedGenerationBlock(ctx, DOWNGRADE, { kind: 'document', requestId: REQ })).toBe(SPEND_CAP_REASON);
    // tüketilmiş onaydan sonra durdurma yeniden açılır: yeni onay gerekir
    expect(holds.get(REQ)).toEqual({ approved: false, consumed: false });
  });

  it('onaysız istek durur ve durdurma kaydedilir', async () => {
    const { ctx, db, holds } = holdsDb();
    expect(await approvedGenerationBlock(ctx, DOWNGRADE, { kind: 'document', requestId: REQ })).toBe(SPEND_CAP_REASON);
    expect(holds.get(REQ)).toEqual({ approved: false, consumed: false });
    expect(db.calls.map((c) => c.text)).toEqual([expect.stringMatching(/consume_spend_cap_approval/), expect.stringMatching(/record_spend_cap_hold/)]);
  });

  it('onay yalnız kendi isteği için geçerlidir', async () => {
    const { ctx, holds } = holdsDb([OTHER]);
    expect(await approvedGenerationBlock(ctx, DOWNGRADE, { kind: 'document', requestId: REQ })).toBe(SPEND_CAP_REASON);
    expect(holds.get(OTHER)).toEqual({ approved: true, consumed: false });
  });

  it('paid_allowed = false (kapatma anahtarı) iken onay okunmaz ve tüketilmez', async () => {
    const { ctx, db, holds } = holdsDb([REQ]);
    expect(await approvedGenerationBlock(ctx, KILLED, { kind: 'document', requestId: REQ })).toBe(SPEND_BLOCKED_REASON);
    expect(db.calls).toHaveLength(0);
    expect(holds.get(REQ)).toEqual({ approved: true, consumed: false });
  });

  it('tavan yokken veritabanına gidilmez; istek kimliği yoksa muafiyet yok', async () => {
    const { ctx, db } = holdsDb([REQ]);
    expect(await approvedGenerationBlock(ctx, NORMAL, { kind: 'document', requestId: REQ })).toBeNull();
    expect(await approvedGenerationBlock(ctx, DOWNGRADE, { kind: 'document', requestId: null })).toBe(SPEND_CAP_REASON);
    expect(db.calls).toHaveLength(0);
  });
});
