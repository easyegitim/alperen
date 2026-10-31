/**
 * Günlük 06:00 UTC (§5.9): `ping()` RPC (Supabase 7 gün uykusuna karşı; GitHub keepalive.yml ikinci kemer)
 * + `/health` denetimi. Sağlık bozuksa (veritabanı yok, bot JWT'si 14 günden az, zincir boş) kurucuya DM.
 */
import type { Services } from '../services.ts';
import { checkHealth, healthProblems } from '../ops/health.ts';
import { texts } from '../texts.ts';

export async function runKeepalive(s: Services): Promise<{ ping: boolean; ok: boolean }> {
  const h = await checkHealth(s);
  if (h.ok === false) {
    const problems = healthProblems(h);
    if (problems.length > 0) await s.notifyAdmin(texts.ops.health(problems.join('; ')));
  }
  return { ping: h.db === 'ok', ok: h.ok };
}
