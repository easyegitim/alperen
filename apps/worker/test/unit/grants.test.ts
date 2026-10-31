/**
 * PostgrestDb'nin dokunduğu her tablo/sütun §3.8 matrisinde `bot_runtime` (S: öğrenci başlığıyla, B:
 * başlıksız) için verilmiş mi. İstemci sahte fetch ile gerçekten çalıştırılır; istekler (yöntem, tablo,
 * `select=` sütunları, gövde anahtarları) kaydedilir ve yetki kümesiyle karşılaştırılır. Matrisle çelişen
 * ama §5'in istediği yazımlar `KNOWN_GAPS`'tedir (README "Kabul komutu notu" 11; M02'den yetki istenir) ve
 * her biri gerçekten kullanılıyor olmalıdır (liste bayatlamasın).
 */
import { describe, expect, it } from 'vitest';
import { PostgrestDb } from '../../src/data/postgrest.ts';
import type { Db } from '../../src/data/repo.ts';

type Cols = '*' | readonly string[];
interface Grant {
  r?: Cols;
  w?: Cols;
  u?: Cols;
}

const MESSAGE_INSERT = ['chat_id', 'telegram_message_id', 'sender_role', 'student_id', 'staff_id', 'reply_to_telegram_message_id', 'text_raw', 'text_llm', 'attachments', 'mentions_bot', 'is_question', 'sent_at'];
const MESSAGE_SELECT = ['id', 'chat_id', 'telegram_message_id', 'sender_role', 'student_id', 'staff_id', 'reply_to_telegram_message_id', 'text_llm', 'attachments', 'mentions_bot', 'is_question', 'answered_at', 'sent_at', 'created_at'];

/** §3.8 S ∪ B sütunu (bot_runtime). Görünümler (questions_public, mastery_view) okunur. */
const GRANTS: Record<string, Grant> = {
  tg_chats: { r: '*', w: '*', u: '*' },
  chat_roles: { r: '*', w: '*', u: '*' },
  staff: { r: ['id', 'role', 'subject'] },
  students: { r: '*' },
  enrollments: { r: '*' },
  quota_tiers: { r: '*' },
  quota_limits: { r: '*' },
  legal_texts: { r: '*' },
  settings: { r: '*' },
  runtime_flags: { r: '*' },
  skills: { r: '*' },
  misconception_tags: { r: '*' },
  sessions: { r: '*', w: '*', u: '*' },
  preferences: { r: '*', u: '*' },
  messages: { r: MESSAGE_SELECT, w: MESSAGE_INSERT, u: ['is_question', 'answered_at'] },
  quota_usage: { r: '*' },
  spend_ledger: { r: '*' },
  provider_health: { r: '*', u: '*' },
  diagnostic_sessions: { r: '*', u: '*' },
  questions_public: { r: '*' },
  attempts: { r: '*' },
  mastery_view: { r: '*' },
  memory_facts: { r: '*' },
  instructor_notes: { r: '*' },
  observations: { r: '*' },
  content_pool: { r: '*', w: '*' },
  proactive_messages: { r: '*' },
  research_outputs: { r: '*' },
  citations: { r: '*' },
  storage_deletions: { u: ['done_at'] },
};

/** §5'in istediği ama §3.8'de bot_runtime'a verilmemiş yazımlar: "op tablo(sütunlar)". */
const KNOWN_GAPS = new Set([
  'w instructor_alerts(detail,kind,ref,severity,since,student_id)',
  'u instructor_alerts(resolved_at,status)',
  'u messages(is_question,text_llm,text_raw)',
  'r storage_deletions(bucket,id,path)',
  'u storage_deletions(error)',
  'u proactive_messages(sent_at,status,telegram_message_id)',
  'u proactive_messages(status)',
]);

interface Req {
  op: 'r' | 'w' | 'u';
  table: string;
  cols: string[];
  query: string;
}

