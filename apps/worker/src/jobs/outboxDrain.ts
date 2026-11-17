/**
 * `outbox.drain`: secure.job_outbox'taki (0029) işleri pg-boss'a aktarır. Worker süreci her `OUTBOX_DRAIN_INTERVAL_MS`
 * (30 sn) bu işi `singletonSeconds` ile kuyruğa atar (birden çok kopya tek iş), açılışta bir kez de doğrudan çalıştırır.
 * Asıl mantık `src/outbox.ts` (`drainOutbox`); bağımlılığı app.ts `JobDeps.drainOutbox` olarak verir.
 */
import { z } from 'zod';
import type { OutboxDrainResult } from '../outbox.js';
import { PermanentJobError } from './errors.js';
import type { JobDefinition } from './types.js';

const payload = z.object({ reason: z.string().max(64).optional() }).passthrough();

export const outboxDrainJob: JobDefinition<z.infer<typeof payload>, OutboxDrainResult> = {
  name: 'outbox.drain',
  description: 'secure.job_outbox → pg-boss (enqueue_job yazamadığı işler kaybolmaz).',
  process: 'worker',
  payload,
  concurrency: 1,
  retry: { retryLimit: 0, retryDelay: 0, retryBackoff: false, expireInSeconds: 120, deleteAfterSeconds: 3600 },
  handler: async (_p, ctx) => {
    if (!ctx.drainOutbox) throw new PermanentJobError('outbox aktarımı bu süreçte kapalı (secure.job_outbox yok ya da yetkisiz)', 'OGR-JOB-150');
    return ctx.drainOutbox();
  },
};
