/**
 * Kural motorunun saf yarısı (docs/PLAN-v2.md §10; SQL yarısı supabase 0042): hangi (veli, çocuk) çifti için hangi
 * bildirimin şimdi zamanı geldi. Zaman alıcının saat diliminde (`profiles.tz`, varsayılan Europe/Istanbul) hesaplanır.
 *
 *   weekly_summary  alıcının yerel gününde weekday (0 = Pazar) ve saat ≥ hour (19) ve bu hafta (pazartesi başlangıçlı)
 *                   henüz gönderilmedi. Saat geçmişse aynı gün içinde yetişir (işçi bir saat kapalı kalsa da kaçmaz).
 *   inactivity      son etkinlikten bu yana ≥ days (5) tam gün ve bu sessizlik için henüz gönderilmedi (son gönderim son
 *                   etkinlikten önceyse yeni sessizliktir). Hiç etkinliği olmayan çocuk için gönderilmez (ölçüt yok).
 *   improvement     (a) yaprak kazanım leaf_p (0,8) eşiğini min_evidence (5) kanıtla geçti (mastery_history geçişi,
 *                   güncel p hâlâ eşik üstünde); (b) son denemenin neti bir öncekine göre ≥ weekly_net_delta (4) arttı.
 *                   Aynı kazanım ya da aynı oturum için bir kez (tekilleştirme anahtarı + geçmiş).
 *   misconception_resolved  son 7 günde çözülen yanılgı (yanılgı başına bir kez).
 *
 * Gündüz penceresi (DAYTIME_FROM ≤ saat < DAYTIME_TO, alıcının saati): sessizlik ve saatlik ilerleme/yanılgı bildirimleri
 * gece gönderilmez; uygun saate kadar bekler (tekilleştirme anahtarları aynı kaldığı için bir kez gider).
 */

export interface Target {
  recipient_id: string;
  student_id: string;
  student_name: string;
  tz: string;
  params: Record<string, unknown>;
  last_activity_at: string | null;
  last_sent_at: string | null;
}

export interface LocalParts {
  /** 0 = Pazar … 6 = Cumartesi. */
  weekday: number;
  hour: number;
  /** Yerel gün (YYYY-MM-DD). */
  date: string;
  /** Yerel haftanın pazartesisi (YYYY-MM-DD). */
  weekStart: string;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function validTz(tz: string | null | undefined): string {
  if (!tz) return 'Europe/Istanbul';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'Europe/Istanbul';
  }
}

/** Anın alıcının saat dilimindeki parçaları. */
export function localParts(at: Date, tz: string): LocalParts {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: validTz(tz),
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(f.formatToParts(at).map((p) => [p.type, p.value]));
  const weekday = WEEKDAYS[parts.weekday ?? 'Sun'] ?? 0;
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { weekday, hour: Number(parts.hour) % 24, date, weekStart: addDays(date, -((weekday + 6) % 7)) };
}

/** Bildirim penceresi (alıcının yerel saati): 09:00 dahil, 21:00 hariç. */
export const DAYTIME_FROM = 9;
export const DAYTIME_TO = 21;

/** Şimdi alıcının gündüz penceresinde mi (gece push ve e-posta gönderilmez). */
export function inDaytime(now: Date, tz: string): boolean {
  const hour = localParts(now, tz).hour;
  return hour >= DAYTIME_FROM && hour < DAYTIME_TO;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function intParam(params: Record<string, unknown>, key: string, def: number, min: number, max: number): number {
  const v = Number(params[key]);
  return Number.isInteger(v) && v >= min && v <= max ? v : def;
}

function numParam(params: Record<string, unknown>, key: string, def: number): number {
  const v = Number(params[key]);
  return Number.isFinite(v) ? v : def;
}

/** Haftalık özetin zamanı geldi mi; geldiyse haftanın pazartesisi (tekilleştirme anahtarı). */
export function dueWeeklySummary(t: Target, now: Date): { weekStart: string } | null {
  const tz = validTz(t.tz);
  const local = localParts(now, tz);
  const weekday = intParam(t.params, 'weekday', 0, 0, 6);
  const hour = intParam(t.params, 'hour', 19, 0, 23);
  if (local.weekday !== weekday || local.hour < hour) return null;
  if (t.last_sent_at) {
    const sent = localParts(new Date(t.last_sent_at), tz);
    if (sent.weekStart === local.weekStart) return null;
  }
  return { weekStart: local.weekStart };
}

/** Sessizlik bildiriminin zamanı geldi mi; geldiyse kaç tam gün. */
export function dueInactivity(t: Target, now: Date): { days: number; since: string } | null {
  if (!t.last_activity_at) return null;
  if (!inDaytime(now, validTz(t.tz))) return null;
  const last = new Date(t.last_activity_at);
  const threshold = intParam(t.params, 'days', 5, 2, 30);
  const days = Math.floor((now.getTime() - last.getTime()) / 86_400_000);
  if (days < threshold) return null;
  if (t.last_sent_at && new Date(t.last_sent_at).getTime() >= last.getTime()) return null;
  return { days, since: localParts(last, t.tz).date };
}

export interface LeafCrossing {
  skill_id: string;
  skill_name: string;
  p: number;
  evidence_count: number;
  crossed_at: string;
}

export interface NetJump {
  session_id: string;
  exam_title: string;
  net: number;
  prev_net: number;
  finished_at: string;
}

export type ImprovementEvent =
  | { kind: 'leaf'; dedupeKey: string; skill_id: string; topic: string; evidence_count: number }
  | { kind: 'net'; dedupeKey: string; session_id: string; topic: string | null; delta: number; net: number };

/** İlerleme olayları: eşiği kanıtla geçen yapraklar ve net sıçraması (saf; SQL satırlarından). */
export function improvementEvents(
  studentId: string,
  params: Record<string, unknown>,
  leaves: readonly LeafCrossing[],
  jumps: readonly NetJump[],
): ImprovementEvent[] {
  const leafP = numParam(params, 'leaf_p', 0.8);
  const minEvidence = intParam(params, 'min_evidence', 5, 1, 1000);
  const netDelta = numParam(params, 'weekly_net_delta', 4);
  const out: ImprovementEvent[] = [];
  for (const l of leaves) {
    if (l.p >= leafP && l.evidence_count >= minEvidence) {
      out.push({ kind: 'leaf', dedupeKey: `improvement:skill:${studentId}:${l.skill_id}`, skill_id: l.skill_id, topic: l.skill_name, evidence_count: l.evidence_count });
    }
  }
  for (const j of jumps) {
    const delta = Math.round((j.net - j.prev_net) * 100) / 100;
    if (delta >= netDelta) out.push({ kind: 'net', dedupeKey: `improvement:net:${j.session_id}`, session_id: j.session_id, topic: null, delta, net: j.net });
  }
  return out;
}

/** Türkçe sayı: 4.5 → "4,5"; 21.75 → "21,75". */
export function trNum(n: number): string {
  const r = Math.round(n * 100) / 100;
  return (Number.isInteger(r) ? String(r) : String(r)).replace('.', ',');
}

/** Dakika → "yaklaşık 4,5 saat" / "40 dakika" (tahmini süre). */
export function trMinutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} dakika`;
  const h = Math.round((m / 60) * 2) / 2;
  return `yaklaşık ${trNum(h)} saat`;
}
