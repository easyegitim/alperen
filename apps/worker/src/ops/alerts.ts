/**
 * Maliyet uyarıları (§5.6, §8.4): gün/ay toplamı (ders amaçları HARİÇ) eşiklerden (%50, %80, %100)
 * birini ilk kez geçince kurucuya Telegram DM + `instructor_alerts(kind='ops')`; `runtime_flags.alerts_sent`
 * ile günde bir kez. `free_only`/`degraded` geçişleri her zaman DM. Ders bütçesi %80/%100'de ayrı DM.
 */
import type { SpendState } from '../data/repo.ts';
import type { Services } from '../services.ts';
import { formatPercent, formatUsd } from '../telegram/format.ts';
import { MONTHS_TR, texts } from '../texts.ts';
import { istanbulDay } from '../util.ts';
import { isPaidProvider } from '../llm/cost.ts';
import { bestEffort } from './log.ts';

export interface SpendAlertResult {
  sent: string[];
}

function freeShare(rows: Array<{ provider: string; calls: number }>): number {
  const total = rows.reduce((a, r) => a + r.calls, 0);
  if (total === 0) return 0;
  const free = rows.filter((r) => isPaidProvider(r.provider) === false).reduce((a, r) => a + r.calls, 0);
  return free / total;
}

export async function spendAlerts(s: Services, spend: SpendState): Promise<SpendAlertResult> {
  const flags = await s.db.runtimeFlags();
  const sentMap = { ...((flags.alerts_sent as Record<string, unknown> | undefined) ?? {}) };
  const thresholds = Array.isArray(flags.alert_thresholds) ? (flags.alert_thresholds as number[]) : [0.5, 0.8, 1.0];
  const now = s.now();
  const day = istanbulDay(now);
  const month = day.slice(0, 7);
  const excluded = new Set(Array.isArray(flags.cap_excluded_purposes) ? (flags.cap_excluded_purposes as string[]) : []);
  const ledger = (await s.db.spendLedger(`${month}-01`)).filter((r) => excluded.has(r.purpose) === false);
  const sent: string[] = [];
  const monthName = MONTHS_TR[Number(month.slice(5, 7)) - 1] ?? month;
  const dmBody = texts.ops.spend(monthName, formatUsd(spend.month_usd), formatUsd(spend.monthly_cap), formatPercent(spend.monthly_cap > 0 ? spend.month_usd / spend.monthly_cap : 0), formatUsd(spend.day_usd), formatPercent(freeShare(ledger)));
  for (const t of [...thresholds].sort((a, b) => b - a)) {
    const dKey = `day:${day}:${t}`;
    const mKey = `month:${month}:${t}`;
    const dayHit = spend.daily_cap > 0 && spend.day_usd / spend.daily_cap >= t && sentMap[dKey] === undefined;
    const monthHit = spend.monthly_cap > 0 && spend.month_usd / spend.monthly_cap >= t && sentMap[mKey] === undefined;
    if (dayHit || monthHit) {
      for (const lower of thresholds.filter((x) => x <= t)) {
        if (dayHit) sentMap[`day:${day}:${lower}`] = now.toISOString();
        if (monthHit) sentMap[`month:${month}:${lower}`] = now.toISOString();
      }
      await s.notifyAdmin(dmBody);
      await bestEffort('ops_alert_failed', s.db.openOpsAlert({ detail: dmBody, severity: t >= 1 ? 'danger' : 'warning', ref: {} }));
      sent.push(dayHit ? dKey : mKey);
      break;
    }
  }
  const lessonRatio = spend.lesson_cap > 0 ? spend.lesson_month_usd / spend.lesson_cap : 0;
  for (const t of [1.0, 0.8]) {
    const key = `lesson:${month}:${t}`;
    if (lessonRatio >= t && sentMap[key] === undefined) {
      sentMap[key] = now.toISOString();
      if (t === 1.0) sentMap[`lesson:${month}:0.8`] = sentMap[`lesson:${month}:0.8`] ?? now.toISOString();
      await s.notifyAdmin(texts.ops.lessonSpend(formatUsd(spend.lesson_month_usd), formatUsd(spend.lesson_cap)));
      sent.push(key);
      break;
    }
  }
  if (sentMap.state !== spend.state) {
    if (spend.state !== 'normal' || (sentMap.state !== undefined && sentMap.state !== 'normal')) {
      await s.notifyAdmin(texts.ops.spendState(spend.state));
      sent.push(`state:${spend.state}`);
    }
    sentMap.state = spend.state;
  }
  if (sent.length > 0 || JSON.stringify(sentMap) !== JSON.stringify(flags.alerts_sent ?? {})) {
    await s.db.setRuntimeFlag('alerts_sent', sentMap);
    s.invalidateFlags();
  }
  return { sent };
}
