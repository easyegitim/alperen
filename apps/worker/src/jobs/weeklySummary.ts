import { z } from 'zod';
import { evaluateNotifications, type EvaluateResult } from '../notifications/engine.js';
import { loadChildSummary, refreshParentSummary } from '../notifications/summary.js';
import type { JobContext, JobDefinition } from './types.js';

const payload = z.object({
  /** Eski yük (yok sayılır; hafta alıcının saat diliminden hesaplanır). */
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** memory.compact bekletmesinin kaçıncı denemesi. */
  attempt: z.number().int().min(0).max(20).optional(),
});

/** memory.compact sürüyorsa beklenecek süre (sn) ve en çok deneme. */
export const WAIT_FOR_COMPACT_SEC = 15 * 60;
export const WAIT_FOR_COMPACT_MAX = 8;

export type WeeklySummaryResult =
  | { deferred: true; attempt: number }
  | ({ deferred: false; students: number; summaries: number } & Pick<EvaluateResult, 'emitted' | 'skipped' | 'failed' | 'copy'>);

/** Bugünün gece sıkıştırması (memory.compact) hâlâ kuyrukta ya da çalışıyor mu (pg-boss şeması okunamazsa false). */
async function compactPending(ctx: JobContext): Promise<boolean> {
  const schema = ctx.config.bossSchema;
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) return false;
  try {
    const r = await ctx.db.query(
      `select 1 from ${schema}.job where name = 'memory.compact' and state in ('created', 'retry', 'active') and created_on > now() - interval '20 hours' limit 1`,
    );
    return r.rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Pazar 19:00 (Europe/Istanbul; pg_cron ya da worker zamanlaması) haftalık özet:
 *   1. bu gecenin memory.compact'i bitmediyse 15 dk sonra yeniden (en çok 8 kez): parent_summary.md sıkıştırmadan sonra
 *   2. velisi olan her aktif öğrencinin `/memories/parent_summary.md`'si (parent_child_summary verisinden, deterministik)
 *   3. weekly_summary kuralı: zamanı gelen veliler (varsayılan Pazar 19:00; alıcı kendi gün/saatini seçtiyse saatlik
 *      notifications.evaluate yakalar) → notification_copy (Haiku) metni → emit_notification → push.send / email.send.
 */
export const weeklySummaryJob: JobDefinition<z.infer<typeof payload>, WeeklySummaryResult> = {
  name: 'weekly.summary',
  description: 'Haftalık özet: parent_summary.md + weekly_summary bildirimi (notification_copy).',
  process: 'worker',
  payload,
  concurrency: 1,
  retry: { retryLimit: 2, retryDelay: 120, retryBackoff: true, retryDelayMax: 1800, expireInSeconds: 3600, deleteAfterSeconds: 604_800 },
  handler: async (p, ctx) => {
    const attempt = p.attempt ?? 0;
    if (attempt < WAIT_FOR_COMPACT_MAX && (await compactPending(ctx))) {
      await ctx.enqueue('weekly.summary', { attempt: attempt + 1 }, { startAfter: WAIT_FOR_COMPACT_SEC, singletonKey: 'weekly.summary:wait', singletonSeconds: 600 });
      ctx.log.info('weekly.summary memory.compact bitince yeniden', { attempt: attempt + 1 });
      return { deferred: true, attempt: attempt + 1 };
    }
    const students = await ctx.db.query(
      `select distinct gl.student_id from public.guardian_links gl join public.students s on s.id = gl.student_id and s.status = 'active'
        where gl.status = 'active' and gl.parent_id is not null order by gl.student_id`,
    );
    let summaries = 0;
    for (const row of students.rows) {
      const sid = String(row.student_id);
      try {
        if (await refreshParentSummary(ctx.db, sid, await loadChildSummary(ctx.db, sid))) summaries++;
      } catch (err) {
        ctx.log.warn('parent_summary.md yazılamadı', { error: (err as Error).message });
      }
    }
    const res = await evaluateNotifications(ctx, { kinds: ['weekly_summary'] });
    ctx.log.info('weekly.summary', { students: students.rows.length, summaries, emitted: res.emitted, skipped: res.skipped, failed: res.failed });
    return { deferred: false, students: students.rows.length, summaries: summaries + res.summaries, emitted: res.emitted, skipped: res.skipped, failed: res.failed, copy: res.copy };
  },
};
