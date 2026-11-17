// Dersler (P5-C) saf kuralları: dosya türü/boyut, nesne adı, eylem girdisi doğrulaması, aşama kelimeleri, zaman biçimi,
// iddia metni/güven kelimesi, RPC yanıt ayrıştırma ve öğrenci cümlesi.
import { describe, expect, it } from 'vitest';
import {
  LESSON_MAX_BYTES,
  checkLessonFile,
  claimText,
  confidenceWord,
  formatBytes,
  formatClock,
  formatDuration,
  formatHeld,
  isStalled,
  isWorking,
  lessonFileInfo,
  lessonName,
  lessonObjectPath,
  parseLessonList,
  parseRegister,
  parseStaffView,
  parseStudentLessons,
  parseStudentView,
  stageLine,
  STALLED_MS,
  stageProgress,
  studentLessonSentence,
} from '@/server/lessons/shared';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('dosya kuralları', () => {
  it('uzantıdan tür ve MIME çıkarır (tarayıcı türü boş bırakabilir)', () => {
    expect(lessonFileInfo('Ders 12.MP4')).toEqual({ ext: 'mp4', mime: 'video/mp4', kind: 'video' });
    expect(lessonFileInfo('kayit.m4a')).toEqual({ ext: 'm4a', mime: 'audio/mp4', kind: 'audio' });
    expect(lessonFileInfo('ders.srt')).toEqual({ ext: 'srt', mime: 'application/x-subrip', kind: 'transcript' });
    expect(lessonFileInfo('not.pdf')).toBeNull();
    expect(lessonFileInfo('uzantisiz')).toBeNull();
  });

  it('5 GB sınırı ve boş dosya', () => {
    expect(checkLessonFile({ name: 'a.mp4', size: LESSON_MAX_BYTES }).ok).toBe(true);
    const big = checkLessonFile({ name: 'a.mp4', size: LESSON_MAX_BYTES + 1 });
    expect(big.ok).toBe(false);
    expect(!big.ok && big.message).toMatch(/5 GB/);
    expect(checkLessonFile({ name: 'a.mp4', size: 0 }).ok).toBe(false);
    expect(checkLessonFile({ name: 'a.exe', size: 10 }).ok).toBe(false);
  });

  it('nesne adı yükleyenin klasöründe', () => {
    expect(lessonObjectPath(U(1), U(2), 'mp4')).toBe(`${U(1)}/${U(2)}.mp4`);
    expect(() => lessonObjectPath('x', U(2), 'mp4')).toThrow();
    expect(() => lessonObjectPath(U(1), U(2), '../x')).toThrow();
  });

  it('bayt biçimi', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536 * 1024)).toBe('1,5 MB');
    expect(formatBytes(1.4 * 1024 ** 3)).toBe('1,4 GB');
  });
});

describe('parseRegister', () => {
  const base = { uploadId: U(2), path: `${U(1)}/${U(2)}.mp4`, mime: 'video/mp4', bytes: 1000, kind: 'video', enrollmentId: U(3), title: '  Ders 12 ', heldAt: '2026-10-29T14:00:00Z', transcript: null };
  it('geçerli girdiyi alır, başlığı kırpar', () => {
    const r = parseRegister(base, U(1));
    expect(r.ok && r.value.title).toBe('Ders 12');
    expect(r.ok && r.value.heldAt).toBe('2026-10-29T14:00:00.000Z');
  });
  it('başkasının klasörüne işaret eden yolu reddeder', () => {
    expect(parseRegister({ ...base, path: `${U(9)}/${U(2)}.mp4` }, U(1)).ok).toBe(false);
    expect(parseRegister({ ...base, path: `${U(1)}/${U(8)}.mp4` }, U(1)).ok).toBe(false);
  });
  it('izin verilmeyen MIME, kimlik ve tür', () => {
    expect(parseRegister({ ...base, mime: 'application/pdf' }, U(1)).ok).toBe(false);
    expect(parseRegister({ ...base, enrollmentId: 'x' }, U(1)).ok).toBe(false);
    expect(parseRegister({ ...base, kind: 'photo' }, U(1)).ok).toBe(false);
    expect(parseRegister({ ...base, heldAt: 'dün' }, U(1)).ok).toBe(false);
    expect(parseRegister(null, U(1)).ok).toBe(false);
  });
  it('eşlik eden transkripti doğrular', () => {
    const tr = { uploadId: U(4), path: `${U(1)}/${U(4)}.vtt`, mime: 'text/vtt', bytes: 20 };
    const r = parseRegister({ ...base, transcript: tr }, U(1));
    expect(r.ok && r.value.transcript?.uploadId).toBe(U(4));
    expect(parseRegister({ ...base, transcript: { ...tr, path: `${U(9)}/${U(4)}.vtt` } }, U(1)).ok).toBe(false);
  });
});