function recorder(): { db: PostgrestDb; reqs: Req[] } {
  const reqs: Req[] = [];
  const fetch = async (input: Request | string | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    const path = url.pathname.replace(/^\/rest\/v1\//, '');
    const method = (init.method ?? 'GET').toUpperCase();
    if (path.startsWith('rpc/')) return new Response('null', { status: 200 });
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
    if (method === 'GET') {
      const sel = url.searchParams.get('select') ?? '*';
      reqs.push({ op: 'r', table: path, cols: sel === '*' ? ['*'] : sel.split(','), query: url.search });
      if (path === 'tg_chats') return new Response(JSON.stringify([{ chat_id: 1, kind: 'group', retention_days: 90, recording_notice_days: 60 }]), { status: 200 });
      if (path === 'chat_roles') return new Response(JSON.stringify([{ telegram_user_id: 5, staff_id: 's1', mention_handle: '@h', role: 'student' }]), { status: 200 });
      if (path === 'research_outputs') return new Response(JSON.stringify([{ id: 'o1', output: { synthesis: [] } }]), { status: 200 });
      return new Response('[]', { status: 200 });
    }
    const keys = Object.keys(Array.isArray(body) ? (body[0] as object) : ((body ?? {}) as object));
    reqs.push({ op: method === 'PATCH' ? 'u' : 'w', table: path, cols: keys, query: url.search });
    if (method === 'POST' && url.searchParams.get('select') !== null) return new Response(JSON.stringify([{ id: 1, student_id: 'x', chat_id: 1, state: 'idle', mode: 'socratic' }]), { status: 201 });
    return new Response('', { status: 201 });
  };
  const db = new PostgrestDb({ url: 'https://db.example', anonKey: 'anon', botJwt: 'jwt', fetch, clock: { now: () => new Date('2026-10-20T16:00:00Z') } });
  return { db, reqs };
}

/** Tablo dokunan her yöntem, kapsamlı (S) ve kapsamsız (B) istemciyle. */
async function exercise(db: Db): Promise<void> {
  const s = db.forStudent('00000000-0000-4000-8000-000000000001');
  const calls: Array<() => Promise<unknown>> = [
    () => db.upsertChat({ chat_id: 1, kind: 'group', title: 'G' }),
    () => db.updateChat(1, { bot_is_admin: true, bot_can_pin: true, privacy_mode_off_verified: true, recording_notice_msg_id: 2, recording_notice_legal_id: 'l', recording_notice_days: 90 }),
    () => db.chatsWithStaleNotice(),
    () => db.getChatRole(1, 5),
    () => db.upsertChatRole({ chat_id: 1, telegram_user_id: 5, role: 'student', student_id: null, staff_id: null, mention_handle: null, joined_at: 'x' }),
    () => db.chatStaff(1),
    () => s.getEnrollment('e1'),
    () => s.identityForStudent(1),
    () => db.settings(),
    () => db.runtimeFlags(),
    () => db.latestLegalText('grup_kayit'),
    () => db.curriculumSkills('c'),
    () => db.misconceptionText('t'),
    () => s.getSession(1),
    () => s.upsertSession({ chat_id: 1, state: 'idle' }),
    () => s.getPreferences(),
    () => s.updatePreferences({ proactive_enabled: false }),
    () => s.insertMessage({ chat_id: 1, telegram_message_id: 2, sender_role: 'student', student_id: 'x', staff_id: null, reply_to_telegram_message_id: null, text_raw: 't', text_llm: 't', attachments: [], mentions_bot: false, is_question: false, sent_at: 'x' }, { returnId: true }),
    () => s.lastPracticeSetId(1),
    () => s.updateMessageText(1, 2, { text_raw: 'a', text_llm: 'a', is_question: false }),
    () => s.markMessageAnswered(1, 'x'),
    () => s.getMessage(1),
    () => s.quotaUsage('2026-10-20'),
    () => db.quotaLimits('standard'),
    () => db.spendLedger('2026-10-01'),
    () => db.providerHealth(),
    () => db.updateProviderHealth('groq', { consecutive_errors: 1, last_error: '429', cooldown_until: null, daily_units_used: 0, daily_units_day: null }),
    () => s.diagnosticStatus('e1'),
    () => s.questionPublic('q1'),
    () => s.sessionAttempts('s1'),
    () => s.masteryView('e1'),
    () => s.approvedFacts('e1'),
    () => s.lastObservationContext('e1'),
    () => s.findPool({ curriculum_id: 'c', kind: 'explanation', skill_id: 'k', misconception_tag: null, mode: 'socratic' }),
    () => s.poolById('p1'),
    () => s.insertPoolCandidate({ kind: 'explanation', curriculum_id: 'c', skill_id: 'k', misconception_tag: null, mode: 'socratic', body: 'b', model: 'm', cost_usd: 0 }),
    () => db.openOpsAlert({ detail: 'd', severity: 'warning', ref: { chat_id: 1 } }),
    () => db.closeOpsAlert('d', { chat_id: 1 }),
    () => db.markProactive('p', 'sent', 3, 'x'),
    () => db.markProactive('p', 'failed', null, 'x'),
    () => db.researchRelease('o1'),
    () => db.pendingStorageDeletions(5),
    () => db.markStorageDeletion(1, 'x', null),
    () => db.markStorageDeletion(1, 'x', 'hata'),
  ];
  for (const c of calls) await c().catch(() => undefined);
}

function allowed(g: Cols | undefined, cols: readonly string[]): boolean {
  if (g === undefined) return false;
  if (g === '*') return true;
  return cols.every((c) => c !== '*' && g.includes(c));
}

describe('grants-matrix (§3.8, bot_runtime)', () => {
  it('PostgrestDb yalnız verilmiş tablo/sütunlara dokunur; çelişkiler KNOWN_GAPS listesinde ve hepsi kullanılıyor', async () => {
    const { db, reqs } = recorder();
    await exercise(db);
    expect(reqs.length).toBeGreaterThan(40);
    const violations: string[] = [];
    const usedGaps = new Set<string>();
    for (const r of reqs) {
      const key = `${r.op} ${r.table}(${[...r.cols].sort().join(',')})`;
      if (allowed(GRANTS[r.table]?.[r.op], r.cols)) continue;
      if (KNOWN_GAPS.has(key)) usedGaps.add(key);
      else violations.push(key);
    }
    expect(violations).toEqual([]);
    expect([...KNOWN_GAPS].filter((g) => !usedGaps.has(g))).toEqual([]);
  });

  it('provider_health INSERT … ON CONFLICT değil PATCH; staff.active okunmaz', async () => {
    const { db, reqs } = recorder();
    await db.updateProviderHealth('groq', { consecutive_errors: 1 });
    await db.chatStaff(1);
    expect(reqs.filter((r) => r.table === 'provider_health').map((r) => r.op)).toEqual(['u']);
    expect(reqs.filter((r) => r.table === 'staff').flatMap((r) => r.cols)).toEqual(['id', 'role', 'subject']);
    expect(reqs.filter((r) => r.table === 'staff').every((r) => r.query.includes('active') === false)).toBe(true);
    expect(reqs.filter((r) => r.table === 'provider_health').every((r) => r.query.includes('on_conflict') === false)).toBe(true);
  });
});
