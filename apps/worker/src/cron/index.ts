/** wrangler.toml [triggers] crons (UTC) → işler (§5.9). */
import type { Services } from '../services.ts';
import { log } from '../ops/log.ts';
import { runAlerts } from './alerts.ts';
import { runGroupAutoAnswer } from './group-auto-answer.ts';
import { runKeepalive } from './keepalive.ts';
import { runProactive } from './proactive.ts';
import { runRecordingNoticeRefresh } from './recording-notice.ts';
import { runRetentionJobs } from './retention.ts';
import { runSpend } from './spend.ts';
import { runStorageDeletions } from './storage.ts';

export const CRONS = {
  quarterHour: '*/15 * * * *',
  hourly: '5 * * * *',
  keepalive: '0 6 * * *',
  nightly: '0 3 * * *',
} as const;

async function step(name: string, fn: () => Promise<unknown>): Promise<void> {
  const t = Date.now();
  try {
    const r = await fn();
    log.info('cron_step', { step: name, result: typeof r === 'object' ? JSON.stringify(r) : r, ms: Date.now() - t });
  } catch (err) {
    log.error('cron_step_failed', { step: name, err: String(err) });
  }
}

export async function runCron(s: Services, cron: string): Promise<void> {
  switch (cron) {
    case CRONS.quarterHour:
      await step('proactive', () => runProactive(s));
      await step('group_auto_answer', () => runGroupAutoAnswer(s));
      return;
    case CRONS.hourly:
      await step('alerts', () => runAlerts(s));
      await step('spend', () => runSpend(s));
      await step('storage_deletions', () => runStorageDeletions(s));
      await step('recording_notice', () => runRecordingNoticeRefresh(s));
      return;
    case CRONS.keepalive:
      await step('keepalive', () => runKeepalive(s));
      return;
    case CRONS.nightly:
      await step('retention', () => runRetentionJobs(s));
      return;
    default:
      log.warn('cron_unknown', { cron });
  }
}
