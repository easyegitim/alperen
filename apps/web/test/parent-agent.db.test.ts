// @vitest-environment node
// Veli ajanı × gerçek Postgres (OGRENMEN_LIVE=1): geçici v2 veritabanı, sahte LLM. SupabaseParentStore üretim yoluyla:
// her çağrı velinin JWT'siyle (authenticated + request.jwt.claims, PostgREST gibi) supabase 0043 parent_* RPC'lerine
// gider. Tam tur (araçlar RPC ile, mesajlar ve llm_calls sohbete bağlı), rapor isteği (generated_documents queued +
// report.generate), kapsam (öğrenci 403, koç sohbeti görünmez), sunucu jetonu olmadan assistant yazımı reddi.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import pg from 'pg';
import { FakeTransport, Gateway } from '@ogrenmen/llm';
import { createTempDatabase, seedStudents, type TempDatabase } from '@ogrenmen/llm/testing';
import { loadPrompt } from '@ogrenmen/prompts';
import { executeParentTurn, prepareParentTurn, toParentDisplay, type ParentChatEvent, type ParentTurnDeps } from '@/server/parent/agent';
import { SupabaseParentStore, type ParentDbClient, type RpcResult } from '@/server/parent/store';

const LIVE = process.env.OGRENMEN_LIVE === '1';
const ELIF_PROFILE = '00000000-0000-4000-8000-0000000000e1';
const PARENT = '00000000-0000-4000-8000-0000000000b1';

/** PostgREST'in RPC yolu (yalnız sınama): adlı argümanlar, her çağrı kendi işleminde kullanıcının iddialarıyla. */
function userClient(pool: pg.Pool, sub: string): ParentDbClient {
  const sigs = new Map<string, { names: string[]; types: string[] }>();
  const sig = async (fn: string) => {
    let s = sigs.get(fn);
    if (!s) {
      const r = await pool.query(
        `select coalesce(p.proargnames[1:p.pronargs], '{}') as names, array(select format_type(t, null) from unnest(p.proargtypes) as t) as types
           from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = $1`,
        [fn],
      );
      if (!r.rows[0]) throw new Error(`rpc yok: ${fn}`);
      s = { names: r.rows[0].names as string[], types: r.rows[0].types as string[] };
      sigs.set(fn, s);
    }
    return s;
  };
  return {
    async rpc(fn: string, args: Record<string, unknown> = {}): Promise<RpcResult> {
      const s = await sig(fn);
      const values: unknown[] = [];
      const list = Object.entries(args).map(([k, v]) => {
        const type = s.types[s.names.indexOf(k)];
        if (!type) throw new Error(`${fn}: bilinmeyen argüman ${k}`);
        values.push(v === null || v === undefined ? null : type === 'jsonb' || type === 'json' ? JSON.stringify(v) : v);
        return `${k} => $${values.length}::${type}`;
      });
      const c = await pool.connect();
      try {
        await c.query('begin');
        await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'authenticated', sub })]);
        await c.query('set local role authenticated');
        const r = await c.query(`select to_jsonb(public.${fn}(${list.join(', ')})) as v`, values);
        await c.query('commit');
        return { data: r.rows[0]?.v ?? null, error: null };
      } catch (err) {
        await c.query('rollback').catch(() => undefined);
        const e = err as { message: string; code?: string };
        return { data: null, error: { message: e.message, code: e.code } };
      } finally {
        c.release();
      }
    },
  };
}

