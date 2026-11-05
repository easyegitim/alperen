// Veli RPC'leri (supabase 0042–0044) için saf yardımcılar: kullanıcının JWT'li istemcisi bir RpcClient'tır;
// kapsam (aktif bağlı veli) ve cevap anahtarı/koç sohbeti dışlaması veritabanındadır, burada ek süzme yoktur.
import { PARENT_COPY, PARENT_RULES, emailChannels, parseNotifications, parseRules, parseSummary, type NotificationCard, type ParentSummary, type ReportKind, type RuleRow } from '@/lib/parent';
import { callRpc, type RpcClient, type RpcResult } from '@/server/practice/rpc';

export const loadSummary = (db: RpcClient, studentId: string): Promise<RpcResult<ParentSummary>> =>
  callRpc(db, 'parent_child_summary', { p_student: studentId }, parseSummary);

export const loadNotifications = (db: RpcClient, limit = 5): Promise<RpcResult<{ unread: number; items: NotificationCard[] }>> =>
  callRpc(db, 'list_notifications', { p_limit: limit, p_before: null, p_unread_only: true }, parseNotifications);

export const loadRules = (db: RpcClient): Promise<RpcResult<RuleRow[]>> => callRpc(db, 'list_notification_rules', {}, parseRules);

export const markRead = (db: RpcClient, id: string | null): Promise<RpcResult<number>> =>
  callRpc(db, 'mark_notification_read', { p_id: id }, (raw) => (typeof raw === 'number' ? raw : 0));

export const setRule = (db: RpcClient, kind: string, enabled: boolean): Promise<RpcResult<unknown>> =>
  callRpc(db, 'set_notification_rule', { p_kind: kind, p_enabled: enabled, p_params: null }, (raw) => raw);

/** Kuralın kanalları (açık/kapalı durumuna dokunmaz; p_enabled null). */
export const setChannels = (db: RpcClient, kind: string, channels: readonly string[]): Promise<RpcResult<unknown>> =>
  callRpc(db, 'set_notification_rule', { p_kind: kind, p_enabled: null, p_params: { channels } }, (raw) => raw);

/** "E-postayla da gönder": veli kurallarının hepsine aynı kanal listesi. Döner: hepsi yazıldı mı. */
export async function setEmailForAll(db: RpcClient, on: boolean): Promise<boolean> {
  const channels = emailChannels(on);
  const results = await Promise.all(PARENT_RULES.map((r) => setChannels(db, r.kind, channels)));
  return results.every((r) => r.ok);
}

export interface ReportAsk {
  kind: ReportKind;
  /** exam: çocuğun bitmiş oturumu. */
  sessionId?: string | null;
  /** topic: velinin sözleriyle konu. */
  topic?: string | null;
  /** trend: kaç hafta (varsayılan 8). */
  weeks?: number | null;
}

/** Rapor türü -> `parent_request_report` parametreleri (bilinmeyen anahtar DB'de atılır). */
export function reportParams(ask: ReportAsk): Record<string, unknown> {
  switch (ask.kind) {
    case 'exam':
      return { session_id: ask.sessionId };
    case 'topic':
      return { topic: (ask.topic ?? '').trim().slice(0, 120) };
    case 'trend':
      return ask.weeks ? { weeks: ask.weeks } : {};
    default:
      return {};
  }
}

export interface ReportOutcome {
  ok: boolean;
  message: string;
}

/** OGR-REPORT-002 günlük sınır; OGR-REPORT-001 geçersiz istek; OGR-AUTH-001 yetki. Mesaj sade Türkçe. */
export function reportErrorMessage(code: string | null): string {
  if (code === 'OGR-REPORT-002') return PARENT_COPY.reportLimit;
  if (code === 'OGR-REPORT-001') return PARENT_COPY.reportFailed;
  return PARENT_COPY.reportFailed;
}

export async function askReport(db: RpcClient, studentId: string, ask: ReportAsk): Promise<ReportOutcome> {
  if (ask.kind === 'exam' && !ask.sessionId) return { ok: false, message: PARENT_COPY.reportNoExam };
  if (ask.kind === 'topic' && !(ask.topic ?? '').trim()) return { ok: false, message: PARENT_COPY.reportNeedTopic };
  const res = await callRpc(db, 'parent_request_report', { p_student: studentId, p_kind: ask.kind, p_params: reportParams(ask) }, (raw) => raw);
  if (!res.ok) return { ok: false, message: reportErrorMessage(res.code) };
  return { ok: true, message: PARENT_COPY.reportAsked };
}
