import { z } from 'zod';
import type { JobDefinition } from './types.js';

const payload = z.object({
  /** ISO tarih (Europe/Istanbul pazartesi); verilmezse geçen hafta. */
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/**
 * İSKELET (P6): pazar 19:00 haftalık özet. Gerçek mantık: veli/öğrenci başına `weekly-summary` şemalı rapor
 * (report rotası) → belge AST → pdf.render → notifications + push.send.
 */
export const weeklySummaryJob: JobDefinition<z.infer<typeof payload>, { skeleton: true; weekStart: string | null }> = {
  name: 'weekly.summary',
  description: 'Haftalık özet (iskelet).',
  process: 'worker',
  payload,
  concurrency: 1,
  retry: { retryLimit: 2, retryDelay: 120, retryBackoff: true, retryDelayMax: 1800, expireInSeconds: 3600, deleteAfterSeconds: 604_800 },
  skeleton: true,
  handler: async (p, ctx) => {
    ctx.log.info('weekly.summary iskelet', { weekStart: p.weekStart ?? null });
    return { skeleton: true, weekStart: p.weekStart ?? null };
  },
};
