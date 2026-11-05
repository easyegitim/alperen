/**
 * Veli ajanı araçları (packages/llm `PARENT_TOOLS`, strict) → supabase 0043 `parent_*` RPC'leri, velinin JWT'siyle.
 * Dışlamalar veritabanındadır (yalnız aktif bağlı çocuk; koç sohbeti, soru metni, cevap ve anahtar, ham yükleme ve
 * olasılık p hiç dönmez); burada yalnız modele gidecek biçim kısaltılır ve kelime bandına çevrilir. RPC hatası modele
 * ham ileti olarak gitmez: kısa, Türkçe bir açıklama döner (`error`).
 */
import type { RequestReportInput, ToolRunners } from '@ogrenmen/llm';
import type { ReportRef } from './types';

/** Velinin JWT'li istemcisinden gereken dar parça. */
export interface ParentRpc {
  call(fn: string, args?: Record<string, unknown>): Promise<unknown>;
}

/** RPC hatası (SQLSTATE ve OGR-* iletisiyle). */
export class ParentRpcError extends Error {
  constructor(
    readonly fn: string,
    readonly code: string | null,
    message: string,
  ) {
    super(`${fn}: ${message}`);
    this.name = 'ParentRpcError';
  }
  get forbidden(): boolean {
    return this.code === '42501';
  }
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const day = (v: unknown): string | null => (v ? new Date(String(v)).toISOString().slice(0, 10) : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const BAND_TR: Record<string, string> = { low: 'düşük', mid: 'orta', high: 'yüksek' };

function bands(v: unknown) {
  const b = obj(v);
  return { high: num(b.high) ?? 0, mid: num(b.mid) ?? 0, low: num(b.low) ?? 0, insufficient: num(b.insufficient) ?? 0 };
}

const TREND_TR: Record<string, string> = { up: 'yükseliyor', steady: 'yatay', down: 'biraz geriledi' };

function week(v: unknown) {
  const w = obj(v);
  return { start: w.start ?? null, minutes_estimated: num(w.minutes) ?? 0, questions: num(w.questions) ?? 0, active_days: num(w.active_days) ?? 0, exams: num(w.exams) ?? 0 };
}

function courses(v: unknown) {
  return arr(v).map((c) => {
    const x = obj(c);
    return { course_id: x.course_id ?? null, course: x.title ?? null, bands: bands(x.bands), direction: typeof x.trend === 'string' ? (TREND_TR[x.trend] ?? null) : null };
  });
}

function err(message: string): string {
  return JSON.stringify({ error: message });
}

function reportError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/OGR-REPORT-002/.test(msg)) return JSON.stringify({ ok: false, reason: 'daily_limit', note: 'Bugünkü rapor sınırı doldu; yarın yeniden istenebilir.' });
  if (/OGR-REPORT-001/.test(msg)) return JSON.stringify({ ok: false, reason: 'invalid', note: 'Bu rapor isteği anlaşılamadı; türü ve bilgisi (deneme, konu, hafta sayısı ya da soru) yeniden seçilmeli.' });
  return JSON.stringify({ ok: false, reason: 'unavailable', note: 'Rapor isteği şu an açılamadı.' });
}

/** request_report girdisi → parent_request_report(p_kind, p_params). */
export function reportParams(input: RequestReportInput): Record<string, unknown> {
  switch (input.kind) {
    case 'exam':
      return input.session_id ? { session_id: input.session_id } : {};
    case 'topic':
      return input.topic ? { topic: input.topic } : {};
    case 'trend':
      return input.weeks ? { weeks: input.weeks } : {};
    case 'custom':
      return input.question ? { question: input.question } : {};
    default:
      return {};
  }
}

