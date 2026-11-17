/**
 * P5 ders hattı uçtan uca (OGRENMEN_LIVE=1): geçici veritabanı (göçler 0001–… + seed + TYT müfredatı) + gerçek pg-boss
 * (createApp) + gerçek pipelines/ders servisi (`python3 -I service.py`, ffmpeg, OGRENMEN_STT=fake: fixtures/ders
 * transkripti) + sahte Anthropic taşıması (packages/llm/fixtures speaker_label / lesson_analysis 02-ders-v2) + bellek
 * içi Storage (TUS yüklemesi yerine nesne doğrudan konur).
 *
 *   eğitmen JWT'si → register_lesson(ffmpeg ile üretilmiş 10 sn sessiz video) → pgboss 'lesson.prepare' → worker:
 *   servis /prepare (WAV + kareler → Storage) → lesson.stt (sahte transkript, ses silinir) → lesson.label (ad temizliği,
 *   Sonnet etiketleri) → lesson.analyse (Opus; kareler + transkript) → write_lesson_analysis → apply_lesson_claims:
 *   güven ≥ 0,80 iddialar observations(kind='lesson') + BKT, eşik altı (denklem 0,6; yanılgılar, ödev ve sonraki adım
 *   güvensiz) kuyrukta → eğitmen bildirimi → memory.apply (/memories/courses/tyt-mat.md) → done → kareler silinir.
 *   Bellek içi Storage 'lessons' kovasının göçlerdeki MIME listesini zorlar (kare image/jpeg reddedilirse hat düşer).
 *   Ardından: hazır transkript yüklemesi (STT atlanır), sessiz olmayan ama ses akışı olmayan video (failed + neden),
 *   lesson.retention (süresi dolan ham video silinir).
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeTransport, Gateway, PgLedger } from '@ogrenmen/llm';
import { createTempDatabase, seedStudents, type TempDatabase } from '@ogrenmen/llm/testing';
import { createApp, type App } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { getJob } from '../src/jobs/registry.js';
import type { RetentionResult } from '../src/jobs/lessons.js';
import { createLessonService, lessonServiceHooks } from '../src/lessons/service.js';
import { silentLogger } from '../src/log.js';
import { MemoryStorage } from './lesson-storage.js';
import { jobCtx } from './support.js';

const live = process.env.OGRENMEN_LIVE === '1';
const INSTRUCTOR = '00000000-0000-4000-8000-0000000000a1';
const MIGRATION_ROLE = 'ogrenmen_owner';
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const SERVICE = join(ROOT, 'pipelines', 'ders', 'src', 'ogrenmen_ders', 'service.py');

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 90_000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('beklenen durum oluşmadı');
    await new Promise((r) => setTimeout(r, 250));
  }
}

function video(path: string, opts: { audio: boolean; seconds?: number }): Buffer {
  const s = String(opts.seconds ?? 10);
  const args = ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=s=640x360:r=10:d=${s}`];
  if (opts.audio) args.push('-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', s, '-c:a', 'aac', '-shortest');
  execFileSync('ffmpeg', [...args, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '32', path]);
  return readFileSync(path);
}

describe.skipIf(!live)('ders hattı: register_lesson → lesson.* → done (gerçek pg-boss + ders servisi, sahte LLM/STT)', () => {
  let tmp: TempDatabase;
  let app: App;
  let svc: ChildProcess;
  let work = '';
  let elif = '';
  let enr = '';
  let course = '';
  const storage = new MemoryStorage();
  const copyEnv = process.env.OGRENMEN_SUGGESTIONS_COPY;
  let lessonId = '';

  type Q = (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  async function asInstructor<T>(fn: (q: Q) => Promise<T>): Promise<T> {
    const c = await tmp.pool.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: INSTRUCTOR, role: 'authenticated' })]);
      await c.query('set local role authenticated');
      const out = await fn((text, values) => c.query(text, values));
      await c.query('commit');
      return out;
    } catch (err) {
      await c.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  }

  /** Web'in TUS sonrası yaptığı gibi: 'lessons' kovasında nesne + eğitmenin uploads satırı. */
  async function upload(kind: 'video' | 'transcript', body: Buffer, ext: string, mime: string): Promise<string> {
    const id = randomUUID();
    const path = `${INSTRUCTOR}/${id}${ext}`;
    await storage.upload('lessons', path, body, mime);
    await tmp.pool.query(
      `insert into public.uploads (id, owner_id, student_id, kind, storage_path, mime, bytes) values ($1, $2, null, $3, $4, $5, $6)`,
      [id, INSTRUCTOR, kind, path, mime, body.length],
    );
    return id;
  }

  async function register(uploadId: string, meta: Record<string, unknown>): Promise<string> {
    const r = await asInstructor(async (q) => (await q('select public.register_lesson($1::jsonb, $2::uuid) as r', [JSON.stringify(meta), uploadId])).rows[0]!.r as Record<string, unknown>);
    expect(r).toMatchObject({ status: 'processing', created: true });
    return String(r.lesson_id);
  }

  async function settled(id: string): Promise<Record<string, unknown>> {
    return waitFor(async () => {
      const l = (await tmp.pool.query('select status, progress from public.lessons where id = $1', [id])).rows[0]!;
      const stage = (l.progress as { stage?: string }).stage;
      return stage === 'done' || stage === 'failed' ? l : null;
    });
  }

  beforeAll(async () => {
    process.env.OGRENMEN_SUGGESTIONS_COPY = 'template';
    work = mkdtempSync(join(tmpdir(), 'ogrenmen-ders-live-'));
    const port = await freePort();
    svc = spawn('python3', ['-I', SERVICE, '--port', String(port)], {
      env: { PATH: process.env.PATH ?? '', OGRENMEN_DERS_WORK_DIR: join(work, 'kok'), OGRENMEN_STT: 'fake', OGRENMEN_STT_FIXTURES: join(ROOT, 'fixtures', 'ders'), OGRENMEN_DERS_QUIET: '1' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    lessonServiceHooks.service = createLessonService({ LESSON_SERVICE_URL: `http://127.0.0.1:${port}` });
    await waitFor(async () => lessonServiceHooks.service!.health().catch(() => null), 15_000);

    tmp = await createTempDatabase();
    ({ elif } = await seedStudents(tmp.pool));
    course = String((await tmp.pool.query(`insert into public.courses (code, title, kind, curriculum_id, visibility) values ('TYT-MAT', 'TYT Matematik', 'exam_track', $1, 'shared') returning id`, [tmp.curriculumId])).rows[0]!.id);
    enr = String((await tmp.pool.query(`insert into public.enrollments (student_id, curriculum_id, course_id, period_label, target_exam) values ($1, $2, $3, 'YKS 2027', 'TYT') returning id`, [elif, tmp.curriculumId, course])).rows[0]!.id);
    const gateway = new Gateway({ transport: new FakeTransport(), ledger: new PgLedger(tmp.pool) });
    const config = loadConfig({ DATABASE_URL: tmp.url, PGBOSS_SCHEMA: 'pgboss', HEALTH_HOST: '127.0.0.1', HEALTH_PORT: '0', WORKER_SCHEDULES: 'off', PDF_CONCURRENCY: '1' }, ['--process=all']);
    app = createApp(config, { log: silentLogger, db: tmp.pool, gateway: async () => gateway, storage, pdf: { render: async () => ({ pdf: Buffer.from('%PDF-1.4'), pages: 1, bytes: 8 }), close: async () => undefined } });
    await app.start();
    await tmp.pool.query(`grant usage on schema pgboss to ${MIGRATION_ROLE}; grant select on pgboss.queue to ${MIGRATION_ROLE}; grant select, insert on pgboss.job to ${MIGRATION_ROLE}`);
  }, 120_000);

  afterAll(async () => {
    if (copyEnv === undefined) delete process.env.OGRENMEN_SUGGESTIONS_COPY;
    else process.env.OGRENMEN_SUGGESTIONS_COPY = copyEnv;
    lessonServiceHooks.service = undefined;
    await app?.stop().catch(() => undefined);
    await tmp?.drop();
    svc?.kill('SIGTERM');
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('video → done: temiz etiketli transkript, analiz, eşik üstü gözlem, eşik altı kuyrukta, bildirim, hafıza', async () => {
    const up = await upload('video', video(join(work, 'ders.mp4'), { audio: true }), '.mp4', 'video/mp4');
    lessonId = await register(up, { enrollment_id: enr, title: 'Kesirlerde toplama', student_visible: true, held_at: new Date(Date.now() - 3600_000).toISOString() });
    const job = (await tmp.pool.query(`select data from pgboss.job where name = 'lesson.prepare' and data ->> 'lesson_id' = $1`, [lessonId])).rows[0];
    expect(job?.data).toMatchObject({ lesson_id: lessonId, upload_id: up, upload_kind: 'video' });

    const l = await settled(lessonId);
    const progress = l.progress as Record<string, unknown>;
    expect(progress.stage, JSON.stringify(progress)).toBe('done');
    expect(progress).toMatchObject({ frames_count: 10, frame_method: 'uniform', segments: 10, stt_provider: 'fake', audio_deleted: true, label_windows: 1, unlabeled: 0, frames_used: 10, pending: expect.any(Number), applied: expect.any(Number) });
    expect(l.status).toBe('analyzed'); // eşik altı iddia var: analiz taslakta, eğitmen incelemesi bekliyor

    // ders medyası: kareler analizden sonra, çıkarılan ses STT'den sonra silindi; ham video saklama süresince duruyor
    const prefix = `lessons/${INSTRUCTOR}/${lessonId}`;
    expect(storage.keys(`${prefix}/frames/`)).toHaveLength(0);
    expect(storage.objects.has(`${prefix}/audio.wav`)).toBe(false);
    const row = (await tmp.pool.query('select audio_path, audio_deleted_at, frames_deleted_at, retain_until, duration_sec, frames_count from public.lessons where id = $1', [lessonId])).rows[0]!;
    expect(row).toMatchObject({ audio_path: null, frames_count: 10 });
    expect(row.audio_deleted_at).not.toBeNull();
    expect(row.frames_deleted_at).not.toBeNull();
    expect(new Date(row.retain_until as string).getTime()).toBeGreaterThan(Date.now() + 80 * 86_400_000);

    // transkript: ad temizliği ve konuşmacılar
    const tr = (await tmp.pool.query('select segments, provider, labeled, segment_count from public.lesson_transcripts where lesson_id = $1', [lessonId])).rows[0]!;
    expect(tr).toMatchObject({ provider: 'fake', labeled: true, segment_count: 10 });
    const segs = tr.segments as { speaker: string; text: string }[];
    expect(segs[0]).toMatchObject({ speaker: 'EĞİTMEN', text: '[ÖĞRENCİ], bugün kesirlerde toplamaya bakalım.' });
    expect(segs.map((s) => s.speaker)).toEqual(['EĞİTMEN', 'ÖĞRENCİ', 'EĞİTMEN', 'ÖĞRENCİ', 'EĞİTMEN', 'ÖĞRENCİ', 'EĞİTMEN', 'ÖĞRENCİ', 'EĞİTMEN', 'ÖĞRENCİ']);
    expect(JSON.stringify(segs)).not.toMatch(/Elif|Kaya|Ayşe/);

    // analiz ve iddialar: rasyonel (0,8) uygulandı; denklem (0,6) ve güvensiz yanılgılar incelemede
    const an = (await tmp.pool.query('select id, status, analysis, model from public.lesson_analyses where lesson_id = $1 order by version desc', [lessonId])).rows;
    expect(an).toHaveLength(1);
    expect(an[0]!.status).toBe('draft');
    expect(an[0]!.analysis).toMatchObject({ lesson_ref: lessonId, student_ref: expect.stringMatching(/^s_/), model_notes: { frames: 10, prompt_version: 'v1' } });
    expect(JSON.stringify(an[0]!.analysis)).not.toMatch(/Elif|Kaya|Ayşe/);
    const claims = (await tmp.pool.query(`select kind, skill_id, status, confidence::float8 as c, applied_at is not null as applied from public.lesson_claims where analysis_id = $1 order by kind, skill_id`, [an[0]!.id])).rows;
    const by = (kind: string, skill?: string) => claims.filter((c) => c.kind === kind && (skill === undefined || c.skill_id === skill));
    expect(by('skill_mastery', 'tyt.mat.temel.rasyonel-sayilar')[0]).toMatchObject({ status: 'approved', applied: true, c: 0.8 });
    expect(by('skill_mastery', 'tyt.mat.cebir.denklem')[0]).toMatchObject({ status: 'pending', applied: false, c: 0.6 });
    expect(by('misconception').every((c) => c.status === 'pending' && c.c === null)).toBe(true);
    expect(by('course_insight').map((c) => c.status)).toEqual(['pending', 'pending']);
    // ödev ve sonraki adım modelin öğrenciye dönük yargısı: eğitmen görmeden onaylanmaz
    expect(by('homework')[0]).toMatchObject({ status: 'pending', c: null });
    expect(by('next_step')[0]).toMatchObject({ status: 'pending', c: null });
    expect(progress.pending).toBe(claims.filter((c) => c.status === 'pending').length);

    // öğrenen model: ders gözlemi + BKT
    const obs = (await tmp.pool.query(`select skill_id, kind, source_type from public.observations where enrollment_id = $1 and kind = 'lesson'`, [enr])).rows;
    expect(obs.map((o) => o.skill_id)).toEqual(['tyt.mat.temel.rasyonel-sayilar']);
    expect((await tmp.pool.query(`select evidence_count from public.mastery where enrollment_id = $1 and skill_id = 'tyt.mat.temel.rasyonel-sayilar'`, [enr])).rows[0]?.evidence_count).toBeGreaterThan(0);

    // eğitmen bildirimi (bekleyen iddia var), defter
    const notes = (await tmp.pool.query(`select recipient_id, title, payload from public.notifications where kind = 'lesson_review'`)).rows;
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ recipient_id: INSTRUCTOR, title: 'Ders analizi hazır: Kesirlerde toplama', payload: { lesson_id: lessonId, analysis_id: an[0]!.id } });
    const calls = (await tmp.pool.query(`select route from public.llm_calls where ref_table = 'lessons' and ref_id = $1 order by id`, [lessonId])).rows.map((r) => r.route);
    expect(calls).toEqual(['speaker_label', 'lesson_analysis']);

    // ders hafızası: onaylanmamış sonraki adım, ödev ve ders bilgisi hafızaya girmez (eğitmen onayından sonra; sonraki test)
    const early = (await tmp.pool.query(`select content from public.memory_files where student_id = $1 and path = '/memories/courses/tyt-mat.md'`, [elif])).rows[0];
    expect(String(early?.content ?? '')).not.toContain('Sonraki adım');
  }, 120_000);

  it('eğitmen eşik altını onaylar → uygulanır ve analiz onaylı; Bugün lesson_review kartı', async () => {
    const pending = (await tmp.pool.query(`select lc.id from public.lesson_claims lc join public.lesson_analyses la on la.id = lc.analysis_id where la.lesson_id = $1 and lc.status = 'pending'`, [lessonId])).rows;
    for (const c of pending) await asInstructor((q) => q('select public.review_lesson_claim($1::uuid, $2)', [c.id, 'approve']));
    expect((await tmp.pool.query('select status from public.lesson_analyses where lesson_id = $1', [lessonId])).rows[0]!.status).toBe('approved');
    // eğitmen onayından sonra sonraki adım hafızada
    const mem = await waitFor(async () => {
      const c = (await tmp.pool.query(`select content from public.memory_files where student_id = $1 and path = '/memories/courses/tyt-mat.md'`, [elif])).rows[0]?.content;
      return typeof c === 'string' && c.includes('- Sonraki adım: Paydası farklı üç kesir toplama sorusu çöz') ? c : null;
    });
    expect(mem).toContain(`<!-- ders:${lessonId} -->`);
    expect(mem).not.toMatch(/EKOK|Elif/);
    const r = await getJob('suggestions.refresh')!.handler!({ student_id: elif, reason: 'test' }, jobCtx({ db: tmp.pool }));
    expect(r).toBeDefined();
    const card = (await tmp.pool.query(`select payload from public.suggestions where student_id = $1 and kind = 'lesson_review' and consumed_at is null`, [elif])).rows[0];
    expect(card?.payload).toMatchObject({ lesson_id: lessonId });
  }, 60_000);

  it('hazır transkript yüklemesi: STT atlanır, provider upload, done', async () => {
    const vtt = Buffer.from('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<v Hoca>Elif, kesirlere bakalım.\n\n00:00:06.000 --> 00:00:08.000\nÖğrenci: Payları toplarım 4, paydaları toplarım 12, yani 4/12.\n');
    const up = await upload('transcript', vtt, '.vtt', 'text/vtt');
    const id = await register(up, { enrollment_id: enr, title: 'Transkriptli ders' });
    const l = await settled(id);
    expect((l.progress as Record<string, unknown>).stage, JSON.stringify(l.progress)).toBe('done');
    expect(l.progress).toMatchObject({ transcript_source: 'upload', transcript_segments: 2, label_windows: 0 });
    // dosya içe aktarılınca silinir (düz adlı kopya Storage'da kalmaz)
    const src = (await tmp.pool.query('select u.storage_path, l.transcript_deleted_at from public.lessons l join public.uploads u on u.id = l.transcript_upload_id where l.id = $1', [id])).rows[0]!;
    expect(storage.objects.has(`lessons/${src.storage_path as string}`)).toBe(false);
    expect(src.transcript_deleted_at).not.toBeNull();
    const tr = (await tmp.pool.query('select segments, provider from public.lesson_transcripts where lesson_id = $1', [id])).rows[0]!;
    expect(tr.provider).toBe('upload');
    expect(tr.segments).toEqual([
      { t0: 1, t1: 3, speaker: 'EĞİTMEN', text: '[ÖĞRENCİ], kesirlere bakalım.' },
      { t0: 6, t1: 8, speaker: 'ÖĞRENCİ', text: 'Payları toplarım 4, paydaları toplarım 12, yani 4/12.' },
    ]);
  }, 90_000);

  it('ses akışı olmayan video: failed + eğitmenin göreceği neden', async () => {
    const up = await upload('video', video(join(work, 'sessiz.mp4'), { audio: false, seconds: 3 }), '.mp4', 'video/mp4');
    const id = await register(up, { enrollment_id: enr });
    const l = await settled(id);
    expect(l.status).toBe('failed');
    expect(String((l.progress as Record<string, unknown>).error)).toMatch(/^Kayıt hazırlanamadı: OGR-DERS-001 kayıtta ses akışı yok/);
    expect((await tmp.pool.query('select status from public.uploads where id = $1', [up])).rows[0]!.status).toBe('failed');
  }, 60_000);

  it('lesson.retention: süresi dolan ham video Storage\'dan silinir, ders ve transkript kalır', async () => {
    const src = (await tmp.pool.query('select u.storage_path from public.lessons l join public.uploads u on u.id = l.upload_id where l.id = $1', [lessonId])).rows[0]!.storage_path as string;
    expect(storage.objects.has(`lessons/${src}`)).toBe(true);
    await tmp.pool.query(`update public.lessons set retain_until = now() - interval '1 minute' where id = $1`, [lessonId]);
    const ctx = jobCtx({ db: tmp.pool, storage: () => storage, now: () => new Date() });
    const r = (await getJob('lesson.retention')!.handler!({ limit: 100 }, ctx)) as RetentionResult;
    expect(r.deleted.video).toBe(1);
    expect(storage.objects.has(`lessons/${src}`)).toBe(false);
    const row = (await tmp.pool.query('select video_deleted_at, status from public.lessons where id = $1', [lessonId])).rows[0]!;
    expect(row.video_deleted_at).not.toBeNull();
    expect((await tmp.pool.query('select count(*)::int as n from public.lesson_transcripts where lesson_id = $1', [lessonId])).rows[0]!.n).toBe(1);
    const again = (await getJob('lesson.retention')!.handler!({ limit: 100 }, ctx)) as RetentionResult;
    expect(again.deleted.video).toBe(0);
    expect(ctx.enqueued.find((e) => e.name === 'lesson.retention')).toBeUndefined();
  }, 60_000);

  it('lesson.retention: takılan ders (processing, 2 saattir ilerlemiyor, kuyrukta işi yok) failed olur', async () => {
    const before = (await tmp.pool.query('select status, progress from public.lessons where id = $1', [lessonId])).rows[0]!;
    await tmp.pool.query(
      `update public.lessons set status = 'processing',
              progress = progress || jsonb_build_object('stage', 'stt', 'updated_at', now() - interval '3 hours') where id = $1`,
      [lessonId],
    );
    try {
      const ctx = jobCtx({ db: tmp.pool, storage: () => storage, now: () => new Date() });
      const r = (await getJob('lesson.retention')!.handler!({ limit: 100 }, ctx)) as RetentionResult;
      expect(r.stale).toBe(1);
      const row = (await tmp.pool.query('select status, progress from public.lessons where id = $1', [lessonId])).rows[0]!;
      expect(row.status).toBe('failed');
      expect(row.progress).toMatchObject({ stage: 'failed', error: 'İşlem yarıda kaldı: yeniden deneyebilirsiniz' });
    } finally {
      await tmp.pool.query('update public.lessons set status = $2, progress = $3::jsonb where id = $1', [lessonId, before.status, JSON.stringify(before.progress)]);
    }
  }, 60_000);
});
