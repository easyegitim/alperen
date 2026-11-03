import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FakeTransport } from '@ogrenmen/llm';
import { getJob } from '../src/jobs/registry.js';
import { acceptableCopy, copyModeFromEnv, writeCopy } from '../src/suggestions/copy.js';
import {
  consumedRefsOf,
  cardExpiry,
  endOfIstanbulDay,
  MAX_NOTICES,
  MAX_SUGGESTIONS,
  planSuggestions,
  reviewIntervalDays,
  shortName,
  UPLOAD_CARD,
  uploadNotice,
  type EnrollmentSignals,
  type StudentSignals,
} from '../src/suggestions/rules.js';
import { jobCtx, routedDb } from './support.js';

const fixture = (): StudentSignals => JSON.parse(readFileSync(new URL('./fixtures/suggestions/signals.json', import.meta.url), 'utf8')) as StudentSignals;
const expected = JSON.parse(readFileSync(new URL('./fixtures/suggestions/expected.json', import.meta.url), 'utf8')) as Record<string, unknown>[];
const ENR = '00000000-0000-4000-8000-0000000000e9';
const enr = (s: StudentSignals): EnrollmentSignals => s.enrollments[0]!;

describe('öneri kuralları (fixture → beklenen 3 kart)', () => {
  it('alıştırma (kahraman) + aralıklı tekrar + ders tekrarı; ertesi gün 05:00te düşer', () => {
    const cards = planSuggestions(fixture());
    expect(cards.map(({ kind, rank, title, subtitle, payload }) => ({ kind, rank, title, subtitle, payload }))).toEqual(expected);
    for (const c of cards) {
      expect(c.enrollment_id).toBe(ENR);
      expect(c.expires_at).toBe('2026-11-04T02:00:00.000Z'); // 2026-11-04 05:00 Europe/Istanbul: gece yenilemesinden (03:30) sonra
    }
  });

  it('deterministik: aynı sinyal aynı kartlar', () => {
    expect(planSuggestions(fixture())).toEqual(planSuggestions(fixture()));
  });

  it('(1) eğitmen ödevi varsa kahraman o; alıştırma aynı yaprağı yinelemez', () => {
    const s = fixture();
    enr(s).homework = [
      { refId: 'n1', source: 'note', skillIds: ['tyt.mat.temel.rasyonel-sayilar'], skillNames: ['Rasyonel sayılarda dört işlem ve sıralama'], createdAt: '2026-11-02T08:00:00Z' },
    ];
    const cards = planSuggestions(s);
    expect(cards[0]).toMatchObject({ kind: 'weekly_homework', rank: 0, title: 'Haftalık ödev', payload: { source: 'note', ref_id: 'n1', count: 10 } });
    const practice = cards.find((c) => c.kind === 'practice')!;
    expect(practice.rank).toBe(10);
    expect(practice.payload.skill_ids).toEqual(['tyt.mat.temel.sayilar', 'tyt.mat.temel.ebob-ekok']);
    // başlatılmış ödev yeniden önerilmez
    s.consumedRefs = ['note:n1'];
    expect(planSuggestions(s).some((c) => c.kind === 'weekly_homework')).toBe(false);
  });

  it('(2) kanıt yoksa ağaçtaki ilk 2 yaprak (ilk test); bugün çalışılan yapraklar geri planda', () => {
    const s = fixture();
    enr(s).leaves = [];
    enr(s).lessonReview = null;
    const first = planSuggestions(s);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ kind: 'practice', rank: 0, payload: { reason: 'starter', skill_ids: ['tyt.mat.temel.sayilar', 'tyt.mat.temel.bolunebilme'] } });

    const t = fixture();
    t.practicedToday = ['tyt.mat.temel.rasyonel-sayilar', 'tyt.mat.temel.sayilar'];
    expect(planSuggestions(t)[0]!.payload.skill_ids).toEqual(['tyt.mat.temel.ebob-ekok', 'tyt.mat.temel.uslu']);
  });

  it('(3) açık yanılgı: eksik analizi yanılgının yaprağı + asıl sorun ön koşulu', () => {
    const s = fixture();
    enr(s).topMisconception = {
      tag: 'ebob-ekok.karistirma', skillId: 'tyt.mat.temel.ebob-ekok', skillName: 'EBOB–EKOK ve problemleri',
      prereqSkillId: 'tyt.mat.temel.bolunebilme', prereqName: 'Bölünebilme kuralları, kalan',
    };
    const gap = planSuggestions(s).find((c) => c.kind === 'gap_analysis')!;
    expect(gap).toMatchObject({ title: 'Eksik analizi', payload: { reason: 'misconception', misconception_tag: 'ebob-ekok.karistirma', skill_ids: ['tyt.mat.temel.ebob-ekok', 'tyt.mat.temel.bolunebilme'] } });
  });

  it('(5) sınava 0–14 gün: mini deneme; bugün başlatıldıysa yeniden yok', () => {
    const s = fixture();
    enr(s).examDate = '2026-11-13';
    const mini = planSuggestions(s).find((c) => c.kind === 'mini_exam')!;
    expect(mini).toMatchObject({ subtitle: 'Sınava 10 gün kaldı · 20 soru · 30 dk', payload: { days_left: 10, count: 20 } });
    enr(s).examDate = '2026-11-30';
    expect(planSuggestions(s).some((c) => c.kind === 'mini_exam')).toBe(false);
    enr(s).examDate = '2026-11-03';
    s.consumedRefs = [`mini_exam:${ENR}:2026-11-03`];
    expect(planSuggestions(s).some((c) => c.kind === 'mini_exam')).toBe(false);
  });

  it('(6)(7) hazır belge ve yükleme sonucu; başlatılanlar düşer; en çok 10 kart, rank artan', () => {
    const s = fixture();
    s.documents = [{ documentId: 'd1', kind: 'notes', title: 'Rasyonel sayılar', enrollmentId: ENR, updatedAt: '2026-11-02T10:00:00Z' }];
    s.uploads = [
      { ref: 'analysis:a1', analysisId: 'a1', sessionId: null, uploadId: 'u1', enrollmentId: ENR, verdict: 'wrong', at: '2026-11-02T18:00:00Z', net: null },
      { ref: 'session:s1', analysisId: null, sessionId: 's1', uploadId: null, enrollmentId: ENR, verdict: null, at: '2026-11-02T17:00:00Z', net: 22.5 },
    ];
    const cards = planSuggestions(s);
    expect(cards.find((c) => c.kind === 'document_ready')).toMatchObject({ title: 'Rasyonel sayılar notun hazır', payload: { document_id: 'd1' } });
    // en çok 2 bildirim; türler sırayla (ikinci yükleme belgeyi gölgelemez)
    expect(cards.filter((c) => c.kind === 'upload_result' || c.kind === 'document_ready').map((c) => c.key)).toEqual(['analysis:a1', 'document:d1']);
    expect(cards.filter((c) => c.kind === 'upload_result').map((c) => c.subtitle)).toEqual(['Takıldığın adımı buldum']);
    s.consumedRefs = ['document:d1', 'analysis:a1'];
    expect(planSuggestions(s).map((c) => c.key)).not.toContain('document:d1');
    expect(planSuggestions(s).map((c) => c.key)).not.toContain('analysis:a1');
    expect(planSuggestions(s).find((c) => c.key === 'session:s1')?.subtitle).toBe('Okul denemen değerlendirildi · 22,5 net');
    const ranks = cards.map((c) => c.rank);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    expect(cards.length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
    for (const c of cards) {
      expect(c.title.length).toBeLessThanOrEqual(120);
      expect(c.subtitle.length).toBeLessThanOrEqual(160);
      expect(`${c.title}${c.subtitle}`).not.toMatch(/[!%]/);
    }
  });

  it('(7) yükleme kartı worker kartıyla aynı: anahtar, başlık, alt satır (one_line); bekleyen ve düşen yükleme de kart', () => {
    const s = fixture();
    s.uploads = [
      { ref: 'analysis:a1', state: 'result', analysisId: 'a1', sessionId: null, uploadId: 'u1', uploadIds: ['u1', 'u2'], enrollmentId: ENR, verdict: 'wrong', oneLine: 'Çözümünü inceledim: 3. adımda işlem kuralı.', at: '2026-11-02T18:00:00Z', net: null },
      { ref: 'upload:u9', state: 'failed', analysisId: null, sessionId: null, uploadId: 'u9', uploadIds: ['u9'], enrollmentId: ENR, verdict: null, failure: 'processing', reason: 'OGR-JOB-145', at: '2026-11-02T17:00:00Z', net: null },
    ];
    const cards = planSuggestions(s).filter((c) => c.kind === 'upload_result');
    expect(cards.map((c) => [c.key, c.title, c.subtitle])).toEqual([
      ['analysis:a1', UPLOAD_CARD.result, 'Çözümünü inceledim: 3. adımda işlem kuralı.'],
      ['upload:u9', UPLOAD_CARD.failed.processing.title, UPLOAD_CARD.failed.processing.subtitle],
    ]);
    expect(cards[0]!.payload).toEqual(uploadNotice(s.uploads[0]!).payload);
    expect(cards[1]!.payload).toMatchObject({ upload_id: 'u9', failed: true, failure: 'processing' });
    // bekleyen okul denemesi: upload:<ilk yükleme>; açılması sonraki değerlendirme kartını (session:<id>) gizlemez
    const pending = uploadNotice({ ref: 'upload:u5', state: 'pending', analysisId: null, sessionId: 's5', examId: 'e5', uploadId: 'u5', enrollmentId: ENR, verdict: null, at: '2026-11-02T17:00:00Z', net: null });
    expect(pending).toMatchObject({ key: 'upload:u5', title: UPLOAD_CARD.pending.title, payload: { pending: true, session_id: 's5', exam_id: 'e5' } });
    const c = consumedRefsOf([{ kind: 'upload_result', enrollment_id: ENR, payload: pending.payload, consumed_at: '2026-11-03T08:00:00Z' }]);
    expect(c.refs).toEqual(['upload:u5']);
    // okunamayan teşhis: worker'ın başlığı
    expect(uploadNotice({ ...s.uploads[0]!, verdict: 'unreadable', oneLine: null }).title).toBe(UPLOAD_CARD.unreadable);
  });

  it('bildirim bandı ayrı: başlatılabilir kartlar doluyken de yükleme sonucu ve not kartı kalır', () => {
    const s = fixture();
    enr(s).homework = [{ refId: 'n1', source: 'note', skillIds: ['tyt.mat.temel.uslu'], skillNames: ['Üslü ifadeler'], createdAt: '2026-11-02T08:00:00Z' }];
    enr(s).examDate = '2026-11-10';
    // ikinci kayıt: dört başlatılabilir kart daha
    s.enrollments.push({ ...structuredClone(enr(s)), enrollmentId: '00000000-0000-4000-8000-0000000000e8' });
    s.documents = [{ documentId: 'd1', kind: 'notes', title: 'Rasyonel sayılar', enrollmentId: ENR, updatedAt: '2026-11-02T10:00:00Z' }];
    s.uploads = [{ ref: 'analysis:a1', analysisId: 'a1', sessionId: null, uploadId: 'u1', enrollmentId: ENR, verdict: 'wrong', at: '2026-11-02T18:00:00Z', net: null }];
    const cards = planSuggestions(s);
    const startable = cards.filter((c) => c.kind !== 'upload_result' && c.kind !== 'document_ready');
    expect(startable.length).toBeGreaterThanOrEqual(4);
    expect(cards.filter((c) => c.kind === 'upload_result')).toHaveLength(1);
    expect(cards.filter((c) => c.kind === 'document_ready')).toHaveLength(1);
    expect(cards.length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
    expect(cards.length - startable.length).toBeLessThanOrEqual(MAX_NOTICES);
  });

  it('başlatılmış öneri satırları → kaynak anahtarları', () => {
    const c = consumedRefsOf([
      { kind: 'weekly_homework', enrollment_id: ENR, payload: { source: 'note', ref_id: 'n1', skill_ids: ['a'] }, consumed_at: '2026-11-03T06:00:00Z' },
      { kind: 'document_ready', enrollment_id: null, payload: { document_id: 'd1' }, consumed_at: '2026-10-30T06:00:00Z' },
      { kind: 'mini_exam', enrollment_id: ENR, payload: {}, consumed_at: '2026-11-02T22:30:00Z' },
      { kind: 'practice', enrollment_id: ENR, payload: { skill_ids: ['b', 'c'] }, consumed_at: '2026-11-03T07:00:00Z' },
      { kind: 'practice', enrollment_id: ENR, payload: { skill_ids: ['z'] }, consumed_at: '2026-11-01T07:00:00Z' },
    ]);
    expect(c.refs).toEqual(['document:d1', `mini_exam:${ENR}:2026-11-03`, 'note:n1']);
    expect(c.practicedToday('2026-11-03')).toEqual(['a', 'b', 'c']);
  });

  it('yardımcılar: gün sonu, tekrar aralığı, kısa ad', () => {
    expect(endOfIstanbulDay('2026-12-31')).toBe('2026-12-31T21:00:00.000Z');
    expect(cardExpiry('2026-12-31')).toBe('2027-01-01T02:00:00.000Z');
    expect([0.6, 0.8, 0.95].map(reviewIntervalDays)).toEqual([2, 5, 12]);
    expect(shortName('Sayı kümeleri, işlem önceliği, işaret kuralları')).toBe('Sayı kümeleri');
  });
});