describe('aşamalar ve biçim', () => {
  it('aşama kelimeyle; yüzde yazılmaz', () => {
    expect(stageLine('stt')).toBe('Yazıya çevriliyor');
    expect(stageLine('failed')).toBe('İşlenemedi');
    expect(stageLine(null)).toBe('Sıraya alındı');
    expect(stageProgress('prepare')).toBeLessThan(stageProgress('analyse'));
    expect(stageProgress('done')).toBe(100);
    expect(stageProgress('failed')).toBe(0);
  });
  it('işleniyor mu', () => {
    expect(isWorking('processing', 'stt')).toBe(true);
    expect(isWorking('processing', 'done')).toBe(false);
    expect(isWorking('analyzed', 'done')).toBe(false);
    expect(isWorking('failed', 'stt')).toBe(false);
    expect(isWorking('uploaded', null)).toBe(true);
  });
  it('saat ve süre', () => {
    expect(formatClock(872)).toBe('14:32');
    expect(formatClock(3872)).toBe('1:04:32');
    expect(formatClock(null)).toBe('');
    expect(formatDuration(2880)).toBe('48 dk');
    expect(formatDuration(5400)).toBe('1 sa 30 dk');
    expect(formatDuration(0)).toBe('');
  });
  it('tarih İstanbul saatiyle', () => {
    expect(formatHeld('2026-10-29T14:00:00Z')).toBe('29 Eki 2026, 17:00');
    expect(formatHeld('2026-10-29T14:00:00Z', false)).toBe('29 Eki 2026');
    expect(formatHeld(null)).toBe('');
  });
  it('ders adı', () => {
    expect(lessonName({ no: 12, title: 'Mutlak değer' })).toBe('Ders 12 · Mutlak değer');
    expect(lessonName({ no: 3, title: null })).toBe('Ders 3');
  });
});

describe('takılan ders', () => {
  it('processing ve 2 saattir ilerleme yok: Yeniden dene açılır; taze ya da düşmüş/biten ders değil', () => {
    const now = Date.parse('2026-11-04T12:00:00Z');
    const old = { updated_at: new Date(now - STALLED_MS - 1000).toISOString() };
    const fresh = { updated_at: new Date(now - 60_000).toISOString() };
    expect(isStalled('processing', old, now)).toBe(true);
    expect(isStalled('processing', fresh, now)).toBe(false);
    expect(isStalled('failed', old, now)).toBe(false);
    expect(isStalled('analyzed', old, now)).toBe(false);
    expect(isStalled('processing', {}, now)).toBe(false);
  });
});

