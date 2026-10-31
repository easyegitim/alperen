/** Günlük 03:00 UTC: `runtime_flags.cron_owner='worker'` ise (pg_cron yoksa) saklama ve boyut işleri. */
import type { Services } from '../services.ts';

export async function runRetentionJobs(s: Services): Promise<boolean> {
  const flags = await s.db.runtimeFlags();
  if (flags.cron_owner !== 'worker') return false;
  await s.db.runRetention();
  await s.db.computeTableSizes();
  await s.db.recomputeIsMinor();
  return true;
}
