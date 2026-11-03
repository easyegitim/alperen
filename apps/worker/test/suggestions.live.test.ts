/**
 * Öneri motoru ve gece işleri gerçek Postgres'te (OGRENMEN_LIVE=1): geçici veritabanı (@ogrenmen/llm/testing: stub +
 * tüm göçler + seed'ler + TYT müfredatı), işleyiciler doğrudan çağrılır, LLM sahte taşımadır.
 *   suggestions.refresh → replace_suggestions → list_today_suggestions (öğrenci JWT'siyle) → start_practice (consume)
 *   → yeniden hesap (başlatılan ödev geri gelmez); memory.compact Batch → PgStore compact; conversation.summarize;
 *   dossier.render.
 * Bağlanılan veritabanına dokunmaz; geçici veritabanı sonunda silinir.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeTransport, MEMORY_COMPACT_ACTOR, PgStore } from '@ogrenmen/llm';
import { createTempDatabase, seedStudents, type TempDatabase } from '@ogrenmen/llm/testing';
import { getJob } from '../src/jobs/registry.js';
import { jobCtx } from './support.js';

const live = process.env.OGRENMEN_LIVE === '1';
const INSTRUCTOR = '00000000-0000-4000-8000-0000000000a1';
const ELIF_PROFILE = '00000000-0000-4000-8000-0000000000e1';

describe.skipIf(!live)('öneri motoru + gece işleri (gerçek Postgres)', () => {
  let tmp: TempDatabase;
  let elif: string;
  let course: string;
  let enr: string;

  beforeAll(async () => {
    tmp = await createTempDatabase();
    ({ elif } = await seedStudents(tmp.pool));
    const q = (text: string, values?: unknown[]) => tmp.pool.query(text, values);
    course = String((await q(`insert into public.courses (code, title, kind, curriculum_id, visibility) values ('TYT-MAT', 'TYT Matematik', 'exam_track', $1, 'shared') returning id`, [tmp.curriculumId])).rows[0]!.id);
    enr = String(
      (await q(
        `insert into public.enrollments (student_id, curriculum_id, course_id, period_label, target_exam, exam_date)
         values ($1, $2, $3, 'YKS 2027', 'TYT', (now() at time zone 'Europe/Istanbul')::date + 10) returning id`,
        [elif, tmp.curriculumId, course],
      )).rows[0]!.id,
    );
    await q(
      `insert into public.mastery (enrollment_id, skill_id, p, evidence_count, last_evidence_at) values
         ($1, 'tyt.mat.temel.rasyonel-sayilar', 0.21, 3, now() - interval '1 day'),
         ($1, 'tyt.mat.temel.sayilar', 0.35, 2, now() - interval '1 day'),
         ($1, 'tyt.mat.problem.yas', 0.92, 6, now() - interval '20 days')`,
      [enr],
    );
    await q(`insert into public.instructor_notes (enrollment_id, author_id, skill_id, body) values ($1, $2, 'tyt.mat.temel.rasyonel-sayilar', 'Ödev: rasyonel sayılardan 10 soru')`, [enr, INSTRUCTOR]);
    await q(`insert into public.instructor_notes (enrollment_id, author_id, body) values ($1, $2, 'Derste dikkatliydi')`, [enr, INSTRUCTOR]);
    const lesson = String((await q(`insert into public.lessons (enrollment_id, instructor_id, held_at, status) values ($1, $2, now() - interval '2 days', 'approved') returning id`, [enr, INSTRUCTOR])).rows[0]!.id);
    const la = String((await q(`insert into public.lesson_analyses (lesson_id, seed_profile, analysis, model, status) values ($1, '{}', '{}', 'claude-opus-5-5', 'approved') returning id`, [lesson])).rows[0]!.id);
    await q(
      `insert into public.lesson_claims (analysis_id, kind, curriculum_id, skill_id, value, quote, speaker, t_start_sec, status)
       values ($1, 'skill_mastery', $2, 'tyt.mat.temel.uslu', '{"p": 0.6}', 'üslü ifadelerde', 'EĞİTMEN', 10, 'approved')`,
      [la, tmp.curriculumId],
    );
    await q(`insert into public.generated_documents (student_id, course_id, kind, title, status) values ($1, $2, 'notes', 'Rasyonel sayılar', 'rendered')`, [elif, course]);
  });

  afterAll(async () => {
    await tmp?.drop();
  });

  it('suggestions.refresh: kurallar → replace_suggestions; öğrenci list_today_suggestions ile ilk 4 kartı görür', async () => {
    const ctx = jobCtx({ db: tmp.pool, now: () => new Date() });
    const res = await getJob('suggestions.refresh')!.handler!({ student_id: elif, reason: 'test' }, ctx);
    expect(res).toMatchObject({ mode: 'student', written: 6, kinds: ['weekly_homework', 'practice', 'gap_analysis', 'lesson_review', 'mini_exam', 'document_ready'], copy: { template: 6 } });

    const rows = (await tmp.pool.query('select kind, rank, title, subtitle, payload, expires_at from public.suggestions where student_id = $1 and consumed_at is null order by rank', [elif])).rows;
    expect(rows[0]).toMatchObject({ kind: 'weekly_homework', rank: 0, title: 'Haftalık ödev', payload: { skill_ids: ['tyt.mat.temel.rasyonel-sayilar'], count: 10, source: 'note' } });
    expect(rows[1]).toMatchObject({ kind: 'practice', payload: { skill_ids: ['tyt.mat.temel.sayilar'] } });
    expect(rows[2]).toMatchObject({ kind: 'gap_analysis', title: 'Tekrar zamanı', payload: { skill_ids: ['tyt.mat.problem.yas'], reason: 'spaced_review' } });
    expect(rows[3]).toMatchObject({ kind: 'lesson_review', payload: { skill_ids: ['tyt.mat.temel.uslu'], count: 5 } });
    expect(rows[4]).toMatchObject({ kind: 'mini_exam', subtitle: 'Sınava 10 gün kaldı · 20 soru · 30 dk' });
    expect(rows[5]).toMatchObject({ kind: 'document_ready', title: 'Rasyonel sayılar notun hazır' });
    for (const r of rows) expect((r.expires_at as Date).getTime()).toBeGreaterThan(Date.now());

    // öğrenci oturumu (RLS + RPC): en çok 4 kart, rank sırası
    const c = await tmp.pool.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: ELIF_PROFILE, role: 'authenticated' })]);
      await c.query('set local role authenticated');
      const today = (await c.query('select kind from public.list_today_suggestions()')).rows.map((r) => r.kind);
      // 4 başlatılabilir kart + bildirim bandı (not kartı kutuların arkasında kaybolmaz)
      expect(today).toEqual(['weekly_homework', 'practice', 'gap_analysis', 'lesson_review', 'document_ready']);
    } finally {
      await c.query('rollback');
      c.release();
    }
  });

  it('başlatılan ödev yeniden önerilmez; yenileme aktifleri değiştirir, başlatılanı korur', async () => {
    const hw = (await tmp.pool.query(`select id from public.suggestions where student_id = $1 and kind = 'weekly_homework' and consumed_at is null`, [elif])).rows[0]!.id;
    const set = (await tmp.pool.query('select public.start_practice($1::uuid) as s', [hw])).rows[0]!.s as { status: string; skill_ids: string[] };
    expect(set.skill_ids).toEqual(['tyt.mat.temel.rasyonel-sayilar']);
    const ctx = jobCtx({ db: tmp.pool, now: () => new Date() });
    const res = await getJob('suggestions.refresh')!.handler!({ student_id: elif, reason: 'practice.finished' }, ctx);
    expect(res).toMatchObject({ kinds: ['practice', 'gap_analysis', 'lesson_review', 'mini_exam', 'document_ready'] });
    const active = (await tmp.pool.query('select kind, rank from public.suggestions where student_id = $1 and consumed_at is null order by rank', [elif])).rows;
    expect(active[0]).toEqual({ kind: 'practice', rank: 0 });
    const consumed = (await tmp.pool.query('select kind from public.suggestions where student_id = $1 and consumed_at is not null', [elif])).rows;
    expect(consumed).toEqual([{ kind: 'weekly_homework' }]);
    // rasyonel bugün çalışıldı: alıştırma diğer zayıf yaprakla
    const practice = (await tmp.pool.query(`select payload from public.suggestions where student_id = $1 and kind = 'practice' and consumed_at is null`, [elif])).rows[0]!.payload;
    expect(practice.skill_ids).toEqual(['tyt.mat.temel.sayilar']);
  });

  it('gece yayılımı etkin kaydı olan öğrenciyi bulur', async () => {
    const ctx = jobCtx({ db: tmp.pool });
    const res = await getJob('suggestions.refresh')!.handler!({}, ctx);
    expect(res).toEqual({ mode: 'fanout', students: 1 });
    expect(ctx.enqueued[0]).toMatchObject({ data: { student_id: elif } });
  });

  it('memory.compact: > 6 KB dosya Batch ile ≤ 4 KB yazılır (op compact, actor memory-compact)', async () => {
    const store = new PgStore(tmp.pool);
    await store.write(elif, '/memories/coach_notes.md', '- Kesir şeridiyle anlatınca anladı, 3 Kas.\n'.repeat(160), 'create', 'coach');
    const transport = new FakeTransport();
    transport.enqueue('memory_compaction', { json: { files: [{ path: '/memories/coach_notes.md', content: '- Kesir şeridiyle anlatım işe yarıyor (160×, son 3 Kas).' }] } });
    const ctx = jobCtx({ db: tmp.pool, transport });
    const job = getJob('memory.compact')!;
    const sub = await job.handler!({ student_id: elif }, ctx);
    expect(sub).toMatchObject({ phase: 'submit', students: 1, files: 1 });
    const col = await job.handler!(job.payload.parse(ctx.enqueued.at(-1)!.data), ctx);
    expect(col).toMatchObject({ phase: 'collect', compacted: 1, failed: 0 });
    expect(await store.read(elif, '/memories/coach_notes.md')).toBe('- Kesir şeridiyle anlatım işe yarıyor (160×, son 3 Kas).');
    const v = (await tmp.pool.query(`select op, actor from public.memory_file_versions where student_id = $1 and path = '/memories/coach_notes.md' order by id desc limit 1`, [elif])).rows[0];
    expect(v).toEqual({ op: 'compact', actor: MEMORY_COMPACT_ACTOR });
  });

  it('conversation.summarize: eski mesajlar özetlenir, son 30 mesaj kalır', async () => {
    const conv = String((await tmp.pool.query(`insert into public.conversations (student_id, kind, participant_id) values ($1, 'coach', $2) returning id`, [elif, ELIF_PROFILE])).rows[0]!.id);
    await tmp.pool.query(
      `insert into public.conversation_messages (conversation_id, role, content)
       select $1, case when g % 2 = 1 then 'user' else 'assistant' end, jsonb_build_array(jsonb_build_object('type', 'text', 'text', 'mesaj ' || g))
         from generate_series(1, 44) as g order by g`,
      [conv],
    );
    const ids = (await tmp.pool.query('select id from public.conversation_messages where conversation_id = $1 order by id', [conv])).rows.map((r) => Number(r.id));
    const transport = new FakeTransport();
    transport.enqueue('conversation_summary', { json: { summary: 'Öğrenci kesirlerde payda eşitlemeyi çalıştı.', open_threads: [], skill_ids: [] } });
    const res = await getJob('conversation.summarize')!.handler!({ conversation_id: conv }, jobCtx({ db: tmp.pool, transport }));
    expect(res).toMatchObject({ mode: 'conversation', summarized: 14, uptoMessageId: ids[13] });
    const row = (await tmp.pool.query('select summary, summary_upto_message_id from public.conversations where id = $1', [conv])).rows[0]!;
    expect(row.summary).toBe('Öğrenci kesirlerde payda eşitlemeyi çalıştı.');
    expect(Number(row.summary_upto_message_id)).toBe(ids[13]);
  });

  it('dossier.render: student_dossier_cache yazılır; aynı veriyle ikinci çağrı yazmaz', async () => {
    const job = getJob('dossier.render')!;
    const a = await job.handler!({ student_id: elif, course_id: course }, jobCtx({ db: tmp.pool }));
    expect(a.changed).toBe(true);
    const b = await job.handler!({ student_id: elif, course_id: course }, jobCtx({ db: tmp.pool }));
    expect(b).toMatchObject({ changed: false, hash: a.hash });
    const text = (await tmp.pool.query('select rendered from public.student_dossier_cache where student_id = $1', [elif])).rows[0]!.rendered as string;
    // 0024: aktif öneri sayısı gövdede yok (hash kararlı); metin olmayan sayıyı "0" diye yazmaz
    expect(text).not.toContain('Bugün için aktif öneri');
    expect(text).toContain('Hafıza dosyaları (içerik hafıza aracıyla okunur)');
    expect(text).not.toContain('[object Object]');
  });
});
