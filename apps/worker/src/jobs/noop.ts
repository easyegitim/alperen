import { z } from 'zod';
import type { JobDefinition } from './types.js';

const payload = z.object({
  /** Olduğu gibi geri döner (uçtan uca denemeler). */
  echo: z.unknown().optional(),
  /** Bekleme (ms, en çok 10 sn): eşzamanlılık ve kapanış denemeleri. */
  sleepMs: z.number().int().min(0).max(10_000).optional(),
  /** true ise iş hata verir (yeniden deneme politikasını denemek için). */
  fail: z.boolean().optional(),
});

export const noopJob: JobDefinition<z.infer<typeof payload>, { ok: true; echo: unknown; jobId: string }> = {
  name: 'noop',
  description: 'Hiçbir şey yapmaz; kuyruk, işçi ve sağlık denemeleri için.',
  process: 'worker',
  payload,
  concurrency: 4,
  retry: { retryLimit: 0, retryDelay: 0, retryBackoff: false, expireInSeconds: 60, deleteAfterSeconds: 3600 },
  handler: async (p, ctx) => {
    if (p.sleepMs) await new Promise((r) => setTimeout(r, p.sleepMs));
    if (p.fail) throw new Error('noop: istenen hata');
    return { ok: true, echo: p.echo ?? null, jobId: ctx.job.id };
  },
};