describe('iddia metni ve güven', () => {
  it('güven kelimeyle', () => {
    expect(confidenceWord(0.95)).toBe('Güven yüksek');
    expect(confidenceWord(0.8)).toBe('Güven iyi');
    expect(confidenceWord(0.74)).toBe('Güven orta');
    expect(confidenceWord(0.4)).toBe('Güven düşük');
    expect(confidenceWord(null)).toBe('Güven belirtilmedi');
  });
  const base = { value: null, edited_value: null, misconception_tag: null, skill_name: null };
  it('türe göre cümle; düzeltilmiş değer önceliklidir', () => {
    expect(claimText({ ...base, kind: 'skill_mastery', value: { mastery_estimate: 0.9 } })).toMatch(/iyi/);
    expect(claimText({ ...base, kind: 'skill_mastery', value: { mastery_estimate: 0.9 }, edited_value: { mastery_estimate: 0.3 } })).toMatch(/zayıf/);
    expect(claimText({ ...base, kind: 'followup', value: { status: 'improved' } })).toMatch(/düzelmiş/);
    expect(claimText({ ...base, kind: 'hesitation', value: { kind: 'long_silence' } })).toMatch(/sessizlik/);
    expect(claimText({ ...base, kind: 'homework', value: { text: 'Sayfa 40' } })).toBe('Sayfa 40');
    expect(claimText({ ...base, kind: 'misconception', misconception_tag: 'abs_one_sided' })).toBe('abs_one_sided');
  });
});

describe('RPC yanıtları', () => {
  const row = { id: U(1), no: 12, title: null, held_at: '2026-10-29T14:00:00Z', duration_sec: 2880, status: 'analyzed', stage: 'done', error: null, student_visible: false, enrollment_id: U(2), course_id: U(3), course_title: 'TYT Matematik', student: { id: U(4), name: 'Elif K.' }, transcript_ready: true, claims: { total: 6, pending: 3, applied: 3 } };
  it('personel listesi', () => {
    expect(parseLessonList([row])[0]!.claims?.pending).toBe(3);
    expect(parseLessonList(null)).toEqual([]);
    expect(() => parseLessonList([{ ...row, id: 'x' }])).toThrow();
  });
  it('öğrenci listesi', () => {
    expect(parseStudentLessons([{ id: U(1), no: 1, title: null, held_at: null, duration_sec: null, summary_ready: true }])).toHaveLength(1);
    expect(() => parseStudentLessons([row])).toThrow(); // personel biçimi öğrenci olarak okunmaz
  });
  it('personel görünümü', () => {
    const v = parseStaffView({
      role: 'staff',
      lesson: { ...row, progress: { stage: 'done' }, auto_apply_threshold: 0.8, retain_until: null, video_deleted_at: null, audio_deleted_at: null, instructor: null, can_manage: true },
      transcript: { segments: [{ t0: 0, t1: 3, speaker: 'EĞİTMEN', text: 'Merhaba' }], language: 'tr', provider: 'fake', labeled: true, segment_count: 1 },
      analysis: { id: U(5), version: 1, status: 'draft' },
      claims: [],
      counts: { total: 0, pending: 0, applied: 0, rejected: 0 },
    });
    expect(v.transcript?.segments[0]!.speaker).toBe('EĞİTMEN');
    expect(v.lesson.auto_apply_threshold).toBe(0.8);
  });
  it('öğrenci cümlesi: sonraki adım, yoksa konular, yoksa hazırlanıyor', () => {
    const mk = (summary: Record<string, unknown>) => parseStudentView({ role: 'student', lesson: { id: U(1), no: 1, title: null, held_at: null, duration_sec: null }, summary });
    expect(studentLessonSentence(mk({ ready: true, next_step: 'Cuma günü iki taraflı yazımı tekrar et.', topics: ['Mutlak değer'], homework: [] }))).toBe('Cuma günü iki taraflı yazımı tekrar et.');
    expect(studentLessonSentence(mk({ ready: true, next_step: null, topics: ['Mutlak değer', 'Eşitsizlik'], homework: [] }))).toBe('Konuştuklarımız: Mutlak değer, Eşitsizlik.');
    expect(studentLessonSentence(mk({ ready: true, next_step: null, topics: [], homework: [{ text: 'Sayfa 40', due: null }] }))).toBe('Ödev: Sayfa 40');
    expect(studentLessonSentence(mk({ ready: false, next_step: null, topics: [], homework: [] }))).toBe('Özet hazırlanıyor.');
    expect(studentLessonSentence(null)).toBe('Özet hazırlanıyor.');
  });
});
