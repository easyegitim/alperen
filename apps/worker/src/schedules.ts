/**
 * Zamanlayıcı: pg-boss schedule (cron, Europe/Istanbul). Yalnız `worker`/`all` süreci kurar.
 * pg_cron sahibi ise (`runtime_flags.cron_owner = "pg_cron"`, supabase/migrations/0016) `auto` kipinde kurulmaz.
 */
import type { PgBoss } from 'pg-boss';
import type { ScheduleMode } from './config.js';
import type { Db } from './db.js';

export const TIMEZONE = 'Europe/Istanbul';

export interface ScheduleDef {
  /** Kuyruk / iş adı (registry'de olmalı). */
  job: string;
  cron: string;
  description: string;
  data?: object;
}

export const SCHEDULES: readonly ScheduleDef[] = [
  { job: 'memory.compact', cron: '0 3 * * *', description: 'Her gece 03:00 hafıza sıkıştırma' },
  { job: 'weekly.summary', cron: '0 19 * * 0', description: 'Pazar 19:00 haftalık özet' },
];

/** `runtime_flags.cron_owner`: tablo yoksa ya da satır yoksa null. */
export async function readCronOwner(db: Db): Promise<string | null> {
  try {
    const r = await db.query("select value #>> '{}' as owner from public.runtime_flags where key = 'cron_owner'");
    const v = r.rows[0]?.owner;
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

export interface SchedulePlan {
  install: boolean;
  reason: string;
}

export async function planSchedules(mode: ScheduleMode, db: Db): Promise<SchedulePlan> {
  if (mode === 'off') return { install: false, reason: 'WORKER_SCHEDULES=off' };
  if (mode === 'on') return { install: true, reason: 'WORKER_SCHEDULES=on' };
  const owner = await readCronOwner(db);
  if (owner === 'pg_cron') return { install: false, reason: 'cron_owner=pg_cron' };
  return { install: true, reason: `cron_owner=${owner ?? 'belirsiz'}` };
}

/** Zamanlamaları kurar (idempotent: aynı ad+anahtar güncellenir). Kuyruklar önceden açık olmalıdır. */
export async function installSchedules(boss: PgBoss, defs: readonly ScheduleDef[] = SCHEDULES): Promise<string[]> {
  const installed: string[] = [];
  for (const d of defs) {
    await boss.schedule(d.job, d.cron, d.data ?? {}, { tz: TIMEZONE });
    installed.push(`${d.job} @ ${d.cron} ${TIMEZONE}`);
  }
  return installed;
}

/** Zamanlama kurulmadığında önceki çalıştırmalardan kalan kayıtları siler (pg_cron'a geçişte çift çalışmayı önler). */
export async function removeSchedules(boss: PgBoss, defs: readonly ScheduleDef[] = SCHEDULES): Promise<string[]> {
  const removed: string[] = [];
  for (const d of defs) {
    await boss.unschedule(d.job);
    removed.push(d.job);
  }
  return removed;
}

/**
 * Gece zinciri: pg_cron (ya da bu süreç) yalnız 03:00 memory.compact'ı zamanlar; iş gece çalışmasında zinciri kurar
 * (supabase/migrations/0016_cron.sql ve 01_schema.sql zamanlama eşliği değişmeden kalır):
 *   03:00  memory.compact          > 6 KB hafıza dosyaları Batch ile ≤ 4 KB
 *   03:00  conversation.summarize  30 mesajı aşan sohbetlerin eski kısmı Haiku ile özetlenir
 *   03:30  suggestions.refresh     etkin kaydı olan her öğrenci için Bugün kartları
 */
export const NIGHTLY_CHAIN = [
  { job: 'memory.compact', at: '03:00' },
  { job: 'conversation.summarize', at: '03:00' },
  { job: 'suggestions.refresh', at: '03:30' },
] as const;

/** Europe/Istanbul (UTC+3, yaz saati yok) saatine göre bir sonraki hh:mm anı; geçtiyse hemen (şimdi). */
export function nextIstanbulTime(now: Date, hour: number, minute: number): Date {
  const local = new Date(now.getTime() + 3 * 3600 * 1000);
  const target = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour, minute) - 3 * 3600 * 1000;
  return target > now.getTime() ? new Date(target) : now;
}
