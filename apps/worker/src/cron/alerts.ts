/** Saatlik: `cron_open_alerts` (cevapsız, sessiz, teslim, moral, yanıt süresi, ops) + `cron_idle_sessions`. */
import type { Services } from '../services.ts';

export async function runAlerts(s: Services): Promise<{ alerts: number; idle: number }> {
  const alerts = await s.db.cronOpenAlerts();
  const idle = await s.db.cronIdleSessions();
  return { alerts, idle };
}