describe('kart metni (suggestions_copy)', () => {
  const cards = () => planSuggestions(fixture());

  it('sahte kipte şablon; OGRENMEN_SUGGESTIONS_COPY ile seçilebilir', () => {
    expect(copyModeFromEnv({ OGRENMEN_LLM: 'fake' })).toBe('template');
    expect(copyModeFromEnv({})).toBe('llm');
    expect(copyModeFromEnv({ OGRENMEN_LLM: 'fake', OGRENMEN_SUGGESTIONS_COPY: 'llm' })).toBe('llm');
  });

  it('sayıları değiştiren, ünlemli ya da uzun metin kabul edilmez', () => {
    const c = cards()[0]!;
    expect(acceptableCopy(c, 'Rasyonel sayılar', '8 soru · 12 dk')).toBe(true);
    expect(acceptableCopy(c, 'Rasyonel sayılar', '10 soru · 12 dk')).toBe(false);
    expect(acceptableCopy(c, 'Hadi başla!', '8 soru · 12 dk')).toBe(false);
    expect(acceptableCopy(c, 'x'.repeat(121), '8 soru · 12 dk')).toBe(false);
    // uydurma sayı ve emoji
    expect(acceptableCopy(c, 'Rasyonel sayılar', '8 soru · 12 dk · 4 sayfalık not')).toBe(false);
    expect(acceptableCopy(c, 'Rasyonel sayılar', '8 soru · 12 dk 🚀')).toBe(false);
    expect(acceptableCopy(c, 'Rasyonel sayılar', '8 soru · 12 dk · sıra sende ✨')).toBe(false);
  });

  it('LLM kipi: Haiku metni kabul edilir; kurala uymayan şablona döner; önceki metin yeniden kullanılır', async () => {
    const transport = new FakeTransport();
    transport.enqueue(
      'suggestions_copy',
      { json: { title: 'Rasyonel sayılar', body: '8 soru · 12 dk, iki zayıf konun', action_label: 'Başla' } },
      { json: { title: 'Tekrar zamanı', body: 'Yaş problemlerinden 9 soru', action_label: null } },
    );
    const ctx = jobCtx({ transport });
    const list = cards();
    const prev = new Map([[list[2]!.key, { title: list[2]!.title, subtitle: 'Çarşamba dersinden 5 soru · 15 dk' }]]);
    const out = await writeCopy(list, { mode: 'llm', gateway: ctx.gateway, system: { text: 'Kart metni yaz.', version: 'v1' }, studentRef: 's_qk7m2rx4tn5a', previous: prev });
    expect(out.map((o) => o.source)).toEqual(['llm', 'fallback', 'reused']);
    expect(out[0]).toMatchObject({ title: 'Rasyonel sayılar', subtitle: '8 soru · 12 dk, iki zayıf konun' });
    expect(out[1]).toMatchObject({ title: 'Tekrar zamanı', subtitle: 'Yaş problemleri · 8 soru · 12 dk' });
    expect(out[2]).toMatchObject({ title: list[2]!.title, subtitle: 'Çarşamba dersinden 5 soru · 15 dk' });
    const reqs = transport.requests.filter((r) => r.route === 'suggestions_copy');
    expect(reqs).toHaveLength(2);
    expect(reqs[0]!.body.model).toBe('claude-haiku-5-5');
    expect(ctx.ledger.rows.every((r) => r.route === 'suggestions_copy' && r.student_ref === 's_qk7m2rx4tn5a')).toBe(true);
  });

  it('kutu kartında LLM yalnız alt satırı yazar; başlık şablon etiketi kalır', async () => {
    const transport = new FakeTransport();
    transport.enqueue('suggestions_copy', { json: { title: 'Yaş problemlerinde tablo kurarak hızlanma zamanı geldi', body: 'Yaş problemlerinden 8 soru · 12 dk', action_label: null } });
    const ctx = jobCtx({ transport });
    const box = cards()[1]!;
    expect(box.rank).not.toBe(0);
    const out = await writeCopy([box], { mode: 'llm', gateway: ctx.gateway, system: { text: 'Kart metni yaz.', version: 'v1' }, studentRef: 's_qk7m2rx4tn5a' });
    expect(out[0]).toMatchObject({ source: 'llm', title: box.title, subtitle: 'Yaş problemlerinden 8 soru · 12 dk' });
  });

  it('LLM çağrısı düşerse şablon', async () => {
    const transport = new FakeTransport();
    transport.enqueue('suggestions_copy', { stopReason: 'refusal', text: '' });
    const ctx = jobCtx({ transport });
    const out = await writeCopy(cards().slice(0, 1), { mode: 'llm', gateway: ctx.gateway, system: { text: 'Kart metni yaz.', version: 'v1' } });
    expect(out[0]).toMatchObject({ source: 'fallback', title: 'Rasyonel sayılarda dört işlem ve sıralama' });
  });
});

