/**
 * `notifications.evaluate` — kural motoru (docs/PLAN-v2.md §10). Saatlik zamanlama (schedules.ts) tüm kuralları ve
 * e-posta süpürmesini koşar; olaylar ({student_id, kinds}) yalnız o öğrencinin kurallarını değerlendirir. Ayrıntı:
 * src/notifications/engine.ts (hedefler, zamanlama, tekilleştirme), rules.ts (saf kurallar).
 */
import { z } from 'zod';
import { evaluateNotifications, RULE_KINDS, sweepEmails, type EvaluateResult } from '../notifications/engine.js';
import { uuid } from './schemas.js';
import type { JobDefinition } from './types.js';

const payload = z.object({
  kinds: z.array(z.enum(RULE_KINDS)).min(1).max(RULE_KINDS.length).optional(),
  student_id: uuid.optional(),
  reason: z.string().max(80).optional(),
});

export type NotificationsEvaluateResult = EvaluateResult & { swept: number };

export const notificationsEvaluateJob: JobDefinition<z.infer<typeof payload>, NotificationsEvaluateResult> = {
  name: 'notifications.evaluate',
  description: 'Bildirim kuralları: haftalık özet, sessizlik, ilerleme, çözülen yanılgı (+ e-posta süpürmesi).',
  process: 'worker',
  payload,
  concurrency: 1,
  retry: { retryLimit: 2, retryDelay: 60, retryBackoff: true, retryDelayMax: 600, expireInSeconds: 900, deleteAfterSeconds: 86_400, retentionSeconds: 6 * 3600 },
  handler: async (p, ctx) => {
    const res = await evaluateNotifications(ctx, { kinds: p.kinds ?? RULE_KINDS, studentId: p.student_id ?? null });
    const swept = p.student_id ? 0 : await sweepEmails(ctx);
    ctx.log.info('notifications.evaluate', { reason: p.reason ?? (p.student_id ? 'event' : 'schedule'), emitted: res.emitted, skipped: res.skipped, failed: res.failed, swept });
    return { ...res, swept };
  },
};