describe.skipIf(!LIVE)("veli ajanı × Postgres (velinin JWT'si + parent_* RPC'leri)", () => {
  let tmp: TempDatabase;
  let key: string;
  let elif: string;

  beforeAll(async () => {
    tmp = await createTempDatabase();
    ({ elif } = await seedStudents(tmp.pool));
    const q = tmp.pool.query.bind(tmp.pool);
    key = String((await q(`select secret from secure.server_keys where name = 'web_coach'`)).rows[0]!.secret);
    const course = String(
      (await q(`insert into public.courses (code, title, kind, curriculum_id, visibility) values ('TYT-MAT', 'TYT Matematik', 'exam_track', $1, 'shared') returning id`, [tmp.curriculumId])).rows[0]!.id,
    );
    await q(`insert into public.enrollments (student_id, curriculum_id, course_id, period_label, target_exam) values ($1, $2, $3, 'YKS 2027', 'TYT')`, [elif, tmp.curriculumId, course]);
  });

  afterAll(async () => {
    await tmp?.drop();
  });

  function deps(fake: FakeTransport, profile = PARENT): { deps: ParentTurnDeps; store: SupabaseParentStore } {
    const store = new SupabaseParentStore(userClient(tmp.pool, profile), key);
    const p = loadPrompt('parent_chat');
    return { store, deps: { store, gateway: new Gateway({ transport: fake, ledger: store.ledger() }), product: () => ({ text: p.text, version: p.meta.version }) } };
  }

  async function run(d: ParentTurnDeps, text: string, conversationId: string | null = null) {
    const prepared = await prepareParentTurn(d, { studentId: elif, studentRef: null, conversationId, text, fresh: false });
    const events: ParentChatEvent[] = [];
    await executeParentTurn(d, prepared, (e) => events.push(e));
    return { prepared, events };
  }

  it('tam tur: araçlar RPC ile, mesajlar ve llm_calls sohbete bağlı; çocuğun adı modele gitmez', async () => {
    const fake = new FakeTransport();
    const { deps: d, store } = deps(fake);
    fake.enqueue(
      'parent_chat',
      {
        toolUses: [
          { name: 'get_child_summary', input: { period: 'week' } },
          { name: 'get_mastery_overview', input: {} },
          { name: 'get_exam_sessions', input: {} },
          { name: 'get_reports', input: {} },
          { name: 'get_recent_activity', input: { days: 7 } },
        ],
      },
      { text: 'Bu hafta henüz kayıtlı bir çalışma görünmüyor. Bu hafta ona hangi konuda başlamak istediğini sorabilirsiniz.' },
    );
    const { events, prepared } = await run(d, 'Bu hafta nasıl gitti?');
    const done = events.find((e) => e.type === 'done') as Extract<ParentChatEvent, { type: 'done' }>;
    expect(done.text).toContain('Bu hafta');
    expect(events.some((e) => e.type === 'error')).toBe(false);
    const results = JSON.stringify(fake.requests[1]!.body.messages);
    expect(results).not.toContain('"is_error":true');
    expect(results).not.toContain('okunamadı');
    expect(JSON.stringify(fake.requests.map((r) => r.body))).not.toContain('Elif');
    const h = await store.history({ conversationId: prepared.conversationId, studentId: elif, limit: 100 });
    expect(toParentDisplay(h!.messages).map((m) => m.from)).toEqual(['parent', 'assistant']);
    const calls = (await tmp.pool.query(`select route, ref_table, student_ref from public.llm_calls where ref_id = $1 order by id`, [prepared.conversationId])).rows;
    expect(calls.length).toBe(2);
    expect(calls.every((c) => c.route === 'parent_chat' && c.ref_table === 'conversations' && String(c.student_ref).startsWith('s_'))).toBe(true);
    const conv = (await tmp.pool.query(`select kind, participant_id from public.conversations where id = $1`, [prepared.conversationId])).rows[0]!;
    expect(conv).toEqual({ kind: 'parent', participant_id: PARENT });
  });

  it('rapor isteği: generated_documents (report, queued) + report olayı', async () => {
    const fake = new FakeTransport();
    const { deps: d } = deps(fake);
    fake.enqueue('parent_chat', { toolUses: [{ name: 'request_report', input: { kind: 'weekly' } }] }, { text: 'Haftalık raporu hazırlatıyorum; hazır olunca bildirim gelecek.' });
    const { events } = await run(d, 'Bu haftanın raporunu isterim.');
    const rep = events.find((e) => e.type === 'report') as Extract<ParentChatEvent, { type: 'report' }>;
    expect(rep.kind).toBe('weekly');
    const doc = (await tmp.pool.query(`select kind, status, spec ->> 'source' as source, created_by from public.generated_documents where id = $1`, [rep.documentId])).rows[0]!;
    expect(doc).toEqual({ kind: 'report', status: 'queued', source: 'parent', created_by: PARENT });
  });

  it('kapsam: öğrenci veli sohbeti açamaz (403); jetonsuz assistant yazımı reddedilir; koç sohbeti veliye görünmez', async () => {
    const fake = new FakeTransport();
    await expect(prepareParentTurn(deps(fake, ELIF_PROFILE).deps, { studentId: elif, studentRef: null, conversationId: null, text: 'x', fresh: false })).rejects.toMatchObject({ status: 403 });
    const parentStore = deps(fake).store;
    const conv = await parentStore.openConversation(elif, false);
    const res = await userClient(tmp.pool, PARENT).rpc('parent_append_message', { p_conversation: conv, p_role: 'assistant', p_content: [{ type: 'text', text: 'taklit' }] });
    expect(res.error?.code).toBe('42501');
    const coach = String((await tmp.pool.query(`insert into public.conversations (student_id, kind, participant_id) values ($1, 'coach', $2) returning id`, [elif, ELIF_PROFILE])).rows[0]!.id);
    expect(await parentStore.history({ conversationId: coach, studentId: elif, limit: 10 })).toBeNull();
  });
});
