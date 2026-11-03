// @vitest-environment node
// Koç sohbeti × gerçek Postgres (OGRENMEN_LIVE=1): geçici v2 veritabanı (packages/llm testing), sahte LLM.
// PgChatStore: sohbet/mesaj kaydı, llm_calls bağı, dossier + ders blokları, araç çalıştırıcıları (SQL), hafıza aracı
// (PgStore, actor coach), eğitmen yönlendirmesi (instructor_notes + notifications), "Koça sor" bağlamı ve kapsam.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { FakeTransport, Gateway } from '@ogrenmen/llm';
import { createTempDatabase, seedStudents, type TempDatabase } from '@ogrenmen/llm/testing';
import { loadPrompt } from '@ogrenmen/prompts';
import { toDisplay } from '@/server/chat/history';
import { PgChatStore } from '@/server/chat/pg-store';
import { executeTurn, prepareTurn, type ChatEvent, type TurnDeps } from '@/server/chat/turn';
import type { ChatStudent } from '@/server/chat/types';

const LIVE = process.env.OGRENMEN_LIVE === '1';
const ELIF_PROFILE = '00000000-0000-4000-8000-0000000000e1';
const CAN_PROFILE = '00000000-0000-4000-8000-0000000000e2';

describe.skipIf(!LIVE)('koç sohbeti × Postgres', () => {
  let tmp: TempDatabase;
  let elifRef: string;
  let courseId: string;
  let enrollmentId: string;

  beforeAll(async () => {
    tmp = await createTempDatabase();
    ({ elifRef } = await seedStudents(tmp.pool));
    const q = tmp.pool.query.bind(tmp.pool);
    courseId = String(
      (await q(`insert into public.courses (code, title, kind, curriculum_id, visibility) values ('TYT-MAT', 'TYT Matematik', 'exam_track', $1, 'shared') returning id`, [tmp.curriculumId])).rows[0]!.id,
    );
    const elif = (await q(`select id from public.students where profile_id = $1`, [ELIF_PROFILE])).rows[0]!.id;
    enrollmentId = String(
      (await q(`insert into public.enrollments (student_id, curriculum_id, course_id, period_label, target_exam) values ($1, $2, $3, 'YKS 2027', 'TYT') returning id`, [elif, tmp.curriculumId, courseId])).rows[0]!.id,
    );
  });

  afterAll(async () => {
    await tmp?.drop();
  });

  function deps(fake: FakeTransport): { deps: TurnDeps; store: PgChatStore } {
    const store = new PgChatStore(tmp.pool, null);
    const p = loadPrompt('coach_chat');
    return { store, deps: { store, gateway: new Gateway({ transport: fake, ledger: store.ledger() }), product: () => ({ text: p.text, version: p.meta.version }), now: () => new Date('2026-11-03T10:00:00+03:00') } };
  }

  async function run(d: TurnDeps, student: ChatStudent, text: string, extra: Partial<Parameters<typeof prepareTurn>[1]> = {}) {
    const prepared = await prepareTurn(d, { student, conversationId: null, text, uploadIds: [], mode: null, seedId: null, ...extra });
    const events: ChatEvent[] = [];
    await executeTurn(d, prepared, (e) => events.push(e));
    return { prepared, events };
  }

  it('öğrenci çözümü: kayıt, ders ve public_ref', async () => {
    const { store } = deps(new FakeTransport());
    const s = await store.resolveStudent(ELIF_PROFILE);
    expect(s).toMatchObject({ publicRef: elifRef, courseId, enrollmentId });
    expect(await store.resolveStudent('00000000-0000-4000-8000-0000000000a1')).toBeNull();
  });

  it('tam tur: 3 system blok, araçlar SQL ile, hafıza yazımı, yönlendirme, llm_calls bağı', async () => {
    const fake = new FakeTransport();
    const { deps: d, store } = deps(fake);
    const student = (await store.resolveStudent(ELIF_PROFILE))!;
    fake.enqueue(
      'coach_chat',
      {
        text: 'Kayıtlarına bakıyorum.',
        toolUses: [
          { name: 'get_mastery', input: {} },
          { name: 'search_evidence', input: { query: 'parantez işaret hatası' } },
          { name: 'get_recent_exams', input: {} },
          { name: 'memory', input: { command: 'create', path: '/memories/coach_notes.md', file_text: 'Kısa adımlı anlatım işe yarıyor.\n' } },
          {
            name: 'record_turn_meta',
            input: { skill_ids: [], misconception_tags: [], mode_suggestion: null, escalate_to_instructor: true, confidence: 0.6, note: 'Ödev teslim tarihini soruyor.' },
          },
        ],
      },
      { text: 'Bunu hocana sorman daha iyi; hocan bu konuyu görecek.' },
    );
    const { prepared, events } = await run(d, student, 'Ödevimi ne zaman teslim etmeliyim?', { mode: 'explain' });
    const done = events.find((e) => e.type === 'done') as Extract<ChatEvent, { type: 'done' }>;
    expect(done.escalated).toBe(true);

    const body = fake.requests[0]!.body;
    const system = body.system as { text: string }[];
    expect(system).toHaveLength(3);
    expect(system[1]!.text).toContain('TYT');
    expect(system[2]!.text.length).toBeGreaterThan(50);
    expect(body.messages.at(-1)).toEqual({ role: 'system', content: 'Bugün 2026-11-03. Mod: açıkla.' });

    const results = fake.requests[1]!.body.messages.at(-1)!.content as { content: string; is_error?: boolean }[];
    expect(results.filter((r) => r.is_error)).toEqual([]);
    expect(JSON.parse(results[0]!.content)).toHaveProperty('skills');
    expect(JSON.parse(results[1]!.content)).toMatchObject({ method: 'keyword' });

    const msgs = await tmp.pool.query(`select role, llm_call_id, tool_calls from public.conversation_messages where conversation_id = $1 order by id`, [prepared.conversation.id]);
    expect(msgs.rows.map((r) => r.role)).toEqual(['user', 'system', 'assistant', 'user', 'assistant']);
    const last = msgs.rows.at(-1)!;
    expect(last.llm_call_id).not.toBeNull();
    expect(last.tool_calls.escalated).toBe(true);
    const call = await tmp.pool.query(`select route, student_ref, prompt_version, ref_table from public.llm_calls where id = $1`, [last.llm_call_id]);
    expect(call.rows[0]).toMatchObject({ route: 'coach_chat', student_ref: elifRef, prompt_version: 'v1', ref_table: 'conversations' });
    expect(Number((await tmp.pool.query(`select count(*) from public.llm_calls where route = 'coach_chat'`)).rows[0]!.count)).toBe(2);

    const conv = await tmp.pool.query(`select mode, kind, course_id, last_message_at from public.conversations where id = $1`, [prepared.conversation.id]);
    expect(conv.rows[0]).toMatchObject({ mode: 'explain', kind: 'coach', course_id: courseId });
    expect(conv.rows[0]!.last_message_at).not.toBeNull();

    const mem = await tmp.pool.query(`select v.actor, f.content from public.memory_files f join public.memory_file_versions v using (student_id, path) where f.path = '/memories/coach_notes.md'`);
    expect(mem.rows[0]).toMatchObject({ actor: 'coach', content: 'Kısa adımlı anlatım işe yarıyor.\n' });

    // Yönlendirme yalnız bildirim: koçun notu eğitmenin yazdığı not gibi görünmesin (instructor_notes yazılmaz).
    const note = await tmp.pool.query(`select body from public.instructor_notes where enrollment_id = $1`, [enrollmentId]);
    expect(note.rows).toHaveLength(0);
    const notif = await tmp.pool.query(`select recipient_id, kind, body, payload from public.notifications where kind = 'coach_escalation'`);
    expect(notif.rows[0]).toMatchObject({ recipient_id: '00000000-0000-4000-8000-0000000000a1' });
    expect(notif.rows[0]!.body).toContain('Ödev teslim tarihini soruyor.');
    expect(notif.rows[0]!.payload).toMatchObject({ conversation_id: prepared.conversation.id, reason: 'turn_meta', enrollment_id: enrollmentId });

    // İkinci tur aynı sohbette: geçmiş veritabanından aynı biçimde kurulur.
    const second = await run(d, student, 'Peki ya kesirler?', { conversationId: prepared.conversation.id });
    expect(second.events.some((e) => e.type === 'done')).toBe(true);
    const a = fake.requests[1]!.body.messages;
    const b = fake.requests[2]!.body.messages;
    expect(b.slice(0, a.length)).toEqual(a);
    const display = toDisplay(await store.listMessages(prepared.conversation.id, { limit: 80 }));
    expect(display.map((x) => x.from)).toEqual(['student', 'tutor', 'student', 'tutor']);
  });

  it('yönlendirme: aynı sohbetten 24 saatte bir bildirim; ret kategorisi Türkçe etiketle, ham değer payload içinde', async () => {
    const fake = new FakeTransport();
    const { store } = deps(fake);
    const student = (await store.resolveStudent(ELIF_PROFILE))!;
    const conv = await store.createConversation(student, 'hint');
    const count = async () =>
      Number((await tmp.pool.query(`select count(*) from public.notifications where kind = 'coach_escalation' and payload ->> 'conversation_id' = $1`, [conv.id])).rows[0]!.count);
    const input = { student, conversationId: conv.id, reason: 'refusal' as const, category: 'cyber', note: null };
    expect(await store.escalate(input)).toBe(true);
    expect(await store.escalate(input)).toBe(true);
    expect(await store.escalate({ ...input, reason: 'turn_meta', category: null, note: 'Hocamı istiyorum.' })).toBe(true);
    expect(await count()).toBe(1);
    const row = (await tmp.pool.query(`select body, payload from public.notifications where payload ->> 'conversation_id' = $1`, [conv.id])).rows[0]!;
    expect(row.body).toContain('güvenlik');
    expect(row.body).not.toContain('cyber');
    expect(row.payload).toMatchObject({ category: 'cyber', reason: 'refusal' });
    // 24 saat geçince yeniden yönlendirilebilir; başka sohbet bağımsız.
    await tmp.pool.query(`update public.notifications set created_at = now() - interval '25 hours' where payload ->> 'conversation_id' = $1`, [conv.id]);
    expect(await store.escalate(input)).toBe(true);
    expect(await count()).toBe(2);
    const other = await store.createConversation(student, 'hint');
    expect(await store.escalate({ ...input, conversationId: other.id })).toBe(true);
    expect(await count()).toBe(2);
  });

  it('get_recent_exams bölüm sonuçları ve öne çıkan hataları; get_mastery ham olasılık vermez', async () => {
    const { store } = deps(new FakeTransport());
    const student = (await store.resolveStudent(ELIF_PROFILE))!;
    const q = tmp.pool.query.bind(tmp.pool);
    const skill = String((await q(`select id from public.skills where curriculum_id = $1 order by id limit 1`, [tmp.curriculumId])).rows[0]!.id);
    const exam = String(
      (await q(`insert into public.exams (course_id, curriculum_id, kind, source, title, status) values ($1, $2, 'deneme', 'uploaded', 'Deneme 3', 'ready') returning id`, [courseId, tmp.curriculumId])).rows[0]!.id,
    );
    const qs = [];
    for (const no of [1, 2, 3]) {
      qs.push(String((await q(`insert into public.exam_questions (exam_id, no, section, skill_ids) values ($1, $2, 'Matematik', $3) returning id`, [exam, no, [skill]])).rows[0]!.id));
    }
    const score = { total: 3, correct: 1, wrong: 2, blank: 0, net: 0.5, sections: [{ section: 'Matematik', total: 3, correct: 1, wrong: 2, blank: 0, net: 0.5 }] };
    const session = String(
      (await q(`insert into public.exam_sessions (exam_id, enrollment_id, mode, status, finished_at, score) values ($1, $2, 'in_app', 'done', now(), $3) returning id`, [exam, enrollmentId, JSON.stringify(score)])).rows[0]!.id,
    );
    const sa = String(
      (await q(`insert into public.solution_analyses (enrollment_id, analysis, verdict, misconception_tags) values ($1, '{}', 'wrong', '{isaret-dagitma}') returning id`, [enrollmentId])).rows[0]!.id,
    );
    await q(`insert into public.exam_responses (session_id, exam_question_id, answer, outcome, solution_analysis_id) values ($1, $2, 'A', 'correct', null), ($1, $3, 'B', 'wrong', $5), ($1, $4, 'C', 'wrong', null)`, [session, qs[0], qs[1], qs[2], sa]);
    const runners = store.toolRunners(student);
    const ctx = {} as never;
    const out = JSON.parse(String(await runners.get_recent_exams!({ limit: 3 }, ctx)));
    const e = out.exams.find((x: { title: string }) => x.title === 'Deneme 3');
    expect(e).toMatchObject({ kind: 'deneme', net: 0.5, correct: 1, wrong: 2, sections: [{ section: 'Matematik', net: 0.5, correct: 1, wrong: 2 }] });
    expect(e.top_errors.skills[0]).toMatchObject({ code: skill, missed: 2 });
    expect(e.top_errors.misconceptions).toEqual([{ tag: 'isaret-dagitma', count: 1 }]);
    const mastery = JSON.parse(String(await runners.get_mastery!({}, ctx)));
    for (const k of mastery.skills) {
      expect(k).not.toHaveProperty('p');
      expect(k).toHaveProperty('band');
    }
  });

  it('kapsam: başka öğrencinin sohbeti ve teşhisi görünmez; Koça sor bağlamı kendi teşhisiyle gelir', async () => {
    const fake = new FakeTransport();
    const { deps: d, store } = deps(fake);
    const elif = (await store.resolveStudent(ELIF_PROFILE))!;
    const can = (await store.resolveStudent(CAN_PROFILE))!;
    const sa = await tmp.pool.query(
      `insert into public.solution_analyses (enrollment_id, question_text, student_work_text, analysis, verdict, failing_step_no, error_cause, skill_ids)
       values ($1, '2(x+1) − 3(x−2) = 4', '2x+2 − 3x − 6 = 4', '{"why_tr": "Parantezi açarken işaret hatası yaptın."}', 'wrong', 3, 'procedure', '{}') returning id`,
      [enrollmentId],
    );
    const seedId = String(sa.rows[0]!.id);
    expect(await store.getSeed(can, seedId)).toBeNull();
    const { prepared } = await run(d, elif, 'Bu soruda nerede yanlış yaptım?', { seedId });
    const user = fake.requests[0]!.body.messages.at(-2)!.content as { text: string }[];
    expect(user[1]!.text).toContain('Parantezi açarken işaret hatası yaptın.');
    expect(await store.getConversation(can, prepared.conversation.id)).toBeNull();
    await expect(prepareTurn(d, { student: can, conversationId: prepared.conversation.id, text: 'x', uploadIds: [], mode: null, seedId: null })).rejects.toMatchObject({
      code: 'conversation_not_found',
    });
    expect(await store.setMode(can, prepared.conversation.id, 'solve')).toBe(false);
  });

  it('tur kilidi: aynı sohbette ikinci tur 409, bekleme görünür; bitince ya da bağlantı ölünce kilit düşer', async () => {
    const fake = new FakeTransport();
    const { deps: d, store } = deps(fake);
    const student = (await store.resolveStudent(ELIF_PROFILE))!;
    const conv = await store.createConversation(student, 'hint');
    const claim = await store.claimTurn(conv.id);
    expect(claim).not.toBeNull();
    expect(await store.claimTurn(conv.id)).toBeNull();
    expect(await store.turnInProgress(conv.id)).toBe(true);
    // Başka sohbet etkilenmez.
    const other = await store.createConversation(student, 'hint');
    expect(await store.turnInProgress(other.id)).toBe(false);
    await expect(prepareTurn(d, { student, conversationId: conv.id, text: 'x', uploadIds: [], mode: null, seedId: null })).rejects.toMatchObject({
      code: 'turn_in_progress',
      status: 409,
    });
    await claim!.release();
    await claim!.release(); // iki kez bırakmak zararsız
    expect(await store.turnInProgress(conv.id)).toBe(false);
    const { events } = await run(d, student, 'Merhaba', { conversationId: conv.id });
    expect(events.at(-1)?.type).toBe('done');
    expect(await store.turnInProgress(conv.id)).toBe(false);
    expect(await store.countMessages(conv.id, null)).toBe(3);
    // Kilidi tutan bağlantı ölürse kilit düşer.
    const held = await store.claimTurn(conv.id);
    expect(held).not.toBeNull();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await tmp.pool.query(
      `select pg_terminate_backend(pid) from pg_locks where locktype = 'advisory' and objid = (hashtext($1)::bigint & 4294967295)::oid and pid <> pg_backend_pid()`,
      [conv.id],
    );
    await new Promise((r) => setTimeout(r, 100));
    expect(await store.turnInProgress(conv.id)).toBe(false);
    await held!.release(); // ölmüş bağlantıda bırakma hata fırlatmaz
    expect(spy.mock.calls.some((c) => String(c[0]).startsWith('OGR-CHAT-013'))).toBe(true);
    spy.mockRestore();
  });
});
