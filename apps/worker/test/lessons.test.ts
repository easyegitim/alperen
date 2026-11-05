/**
 * P5 ders hattı birim testleri (veritabanısız): analiz bağlam denetimi, hazır transkript ayrıştırma, etiket hizalama,
 * ad temizliği, hafıza bölümü, servis istemcisi ve iş akışı (sahte veritabanı yönlendiricisi + sahte servis).
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LessonAnalysis } from '@ogrenmen/contracts';
import { FakeTransport } from '@ogrenmen/llm';
import { hms } from '@ogrenmen/prompts';
import { checkLessonAnalysis, quoteInTranscript, repairNote, settleStudentTexts } from '../src/lessons/analysis.js';
import { lessonSection, mergeSection, MAX_BYTES, MAX_SECTIONS } from '../src/lessons/memory.js';
import { buildNameHashes, nameLeaks, scrubText } from '../src/lessons/names.js';
import { createLessonService, LessonServiceError, lessonServiceHooks, type LessonService } from '../src/lessons/service.js';
import { alignLabels, parseTime, parseTranscriptFile } from '../src/lessons/transcript.js';
import { derivedPrefix, FRAME_MAX_BYTES, frameBlocks, FRAMES_BASE64_BUDGET, framePaths, LESSON_JOBS, LESSON_QUEUES, runAnalyse, runLabel, runPrepare, runRetention, runStt, STALE_HOURS } from '../src/jobs/lessons.js';
import { SCHEDULES } from '../src/schedules.js';
import { getJob } from '../src/jobs/registry.js';
import { PermanentJobError } from '../src/jobs/errors.js';
import { REQUIRED_QUEUES } from '../src/startup-checks.js';
import { lessonBucketMimes, MemoryStorage, StorageMimeError } from './lesson-storage.js';
import { jobCtx, routedDb, type Route } from './support.js';

const ROOT = join(__dirname, '..', '..', '..');
const FX = JSON.parse(readFileSync(join(ROOT, 'packages/llm/fixtures/lesson_analysis/02-ders-v2.json'), 'utf8')).output as LessonAnalysis;
const TR = (JSON.parse(readFileSync(join(ROOT, 'fixtures/ders/lesson-01.transcript.json'), 'utf8')).segments as { t: string; t_end: string; text: string }[]);
const LESSON = '00000000-0000-4000-8000-0000000000d1';
const NAMES = buildNameHashes([
  { role: 'ÖĞRENCİ', name: 'Elif Kaya' },
  { role: 'EĞİTMEN', name: 'Ayşe Hoca' },
  { role: 'VELİ', name: 'Murat Kaya' },
]);
const TEXTS = TR.map((s) => scrubText(s.text, NAMES).text);
const ctxFor = (over: Partial<Parameters<typeof checkLessonAnalysis>[1]> = {}) => ({
  lessonRef: LESSON, studentRef: 's_qk7m2rx4tn5a', durationMin: 1, maxSec: 20, texts: TEXTS,
  leaves: new Set(['tyt.mat.temel.rasyonel-sayilar', 'tyt.mat.cebir.denklem']), openMisconceptionIds: new Set<string>(), names: NAMES, ...over,
});

describe('ad temizliği (packages/pii)', () => {
  it('öğrenci, eğitmen ve veli adları rol yer tutucusuna; son kemer sayar', () => {
    expect(NAMES.people).toEqual({ student: 1, instructor: 1, guardian: 1 });
    expect(scrubText('Elif, bugün kesirlere bakalım.', NAMES).text).toBe('[ÖĞRENCİ], bugün kesirlere bakalım.');
    expect(scrubText('ELİF ile Murat Bey konuştu', NAMES).text).toContain('[VELİ]');
    expect(nameLeaks('Ayşe hocam anlamadım', NAMES)).toBe(1);
    expect(nameLeaks('[ÖĞRENCİ] 3/4 + 1/8', NAMES)).toBe(0);
    // aynı token iki rolde: öğrenci önce gelir (Kaya)
    expect(NAMES.roleHashes[NAMES.nameHashes[1]!]).toBe('ÖĞRENCİ');
  });
});

describe('analiz bağlam denetimi', () => {
  it('fikstür olduğu gibi geçer; kimlik alanları hattın', () => {
    const { analysis, report } = checkLessonAnalysis({ ...FX, lesson_ref: '00000000-0000-0000-0000-000000000009', student_ref: 's_zzzzzzzzzzzz' }, ctxFor());
    expect(report).toEqual({ quotesDropped: 0, itemsDropped: 0, namesScrubbed: 0, studentTextIssues: [] });
    expect(analysis.lesson_ref).toBe(LESSON);
    expect(analysis.student_ref).toBe('s_qk7m2rx4tn5a');
    expect(analysis.skills.map((s) => s.skill_id)).toEqual(['tyt.mat.temel.rasyonel-sayilar', 'tyt.mat.cebir.denklem']);
    expect(analysis.course_insights.map((c) => c.kind)).toEqual(['syllabus_topic', 'assignment']);
  });

  it('uydurma alıntı ve yaprak olmayan kazanım düşer; kısaltmalı alıntı geçer; süre dışı zaman düşer', () => {
    const a = structuredClone(FX);
    a.skills[1]!.evidence = [{ speaker: 'ÖĞRENCİ', quote: 'Bunu ben hiç söylemedim.', t: '00:00:16' }];
    a.misconceptions[0]!.evidence[0]!.quote = 'Payları toplarım 4 … yani 4/12';
    a.questions.push({ t: '00:00:10', quote: 'Neden on iki değil?', answered: false });
    a.hesitations.push({ t: '00:09:00', kind: 'long_silence' });
    a.misconceptions.push({ ...a.misconceptions[0]!, skill_id: 'tyt.mat.temel' });
    const { analysis, report } = checkLessonAnalysis(a, ctxFor());
    expect(analysis.skills.map((s) => s.skill_id)).toEqual(['tyt.mat.temel.rasyonel-sayilar']);
    expect(analysis.misconceptions).toHaveLength(2);
    expect(analysis.questions).toHaveLength(1);
    expect(analysis.hesitations).toHaveLength(2);
    expect(report.quotesDropped).toBe(2);
    expect(report.itemsDropped).toBe(4);
    expect(quoteInTranscript('paylari toplarım', TEXTS.map((t) => t.toLocaleLowerCase('tr')))).toBe(false);
    expect(quoteInTranscript('PAYLARI TOPLARIM 4,', TEXTS.map((t) => t.toLocaleLowerCase('tr')))).toBe(true);
  });

  it('model metnindeki ad temizlenir; öğrenci metninde öngörü ve ünlem onarım ister', () => {
    const a = structuredClone(FX);
    a.next_step = { for_student: 'Bu sınavda kesin çıkacak, çalış!', for_instructor: 'Elif ile ortak paydayı tekrar edin.' };
    a.previous_profile_check = [{ misconception_id: '00000000-0000-4000-8000-0000000000aa', status: 'improved' }, { misconception_id: '00000000-0000-4000-8000-0000000000bb', status: 'still_present' }];
    const { analysis, report } = checkLessonAnalysis(a, ctxFor({ openMisconceptionIds: new Set(['00000000-0000-4000-8000-0000000000aa']) }));
    expect(analysis.next_step.for_instructor).toBe('[ÖĞRENCİ] ile ortak paydayı tekrar edin.');
    expect(report.namesScrubbed).toBe(1);
    expect(analysis.previous_profile_check.map((p) => p.misconception_id)).toEqual(['00000000-0000-4000-8000-0000000000aa']);
    expect(report.studentTextIssues).toEqual(['next_step.for_student: öngörü ya da güvence sözü ("sınavda kesin çıkacak")', 'next_step.for_student: ünlem']);
    expect(repairNote(report.studentTextIssues)).toContain('- next_step.for_student: ünlem');
  });

  it('olağan pedagoji serbest ("önce sonucu tahmin et"); yalnız sınav/sonuç öngörüsü ve güvence yakalanır', () => {
    const ok = (t: string) => {
      const a = structuredClone(FX);
      a.next_step = { ...a.next_step, for_student: t };
      return checkLessonAnalysis(a, ctxFor()).report.studentTextIssues;
    };
    expect(ok('Önce sonucu tahmin et, sonra işlemi yap ve tahminini kontrol et.')).toEqual([]);
    expect(ok('Kesirleri kesin bir sırayla topla: önce ortak payda.')).toEqual([]);
    expect(ok('Bu konu sınavda çıkacak, iyi çalış.')).toHaveLength(1);
    expect(ok('Böyle yaparsan kesinlikle geçersin.')).toHaveLength(1);
    expect(ok('Başarı garantili bir yöntem.')).toHaveLength(1);
    expect(ok('Net tahmini: on iki.')).toHaveLength(1);
  });

  it('onarımdan sonra da sorun kalırsa: sorunlu söz çıkar, inceleme metinleri ünlemsiz kalır', () => {
    const a = structuredClone(FX);
    a.commitments = [
      { who: 'EĞİTMEN', kind: 'promise', text: 'Sınavda kesin çıkacak dedi.', t: '00:00:18' },
      { who: 'ÖĞRENCİ', kind: 'homework', text: 'On soru çöz!', t: '00:00:18' },
    ];
    a.next_step = { ...a.next_step, for_student: 'Çalış!' };
    const { report } = checkLessonAnalysis(a, ctxFor());
    const s = settleStudentTexts(a, report.studentTextIssues);
    expect(s.dropped).toBe(1);
    expect(s.held).toBe(2);
    expect(s.analysis.commitments).toEqual([{ who: 'ÖĞRENCİ', kind: 'homework', text: 'On soru çöz.', t: '00:00:18' }]);
    expect(s.analysis.next_step.for_student).toBe('Çalış.');
  });
});

describe('hazır transkript ve etiket hizalama', () => {
  it('JSON, WebVTT, SRT ve konuşmacılı düz metin', () => {
    expect(parseTime('01:02:03,500')).toBe(3723.5);
    expect(parseTime('02:03')).toBe(123);
    const json = parseTranscriptFile(Buffer.from(JSON.stringify({ segments: TR })), { path: 'a.json' });
    expect(json).toHaveLength(TR.length);
    expect(json[3]).toEqual({ t0: 6, t1: 8, speaker: 'ÖĞRENCİ', text: TR[3]!.text });
    const vtt = parseTranscriptFile('WEBVTT\n\n00:00:01.000 --> 00:00:03.500\n<v Hoca>Kesirlere bakalım\n\n00:00:04.000 --> 00:00:05.000\nÖğrenci: Tamam\n');
    expect(vtt).toEqual([
      { t0: 1, t1: 3.5, speaker: 'EĞİTMEN', text: 'Kesirlere bakalım' },
      { t0: 4, t1: 5, speaker: 'ÖĞRENCİ', text: 'Tamam' },
    ]);
    const srt = parseTranscriptFile('1\n00:00:01,000 --> 00:00:02,000\nmerhaba\n\n2\n00:00:02,000 --> 00:00:03,000\nnasılsın\n');
    expect(srt.map((s) => s.text)).toEqual(['merhaba', 'nasılsın']);
    const txt = parseTranscriptFile('[00:01] EĞİTMEN: başlayalım\nÖğrenci: hazırım\n\n');
    expect(txt).toEqual([
      { t0: 1, t1: 1, speaker: 'EĞİTMEN', text: 'başlayalım' },
      { t0: 1, t1: 1, speaker: 'ÖĞRENCİ', text: 'hazırım' },
    ]);
  });

  it('hizalama: sayı eşitse sırayla, değilse başlangıç zamanıyla', () => {
    const input = [{ t0: 0 }, { t0: 2 }, { t0: 4 }];
    expect(alignLabels(input, [{ t: '00:00:00', speaker: 'EĞİTMEN' }, { t: 'x', speaker: 'ÖĞRENCİ' }, { t: 'y', speaker: 'EĞİTMEN' }], hms).speakers).toEqual(['EĞİTMEN', 'ÖĞRENCİ', 'EĞİTMEN']);
    expect(alignLabels(input, [{ t: '00:00:02', speaker: 'ÖĞRENCİ' }], hms)).toEqual({ speakers: [null, 'ÖĞRENCİ', null], matched: 1 });
  });
});

describe('ders hafızası', () => {
  const claims = [
    { kind: 'course_insight', value: { kind: 'syllabus_topic', topic: 'Kesirlerde toplama', text: 'Ortak payda işlendi.' }, skill_name: null },
    { kind: 'next_step', value: { for_student: 'Üç kesir sorusu çöz.', for_instructor: 'EKOK ile bağla.' }, skill_name: null },
    { kind: 'talk', value: { student_ratio: 0.4 }, skill_name: null },
  ];
  it('öğrenciye açık derste sonraki adım girer, eğitmen metni girmez', () => {
    const s = lessonSection({ lessonId: LESSON, heldAt: '2026-11-03T15:00:00Z', title: 'Kesirler', studentVisible: true }, claims)!;
    expect(s).toContain('## 3 Kasım 2026 dersi: Kesirler');
    expect(s).toContain('- İşlenen konu: Kesirlerde toplama. Ortak payda işlendi.');
    expect(s).toContain('- Sonraki adım: Üç kesir sorusu çöz.');
    expect(s).not.toContain('EKOK');
    const hidden = lessonSection({ lessonId: LESSON, heldAt: '2026-11-03T15:00:00Z', title: null, studentVisible: false }, claims)!;
    expect(hidden).not.toContain('Sonraki adım');
    expect(lessonSection({ lessonId: LESSON, heldAt: '2026-11-03T15:00:00Z', title: null, studentVisible: false }, [claims[2]!])).toBeNull();
  });

  it('gizli derste yalnız işlenen konu girer: ödev, sınav notu, kaynak ve ders başlığı girmez', () => {
    const insights = [
      claims[0]!,
      { kind: 'course_insight', value: { kind: 'assignment', text: 'Sayfa 40 bitirilecek.' }, skill_name: null },
      { kind: 'course_insight', value: { kind: 'exam_hint', text: 'Sınavda grafik sorusu çıkacak.' }, skill_name: null },
      { kind: 'homework', value: { text: 'On soru.' }, skill_name: null },
    ];
    const hidden = lessonSection({ lessonId: LESSON, heldAt: '2026-11-03T15:00:00Z', title: 'Gizli başlık', studentVisible: false }, insights)!;
    expect(hidden).toContain('- İşlenen konu: Kesirlerde toplama');
    expect(hidden).toContain('## 3 Kasım 2026 dersi\n');
    for (const x of ['Gizli başlık', 'Ödev', 'Sayfa 40', 'sınav notu', 'grafik', 'On soru']) expect(hidden).not.toContain(x);
    expect(lessonSection({ lessonId: LESSON, heldAt: '2026-11-03T15:00:00Z', title: 'Gizli başlık', studentVisible: false }, insights.slice(1))).toBeNull();
    const open = lessonSection({ lessonId: LESSON, heldAt: '2026-11-03T15:00:00Z', title: 'Açık', studentVisible: true }, insights)!;
    expect(open).toContain('Hocanın sınav notu: Sınavda grafik sorusu çıkacak.');
    expect(open).toContain('## 3 Kasım 2026 dersi: Açık');
  });

  it('bölüm değiştirilir, en yeni üstte, sınırlar uygulanır', () => {
    const sec = (id: string, body: string) => `<!-- ders:${id} -->\n## d\n- ${body}\n<!-- /ders -->`;
    const ids = Array.from({ length: 10 }, (_, i) => `00000000-0000-4000-8000-0000000000${String(10 + i)}`);
    let file: string | null = null;
    for (const id of ids) file = mergeSection(file, '# Ders notları', id, sec(id, 'x'));
    expect([...file!.matchAll(/<!-- ders:/g)]).toHaveLength(MAX_SECTIONS);
    expect(file!.indexOf(ids[9]!)).toBeLessThan(file!.indexOf(ids[8]!));
    const again = mergeSection(file, '# Ders notları', ids[9]!, sec(ids[9]!, 'güncel'));
    expect(again).toContain('- güncel');
    expect([...again!.matchAll(new RegExp(ids[9]!, 'g'))]).toHaveLength(1);
    const big = mergeSection(null, '# h', ids[0]!, sec(ids[0]!, 'y'.repeat(4000)));
    const bigger = mergeSection(big, '# h', ids[1]!, sec(ids[1]!, 'z'.repeat(4000)));
    expect(Buffer.byteLength(bigger!, 'utf8')).toBeLessThanOrEqual(MAX_BYTES);
    expect(bigger).not.toContain(ids[0]!);
  });
});

describe('servis istemcisi', () => {
  it('4xx kalıcı, 5xx ve bağlantı hatası geçici; sır başlığı', async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') });
      if (String(url).endsWith('/prepare')) return new Response(JSON.stringify({ error: 'OGR-DERS-001', message: 'kayıtta ses akışı yok' }), { status: 422 });
      if (String(url).endsWith('/stt')) return new Response(JSON.stringify({ error: 'OGR-DERS-008', message: 'Groq STT başarısız' }), { status: 502 });
      if (String(url).endsWith('/cleanup')) throw new TypeError('fetch failed');
      return new Response(JSON.stringify({ ok: true, ffmpeg: true, stt: 'fake', storage: false, work_dir: '/tmp/x' }));
    }) as typeof fetch;
    const svc = createLessonService({ LESSON_SERVICE_URL: 'http://ders:8711/', LESSON_SERVICE_TOKEN: 'gizli' }, fetchImpl);
    expect(svc.url).toBe('http://ders:8711');
    expect((await svc.health()).stt).toBe('fake');
    const e1 = await svc.prepare({ lesson_id: LESSON }).catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(LessonServiceError);
    expect((e1 as LessonServiceError).permanent).toBe(true);
    const e2 = await svc.stt({ lesson_id: LESSON }).catch((e: unknown) => e);
    expect((e2 as LessonServiceError).permanent).toBe(false);
    await expect(svc.cleanup(LESSON)).rejects.toThrow(/ulaşılamadı/);
    expect(seen.every((s) => s.auth === 'Bearer gizli')).toBe(true);
  });
});

describe('kayıt defteri', () => {
  it('ders işleri kayıtlı ve gerekli kuyruklarda', () => {
    for (const q of LESSON_QUEUES) {
      expect(getJob(q)).toBeDefined();
      expect(REQUIRED_QUEUES).toContain(q);
    }
    expect(LESSON_JOBS.map((j) => j.name)).toEqual([...LESSON_QUEUES]);
    expect(derivedPrefix('a1b2/ders 1.mp4', LESSON)).toBe(`a1b2/${LESSON}`);
  });
});

describe('iş akışı (sahte veritabanı + sahte servis)', () => {
  const lessonRow = (over: Record<string, unknown> = {}) => ({
    id: LESSON, enrollment_id: '00000000-0000-4000-8000-0000000000e9', course_id: '00000000-0000-4000-8000-0000000000c9', instructor_id: null,
    held_at: new Date('2026-11-03T15:00:00Z'), title: 'Kesirler', duration_sec: null, duration_min: null, status: 'processing', student_visible: true,
    auto_apply_threshold: 0.8, audio_path: null, progress: { stage: 'prepare' },
    upload: { id: '00000000-0000-4000-8000-0000000000f1', kind: 'video', storage_path: 'egitmen/ders.mp4', mime: 'video/mp4', owner_id: 'egitmen' },
    transcript_upload: null, curriculum_id: '00000000-0000-4000-8000-0000000000aa', course_code: 'TYT-MAT', course_title: 'TYT Matematik', ...over,
  });

  function fakeService(workDir: string, calls: string[]): LessonService {
    return {
      url: 'http://fake',
      health: async () => ({ ok: true, ffmpeg: true, stt: 'fake', storage: false, work_dir: workDir }),
      prepare: async (req) => {
        calls.push(`prepare:${req.local_path}`);
        const { mkdirSync, writeFileSync } = await import('node:fs');
        mkdirSync(join(workDir, LESSON, 'frames'), { recursive: true });
        writeFileSync(join(workDir, LESSON, 'audio.wav'), 'RIFF');
        writeFileSync(join(workDir, LESSON, 'frames', 'frame-01.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
        return {
          lesson_id: LESSON, duration_sec: 10.02, has_video: true, has_audio: true, method: 'uniform', stored: false,
          audio: { path: `${LESSON}/audio.wav`, bytes: 4, mime: 'audio/wav' },
          frames: [{ path: `${LESSON}/frames/frame-01.jpg`, t_sec: 0.5, t: '00:00:00', score: null, bytes: 3, mime: 'image/jpeg' }],
        };
      },
      stt: async () => {
        calls.push('stt');
        return { provider: 'fake', language: 'tr', duration_sec: 20, chunks: 1, segments: TR.map((s, i) => ({ t0: i * 2, t1: i * 2 + 2, text: s.text })) };
      },
      cleanup: async () => undefined,
    };
  }

  it('prepare (yerel kip) → kaynak çalışma köküne, ses + kare Storage\'a → stt → transkript, ses silinir → label', async () => {
    const work = mkdtempSync(join(tmpdir(), 'ders-work-'));
    const calls: string[] = [];
    const storage = new MemoryStorage();
    await storage.upload('lessons', 'egitmen/ders.mp4', Buffer.from('video'), 'video/mp4');
    let audioPath: string | null = null;
    const progress: { stage: string; counters: Record<string, unknown> }[] = [];
    const transcripts: unknown[][] = [];
    const db = routedDb([
      [/from public\.lessons l\s+left join public\.enrollments/, () => [lessonRow({ audio_path: audioPath })]],
      [/lesson_set_progress/, (v) => {
        progress.push({ stage: String(v![1]), counters: JSON.parse(String(v![2])) as Record<string, unknown> });
        if (progress.at(-1)!.counters.audio_path) audioPath = String(progress.at(-1)!.counters.audio_path);
        return [{}];
      }],
      [/write_lesson_transcript/, (v) => {
        transcripts.push(JSON.parse(String(v![1])) as unknown[]);
        return [{ r: { segments: transcripts.at(-1)!.length, labeled: false } }];
      }],
      [/lesson_mark_media_deleted/, () => [{}]],
      [/select 'ÖĞRENCİ' as role/, () => [{ role: 'ÖĞRENCİ', name: 'Elif Kaya' }, { role: 'EĞİTMEN', name: 'Ayşe Hoca' }]],
    ]);
    lessonServiceHooks.service = fakeService(work, calls);
    try {
      const ctx = jobCtx({ db, storage: () => storage });
      const r1 = await runPrepare({ lesson_id: LESSON }, ctx);
      expect(r1).toMatchObject({ stage: 'prepare', next: 'lesson.stt', counters: { duration_sec: 10, frames_count: 1, audio_path: `egitmen/${LESSON}/audio.wav` } });
      expect(calls).toEqual([`prepare:${LESSON}/source.mp4`]);
      expect(readFileSync(join(work, LESSON, 'source.mp4'), 'utf8')).toBe('video');
      // sahne karesi gerçek kovanın izin listesinden geçer (image/jpeg); ses audio/wav
      expect(storage.objects.get(`lessons/egitmen/${LESSON}/frames/frame-01.jpg`)?.type).toBe('image/jpeg');
      expect(storage.objects.get(`lessons/egitmen/${LESSON}/audio.wav`)?.type).toBe('audio/wav');
      expect(progress[1]!.counters.media_prefix).toBe(`egitmen/${LESSON}`);
      const stt = ctx.enqueued.find((e) => e.name === 'lesson.stt')!;
      expect(stt.data).toEqual({ lesson_id: LESSON, audio_path: `egitmen/${LESSON}/audio.wav`, frames: [{ path: `egitmen/${LESSON}/frames/frame-01.jpg`, t: '00:00:00', t_sec: 0.5 }] });
      // saklama işi zamanlamadan gelir (schedules.ts / pg_cron); hat kendini zincirlemez
      expect(ctx.enqueued.find((e) => e.name === 'lesson.retention')).toBeUndefined();

      const r2 = await runStt(stt.data as Parameters<typeof runStt>[0], ctx);
      expect(r2.counters).toMatchObject({ segments: TR.length, stt_provider: 'fake', audio_deleted: true });
      // ad temizliği STT'de: düz ad veritabanına hiç yazılmaz
      expect(transcripts[0]![0]).toEqual({ t0: 0, t1: 2, speaker: null, text: '[ÖĞRENCİ], bugün kesirlerde toplamaya bakalım.' });
      expect(JSON.stringify(transcripts)).not.toContain('Elif');
      expect(storage.objects.has(`lessons/egitmen/${LESSON}/audio.wav`)).toBe(false);
      expect(ctx.enqueued.at(-1)).toMatchObject({ name: 'lesson.label', data: { lesson_id: LESSON } });
      expect(progress.map((p) => p.stage)).toEqual(['prepare', 'prepare', 'stt', 'stt']);
    } finally {
      lessonServiceHooks.service = undefined;
    }
  });

  it('label: ad temizlenir, Sonnet etiketleri yerleşir; öğrencinin adı yoksa model çağrılmaz ve ders failed', async () => {
    const written: { speaker: string | null; text: string }[][] = [];
    const failed: string[] = [];
    const segs = TR.map((s, i) => ({ t0: i * 2, t1: i * 2 + 2, speaker: null, text: s.text }));
    const people = (name: string | null) => [{ role: 'ÖĞRENCİ', name }, { role: 'EĞİTMEN', name: 'Ayşe Hoca' }];
    const mk = (name: string | null) =>
      routedDb([
        [/from public\.lessons l\s+left join public\.enrollments/, () => [lessonRow()]],
        [/lesson_set_progress/, (v) => {
          if (v![1] === 'failed') failed.push(String(JSON.parse(String(v![2])).error));
          return [{}];
        }],
        [/from public\.lesson_transcripts/, () => [{ segments: segs, language: 'tr', provider: 'fake', labeled: false }]],
        [/select 'ÖĞRENCİ' as role/, () => people(name)],
        [/cross join lateral unnest\(app\.lesson_students/, () => [{ student_id: 's1', public_ref: 's_qk7m2rx4tn5a', enrollment_id: 'e1', profile_id: 'p1' }]],
        [/write_lesson_transcript/, (v) => {
          written.push(JSON.parse(String(v![1])) as { speaker: string | null; text: string }[]);
          return [{ r: { segments: segs.length, labeled: true } }];
        }],
      ]);
    const transport = new FakeTransport();
    const ctx = jobCtx({ db: mk('Elif Kaya'), transport });
    const r = await runLabel({ lesson_id: LESSON, frames: [] }, ctx);
    expect(r.counters).toMatchObject({ label_windows: 1, labeled_segments: TR.length, unlabeled: 0 });
    expect(written[0]!.map((s) => s.speaker)).toEqual(['EĞİTMEN', 'ÖĞRENCİ', 'EĞİTMEN', 'ÖĞRENCİ', 'EĞİTMEN', 'ÖĞRENCİ', 'EĞİTMEN', 'ÖĞRENCİ', 'EĞİTMEN', 'ÖĞRENCİ']);
    expect(written[0]![0]!.text).toBe('[ÖĞRENCİ], bugün kesirlerde toplamaya bakalım.');
    expect(JSON.stringify(written)).not.toContain('Elif');
    const sent = JSON.stringify(transport.requests.map((q) => q.body.messages));
    expect(sent).toContain('<lesson_transcript_window>');
    expect(sent).not.toContain('Elif');

    const t2 = new FakeTransport();
    const ctx2 = jobCtx({ db: mk(null), transport: t2 });
    await expect(runLabel({ lesson_id: LESSON, frames: [] }, ctx2)).rejects.toBeInstanceOf(PermanentJobError);
    expect(t2.requests).toHaveLength(0);
    expect(failed.at(-1)).toMatch(/^Konuşmacılar ayrılamadı: ad temizliği doğrulanamadı/);
  });
});

describe('Storage kovası ve türetilmiş medyanın silinmesi', () => {
  it('lessons kovası göçlerdeki izin listesini zorlar: sahne karesi ve ses izinli, başka tür 415', async () => {
    const mimes = lessonBucketMimes();
    for (const t of ['image/jpeg', 'audio/wav', 'audio/x-wav', 'video/mp4', 'text/vtt']) expect(mimes.has(t)).toBe(true);
    const storage = new MemoryStorage();
    await expect(storage.upload('lessons', 'a/b/frames/frame-01.png', Buffer.from('x'), 'image/png')).rejects.toBeInstanceOf(StorageMimeError);
    await storage.upload('lessons', 'a/b/frames/frame-01.jpg', Buffer.from('x'), 'image/jpeg');
    expect(framePaths('a/b')).toHaveLength(30);
    expect(framePaths('a/b')[0]).toBe('a/b/frames/frame-01.jpg');
  });
});

describe('lesson.analyse (sahte veritabanı + sahte Opus)', () => {
  const ENR = '00000000-0000-4000-8000-0000000000e9';
  const MC = '00000000-0000-4000-8000-0000000000ac';
  const segs = TR.map((s) => ({ t0: parseTime(s.t)!, t1: parseTime(s.t_end)!, speaker: null, text: s.text }));

  function analyseDb(opts: { title: string | null; fresh?: boolean; names?: boolean }) {
    const marked: string[] = [];
    const progress: { stage: string; counters: Record<string, unknown> }[] = [];
    const written: Record<string, unknown>[] = [];
    const routes: Route[] = [
      [/from public\.lessons l\s+left join public\.enrollments/, () => [{
        id: LESSON, enrollment_id: ENR, course_id: '00000000-0000-4000-8000-0000000000c9', instructor_id: null, held_at: new Date('2026-11-03T15:00:00Z'),
        title: opts.title, duration_sec: 20, duration_min: 1, status: 'processing', student_visible: true, auto_apply_threshold: 0.8, audio_path: null, frames_count: 1,
        transcript_deleted_at: null, progress: { stage: 'label', media_prefix: `egitmen/${LESSON}` },
        upload: { id: '00000000-0000-4000-8000-0000000000f1', kind: 'video', storage_path: 'egitmen/ders.mp4', mime: 'video/mp4', owner_id: 'egitmen' },
        transcript_upload: null, curriculum_id: '00000000-0000-4000-8000-0000000000aa', course_code: 'TYT-MAT', course_title: 'TYT Matematik',
      }]],
      [/from public\.lesson_analyses la\s+left join public\.lesson_transcripts/, () => (opts.fresh ? [{ id: 'an-eski', claims: 7 }] : [])],
      [/lesson_set_progress/, (v) => {
        progress.push({ stage: String(v![1]), counters: JSON.parse(String(v![2])) as Record<string, unknown> });
        return [{}];
      }],
      [/from public\.lesson_transcripts where/, () => [{ segments: segs, language: 'tr', provider: 'fake', labeled: true }]],
      [/select 'ÖĞRENCİ' as role/, () => (opts.names === false ? [{ role: 'ÖĞRENCİ', name: null }] : [{ role: 'ÖĞRENCİ', name: 'Elif Kaya' }, { role: 'EĞİTMEN', name: 'Ayşe Hoca' }])],
      [/cross join lateral unnest\(app\.lesson_students/, () => [{ student_id: 's1', public_ref: 's_qk7m2rx4tn5a', enrollment_id: ENR, profile_id: 'p1' }]],
      [/from public\.misconceptions/, () => [{ id: MC, tag: null, skill_id: 'tyt.mat.temel.rasyonel-sayilar', text_instructor: 'Elif paydaları topluyor.' }]],
      [/from public\.skills where curriculum_id/, () => [{ id: 'tyt.mat.temel.rasyonel-sayilar' }, { id: 'tyt.mat.cebir.denklem' }]],
      [/write_lesson_analysis/, (v) => {
        written.push(JSON.parse(String(v![1])) as Record<string, unknown>);
        return [{ r: { analysis_id: 'an-yeni', claims: 9, dropped: 0, reverted: 0 } }];
      }],
      [/apply_lesson_claims/, () => [{ r: { applied: 3, pending: 6, total: 9 } }]],
      [/lesson_mark_media_deleted/, (v) => {
        marked.push(String(v![1]));
        return [{}];
      }],
    ];
    return { db: routedDb(routes), marked, progress, written };
  }

  async function frameStorage(): Promise<MemoryStorage> {
    const storage = new MemoryStorage();
    await storage.upload('lessons', `egitmen/${LESSON}/frames/frame-01.jpg`, Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg');
    return storage;
  }
  const frames = [{ path: `egitmen/${LESSON}/frames/frame-01.jpg`, t: '00:00:00', t_sec: 0.5 }];

  it('öğrencinin adıyla adlandırılmış ders düşmez: başlık ve açık yanılgı metni temizlenir; kareler analizden sonra silinir', async () => {
    const t = analyseDb({ title: 'Elif ile kesirler' });
    const storage = await frameStorage();
    const transport = new FakeTransport().enqueue('lesson_analysis', { json: FX });
    const ctx = jobCtx({ db: t.db, transport, storage: () => storage });
    const r = await runAnalyse({ lesson_id: LESSON, frames }, ctx);
    expect(r).toMatchObject({ stage: 'done', counters: { claims: 9, applied: 3, pending: 6, frames_used: 1, analysis_id: 'an-yeni' } });
    const sent = JSON.stringify(transport.requests.map((q) => q.body.messages));
    expect(sent).toContain('[ÖĞRENCİ] ile kesirler');
    expect(sent).toContain('[ÖĞRENCİ] paydaları topluyor.');
    expect(sent).not.toMatch(/Elif|Kaya|Ayşe/);
    expect(JSON.stringify(t.written)).not.toMatch(/Elif|Kaya/);
    expect(t.progress.map((x) => x.stage)).toEqual(['analyse', 'apply', 'done']);
    expect(storage.keys(`lessons/egitmen/${LESSON}/frames/`)).toHaveLength(0);
    expect(t.marked).toEqual(['frames']);
  });

  it('onarım turu önceki yanıtı asistan turu olarak taşır; yine uymazsa ders düşmez, sorunlu söz çıkar', async () => {
    const bad = structuredClone(FX);
    bad.commitments = [...FX.commitments, { who: 'EĞİTMEN', kind: 'promise', text: 'Bu soru sınavda kesin çıkacak.', t: '00:00:18' }];
    const t = analyseDb({ title: 'Kesirler' });
    const transport = new FakeTransport().enqueue('lesson_analysis', { json: bad }, { json: bad });
    const r = await runAnalyse({ lesson_id: LESSON, frames: [] }, jobCtx({ db: t.db, transport }));
    expect(r.stage).toBe('done');
    expect(r.counters).toMatchObject({ repaired: true, student_text_dropped: 1 });
    expect(transport.requests).toHaveLength(2);
    const second = transport.requests[1]!.body.messages as { role: string; content: unknown }[];
    const roles = second.map((m) => m.role).filter((x) => x !== 'system');
    expect(roles.slice(0, 3)).toEqual(['user', 'assistant', 'user']);
    expect(JSON.stringify(second[1]!.content)).toContain('sınavda kesin çıkacak');
    expect(JSON.stringify(second)).toContain('ürün kurallarına uymayan');
    const analysis = t.written[0]!.analysis as { commitments: { kind: string }[] };
    expect(analysis.commitments.map((c) => c.kind)).toEqual(['homework']);
  });

  it('yazılmış analiz transkriptten yeniyse (iş yeniden denendi) model yeniden çağrılmaz, uygulamadan sürer', async () => {
    const t = analyseDb({ title: null, fresh: true });
    const transport = new FakeTransport();
    const r = await runAnalyse({ lesson_id: LESSON, frames: [] }, jobCtx({ db: t.db, transport }));
    expect(transport.requests).toHaveLength(0);
    expect(t.written).toHaveLength(0);
    expect(r).toMatchObject({ stage: 'done', counters: { resumed: true, claims: 7, analysis_id: 'an-eski', applied: 3 } });
  });

  it('düşen derste çıkarılan ses ve kareler hemen silinir', async () => {
    const t = analyseDb({ title: null, names: false });
    const storage = await frameStorage();
    await storage.upload('lessons', `egitmen/${LESSON}/audio.wav`, Buffer.from('RIFF'), 'audio/wav');
    const transport = new FakeTransport();
    await expect(runAnalyse({ lesson_id: LESSON, frames }, jobCtx({ db: t.db, transport, storage: () => storage }))).rejects.toBeInstanceOf(PermanentJobError);
    expect(transport.requests).toHaveLength(0);
    expect(t.progress.at(-1)).toMatchObject({ stage: 'failed' });
    expect(storage.keys(`lessons/egitmen/${LESSON}/`)).toHaveLength(0);
    expect(t.marked.sort()).toEqual(['audio', 'frames']);
  });
});

describe('analiz kareleri', () => {
  it('kare başına 1 MB, toplam base64 bütçesi (32 MB istek sınırı): büyük kare atlanır, bütçe dolunca kalanlar atlanır', async () => {
    const storage = new MemoryStorage();
    const refs = framePaths(`egitmen/${LESSON}`).map((path, i) => ({ path, t: hms(i), t_sec: i }));
    const big = Buffer.alloc(FRAME_MAX_BYTES + 1, 1);
    const ok = Buffer.alloc(900 * 1024, 2);
    for (const [i, r] of refs.entries()) await storage.upload('lessons', r.path, i === 0 ? big : ok, 'image/jpeg');
    const { blocks, used } = await frameBlocks(jobCtx({ storage: () => storage }), refs);
    const total = blocks.reduce((n, b) => n + b.source.data.length, 0);
    expect(total).toBeLessThanOrEqual(FRAMES_BASE64_BUDGET);
    expect(blocks.length).toBe(Math.floor(FRAMES_BASE64_BUDGET / Math.ceil((900 * 1024) / 3) / 4));
    expect(used.map((u) => u.n)).toEqual(blocks.map((_, i) => i + 1));
    expect(used[0]!.t).toBe(hms(1));
  });
});

describe('lesson.retention', () => {
  it('Storage yoksa düşer; iş kendini zincirlemez (gece zamanlaması SCHEDULES / pg_cron)', async () => {
    const db = routedDb([
      [/lesson_retention_due/, () => [{ r: [{ lesson_id: LESSON, media: 'video', bucket: 'lessons', storage_path: 'egitmen/ders.mp4', paths: ['egitmen/ders.mp4'] }] }]],
    ]);
    const ctx = jobCtx({ db, storage: () => { throw new Error('Storage yok'); } });
    await expect(runRetention({ limit: 100 }, ctx)).rejects.toBeInstanceOf(PermanentJobError);
    expect(ctx.enqueued.find((e) => e.name === 'lesson.retention')).toBeUndefined();
    expect(SCHEDULES.find((x) => x.job === 'lesson.retention')?.cron).toBe('15 4 * * *');
  });

  it('takılan ders (processing, 2 saattir ilerlemiyor, kuyrukta işi yok) failed olur; pg-boss okunamazsa yalnız süre', async () => {
    for (const bossReadable of [true, false]) {
      const failed: { id: string; error: string }[] = [];
      const sqls: string[] = [];
      const db = routedDb([
        [/where l\.status = 'processing'/, (v, text) => {
          sqls.push(String(text));
          if (/pgboss\.job/.test(String(text)) && !bossReadable) throw new Error('relation "pgboss.job" does not exist');
          expect(v).toEqual([STALE_HOURS]);
          return [{ id: LESSON }];
        }],
        [/lesson_set_progress/, (v) => {
          failed.push({ id: String(v![0]), error: String(JSON.parse(String(v![2])).error) });
          return [{}];
        }],
        [/lesson_retention_due/, () => [{ r: [] }]],
      ]);
      const r = await runRetention({ limit: 100 }, jobCtx({ db }));
      expect(r).toMatchObject({ stale: 1, due: 0 });
      expect(failed).toEqual([{ id: LESSON, error: 'İşlem yarıda kaldı: yeniden deneyebilirsiniz' }]);
      expect(sqls[0]).toMatch(/pgboss\.job j/);
      expect(sqls).toHaveLength(bossReadable ? 1 : 2);
    }
  });

  it('kareler (30 yol), ses ve transkript dosyası silinir ve işaretlenir', async () => {
    const storage = new MemoryStorage();
    for (const p of framePaths(`egitmen/${LESSON}`).slice(0, 3)) await storage.upload('lessons', p, Buffer.from('x'), 'image/jpeg');
    await storage.upload('lessons', 'egitmen/ders.vtt', Buffer.from('WEBVTT'), 'text/vtt');
    const marked: string[] = [];
    const db = routedDb([
      [/lesson_retention_due/, () => [{ r: [
        { lesson_id: LESSON, media: 'frames', bucket: 'lessons', storage_path: `egitmen/${LESSON}/frames`, paths: framePaths(`egitmen/${LESSON}`) },
        { lesson_id: LESSON, media: 'transcript_file', bucket: 'lessons', storage_path: 'egitmen/ders.vtt', paths: ['egitmen/ders.vtt'] },
      ] }]],
      [/lesson_mark_media_deleted/, (v) => {
        marked.push(String(v![1]));
        return [{}];
      }],
      [/select exists/, () => [{ p: false }]],
    ]);
    const ctx = jobCtx({ db, storage: () => storage });
    const r = await runRetention({ limit: 100 }, ctx);
    expect(r.deleted).toMatchObject({ frames: 1, transcript_file: 1, video: 0, audio: 0 });
    expect(storage.objects.size).toBe(0);
    expect(marked).toEqual(['frames', 'transcript_file']);
    expect(ctx.enqueued.find((e) => e.name === 'lesson.retention')).toBeUndefined();
  });
});