describe('suggestions.refresh işi (sahte veritabanı)', () => {
  it('yüksüz: etkin kaydı olan her öğrenci için öğrenci başına tekil iş açar', async () => {
    const db = routedDb([[/select distinct e\.student_id/, () => [{ student_id: 'a' }, { student_id: 'b' }]]]);
    const ctx = jobCtx({ db });
    const res = await getJob('suggestions.refresh')!.handler!({}, ctx);
    expect(res).toEqual({ mode: 'fanout', students: 2 });
    expect(ctx.enqueued.map((e) => [e.name, e.data, e.opts?.singletonKey])).toEqual([
      ['suggestions.refresh', { student_id: 'a', reason: 'nightly' }, 'suggestions:a'],
      ['suggestions.refresh', { student_id: 'b', reason: 'nightly' }, 'suggestions:b'],
    ]);
  });

  it('öğrenci: replace_suggestions tek çağrı; copy_key payload\'a yazılır', async () => {
    const sid = '00000000-0000-4000-8000-0000000000aa';
    let items: unknown[] = [];
    const db = routedDb([
      [/select public_ref from public\.students/, () => [{ public_ref: 's_qk7m2rx4tn5a' }]],
      [/from public\.enrollments e left join public\.courses/, () => [{ id: ENR, curriculum_id: 'cur', course_id: null, exam_date: '2026-11-10', target_exam: 'TYT', course_title: 'TYT Matematik' }]],
      [/with recursive t/, () => [{ id: 'tyt.mat.temel.sayilar', name: 'Sayı kümeleri, işlem önceliği' }]],
      [/replace_suggestions/, (v) => {
        items = JSON.parse(String(v?.[1])) as unknown[];
        return [{ n: items.length }];
      }],
    ]);
    const ctx = jobCtx({ db });
    const res = await getJob('suggestions.refresh')!.handler!({ student_id: sid, reason: 'practice.finished' }, ctx);
    expect(res).toMatchObject({ mode: 'student', written: 2, kinds: ['practice', 'mini_exam'], copy: { template: 2 } });
    expect(items[0]).toMatchObject({ kind: 'practice', rank: 0, title: 'Sayı kümeleri', subtitle: '8 soru · 12 dk', enrollment_id: ENR, payload: { copy_key: `practice:${ENR}:tyt.mat.temel.sayilar` } });
    expect(items[1]).toMatchObject({ kind: 'mini_exam', subtitle: 'Sınava 7 gün kaldı · 20 soru · 30 dk' });
    expect(ctx.ledger.rows).toHaveLength(0); // sahte kipte LLM çağrısı yok
  });
});