export function parentToolRunners(rpc: ParentRpc, studentId: string, onReport: (ref: ReportRef) => void): ToolRunners {
  const safe = async (fn: () => Promise<string>, what: string): Promise<string> => {
    try {
      return await fn();
    } catch (e) {
      console.warn(`OGR-PARENT-020 veli aracı düştü: ${what}`, e instanceof ParentRpcError ? e.code : e);
      return err(`${what} şu an okunamadı.`);
    }
  };
  return {
    get_child_summary: (input) =>
      safe(async () => {
        const s = obj(await rpc.call('parent_child_summary', { p_student: studentId }));
        const le = s.last_exam ? obj(s.last_exam) : null;
        const lr = s.latest_report ? obj(s.latest_report) : null;
        const out: Obj = {
          this_week: week(s.week),
          previous_week: week(s.prev_week),
          last_exam: le ? { session_id: le.session_id, title: le.title, date: day(le.finished_at), net: num(le.net), questions: num(le.total), correct: num(le.correct), wrong: num(le.wrong), blank: num(le.blank) } : null,
          courses: courses(s.courses),
          open_misconceptions: num(s.open_misconceptions) ?? 0,
          latest_report: lr ? { document_id: lr.id, title: lr.title, date: day(lr.created_at) } : null,
          last_activity: day(s.last_activity_at),
          note: 'Süreler tahminidir. Bantlar kanıt sayısına dayanır; yüzde verilmez.',
        };
        if (input.period === 'month') {
          const a = obj(await rpc.call('parent_recent_activity', { p_student: studentId, p_days: 30 }));
          const days = arr(a.per_day).map(obj);
          out.last_30_days = {
            minutes_estimated: Math.round(days.reduce((n, d) => n + (num(d.minutes) ?? 0), 0)),
            questions: days.reduce((n, d) => n + (num(d.questions) ?? 0), 0),
            active_days: days.filter((d) => (num(d.minutes) ?? 0) > 0 || (num(d.questions) ?? 0) > 0).length,
          };
        }
        return JSON.stringify(out);
      }, 'Özet'),
    get_mastery_overview: (input) =>
      safe(async () => {
        const course = input.course_id && UUID.test(input.course_id) ? input.course_id : null;
        const o = obj(await rpc.call('parent_mastery_overview', { p_student: studentId, p_course: course }));
        return JSON.stringify({
          min_evidence: num(o.min_evidence),
          courses: arr(o.courses).map((c) => {
            const x = obj(c);
            return {
              ...courses([x])[0],
              skills: arr(x.skills)
                .slice(0, 40)
                .map((k) => {
                  const s = obj(k);
                  return { name: s.name, unit: s.unit ?? null, band: typeof s.band === 'string' ? (BAND_TR[s.band] ?? 'az veri') : 'az veri', evidence: num(s.evidence_count) ?? 0, last_seen: day(s.last_evidence_at) };
                }),
            };
          }),
        });
      }, 'Ustalık özeti'),
    get_recent_activity: (input) =>
      safe(async () => {
        const a = obj(await rpc.call('parent_recent_activity', { p_student: studentId, p_days: input.days ?? 7 }));
        return JSON.stringify({
          days: num(a.days),
          per_day: arr(a.per_day).map((d) => ({ date: obj(d).date, minutes_estimated: num(obj(d).minutes) ?? 0, questions: num(obj(d).questions) ?? 0 })),
          items: arr(a.items)
            .slice(0, 30)
            .map((i) => {
              const x = obj(i);
              return { date: day(x.at), kind: x.kind, title: x.title, detail: x.detail ?? null };
            }),
        });
      }, 'Etkinlik'),
    get_exam_sessions: (input) =>
      safe(async () => {
        const rows = arr(await rpc.call('parent_exam_sessions', { p_student: studentId, p_limit: input.limit ?? 5 }));
        return JSON.stringify({
          exams: rows.map((r) => {
            const x = obj(r);
            const sc = x.score ? obj(x.score) : null;
            return {
              session_id: x.session_id,
              title: x.title,
              date: day(x.finished_at),
              status: x.status,
              net: sc ? num(sc.net) : null,
              questions: sc ? num(sc.total) : null,
              correct: sc ? num(sc.correct) : null,
              wrong: sc ? num(sc.wrong) : null,
              blank: sc ? num(sc.blank) : null,
              sections: sc ? arr(sc.sections).map((q) => ({ section: obj(q).section, net: num(obj(q).net), questions: num(obj(q).total) })) : [],
              report_ready: x.report_ready === true,
            };
          }),
        });
      }, 'Denemeler'),
    get_reports: (input) =>
      safe(async () => {
        const rows = arr(await rpc.call('parent_reports', { p_student: studentId, p_limit: input.limit ?? 5 }));
        return JSON.stringify({
          reports: rows.map((r) => {
            const x = obj(r);
            return { document_id: x.id, title: x.title, kind: x.report_kind, ready: x.ready === true, status: x.status, date: day(x.created_at), requested_by_me: x.requested_by_me === true };
          }),
        });
      }, 'Raporlar'),
    request_report: async (input) => {
      try {
        const r = obj(await rpc.call('parent_request_report', { p_student: studentId, p_kind: input.kind, p_params: reportParams(input) }));
        const ref: ReportRef = { documentId: String(r.document_id), title: String(r.title ?? 'Rapor'), kind: String(r.report_kind ?? input.kind) };
        onReport(ref);
        return JSON.stringify({ ok: true, title: ref.title, status: 'hazırlanıyor', used_today: num(r.used), daily_max: num(r.max) });
      } catch (e) {
        console.warn('OGR-PARENT-021 rapor isteği açılamadı', e instanceof ParentRpcError ? e.code : e);
        return reportError(e);
      }
    },
  };
}
