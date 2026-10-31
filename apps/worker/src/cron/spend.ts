/** Saatlik: harcama eşikleri ve durum geçişleri (kurucuya DM); süresi dolmuş cooldown'ların temizliği. */
import type { Services } from '../services.ts';
import { spendAlerts } from '../ops/alerts.ts';

export async function runSpend(s: Services): Promise<string[]> {
  s.spend.invalidate();
  const state = await s.spend.state(s.db, 'chat');
  const lesson = await s.db.checkSpend('lesson_analysis');
  const res = await spendAlerts(s, { ...state, lesson_month_usd: lesson.lesson_month_usd, lesson_cap: lesson.lesson_cap });
  const now = s.now().getTime();
  for (const h of await s.db.providerHealth()) {
    if (h.cooldown_until !== null && Date.parse(h.cooldown_until) <= now) await s.db.updateProviderHealth(h.provider, { cooldown_until: null, consecutive_errors: 0 });
  }
  return res.sent;
}
