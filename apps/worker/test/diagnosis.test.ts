/**
 * Yükle → Teşhis hattı (sahte veritabanı + sahte Anthropic taşıması): upload.intake yönlendirmesi, diagnosis.run'ın
 * Files API / teşhis çağrısı / doğrulama / apply_diagnosis / Bugün kartı adımları ve doğrulama kuralları.
 * Gerçek satırlar (observations, mastery, RLS) test/diagnosis.live.test.ts'te.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SolutionDiagnosis } from '@ogrenmen/contracts';
import { FakeTransport, ParseError, RouteConfigError } from '@ogrenmen/llm';
import {
  cardExpiry,
  diagnosisOneLine,
  diagnosisUserBlocks,
  embedDiagnosisText,
  FAILURE_CARDS,
  isMissingFileError,
  isReadingFailure,
  proposalForApply,
  validateDiagnosis,
  type CurriculumIndex,
} from '../src/jobs/diagnosis.js';
import { PermanentJobError } from '../src/jobs/errors.js';
import { getJob, validateRegistry } from '../src/jobs/registry.js';
import { SCHOOL_EXAM_CARD, schoolExamTitle } from '../src/jobs/upload-intake.js';
import { silentLogger } from '../src/log.js';
import { jobCtx, routedDb, type Route } from './support.js';

const FIXTURE = join(__dirname, 'fixtures', 'diagnosis', '01-dagilma-isaret.json');
const fixture = (): SolutionDiagnosis => JSON.parse(readFileSync(FIXTURE, 'utf8')) as SolutionDiagnosis;

const STUDENT = '00000000-0000-4000-8000-000000000051';
const OTHER = '00000000-0000-4000-8000-000000000052';
const OWNER = '00000000-0000-4000-8000-0000000000e1';
const ENR = '00000000-0000-4000-8000-0000000000a1';
const CUR = '00000000-0000-4000-8000-0000000000c1';
const UP1 = '00000000-0000-4000-8000-0000000000b1';
const UP2 = '00000000-0000-4000-8000-0000000000b2';

const index = (): CurriculumIndex => ({
  nodes: new Map([
    ['tyt.mat.temel', { name: 'Temel matematik', isLeaf: false, parentId: null }],
    ['tyt.mat.temel.sayilar', { name: 'Sayı kümeleri, işlem önceliği, işaret kuralları', isLeaf: true, parentId: 'tyt.mat.temel' }],
    ['tyt.mat.cebir', { name: 'Cebir', isLeaf: false, parentId: null }],
    ['tyt.mat.cebir.denklem', { name: 'Birinci dereceden denklemler', isLeaf: true, parentId: 'tyt.mat.cebir' }],
  ]),
  tags: new Map([
    ['sayilar.parantez-eksi-dagitma', 'tyt.mat.temel.sayilar'],
    ['denklem.taraf-degistirme-isaret', 'tyt.mat.cebir.denklem'],
  ]),
});

describe('validateDiagnosis (PLAN-v2 §3.1 adım 3)', () => {
  it('geçerli teşhis olduğu gibi geçer', () => {
    const v = validateDiagnosis(fixture(), index());
    expect(v.issues).toEqual([]);
    expect(v.diagnosis.skill_ids).toEqual(['tyt.mat.cebir.denklem', 'tyt.mat.temel.sayilar']);
    expect(v.diagnosis.misconception_tags).toEqual(['sayilar.parantez-eksi-dagitma']);
    expect(v.diagnosis.failing_step_no).toBe(3);
  });

  it('müfredatta olmayan kazanım ve ara düğüm düşer, bilinmeyen etiket düşer', () => {
    const d = { ...fixture(), skill_ids: ['tyt.mat.temel', 'tyt.mat.yok.boyle', 'tyt.mat.temel.sayilar'], misconception_tags: ['uydurma.etiket', 'sayilar.parantez-eksi-dagitma'] };
    const v = validateDiagnosis(d, index());
    expect(v.diagnosis.skill_ids).toEqual(['tyt.mat.temel.sayilar']);
    expect(v.diagnosis.misconception_tags).toEqual(['sayilar.parantez-eksi-dagitma']);
    expect(v.dropped).toEqual({ skill_ids: ['tyt.mat.temel', 'tyt.mat.yok.boyle'], misconception_tags: ['uydurma.etiket'], proposed_subskill: false });
    expect(v.issues.join(' | ')).toMatch(/ara düğüm.*müfredatta yok.*katalogda yok/);
  });

  it('hiç geçerli kazanım kalmazsa en derin üst düğümün altına alt kazanım önerir', () => {
    const v = validateDiagnosis({ ...fixture(), skill_ids: ['tyt.mat.cebir.denklem-sistemi'] }, index());
    expect(v.diagnosis.skill_ids).toEqual([]);
    expect(v.diagnosis.proposed_subskill).toMatchObject({ code: 'tyt.mat.cebir.denklem-sistemi', parent_code: 'tyt.mat.cebir' });
    // ad okunur (kod parçası değil)
    expect(v.diagnosis.proposed_subskill!.name).toBe('Önerilen alt kazanım: Cebir');
  });

  it('öneri yükü apply_proposal biçiminde: parent_id (+ kod üst düğümün altındaysa id)', () => {
    expect(proposalForApply(null)).toBeNull();
    expect(proposalForApply({ code: 'tyt.mat.cebir.denklem-sistemi', name: 'Denklem sistemleri', parent_code: 'tyt.mat.cebir', description: 'x' })).toEqual({
      parent_id: 'tyt.mat.cebir',
      name: 'Denklem sistemleri',
      description: 'x',
      code: 'tyt.mat.cebir.denklem-sistemi',
      id: 'tyt.mat.cebir.denklem-sistemi',
    });
    // kod başka dalda: kimliği RPC türetir
    expect(proposalForApply({ code: 'tyt.mat.x.y', name: 'Y', parent_code: 'tyt.mat.cebir', description: '' })).not.toHaveProperty('id');
  });

  it('süresi dolmuş Files API kimliği tanınır (404 ya da dosya bulunamadı 400\'ü)', () => {
    expect(isMissingFileError(Object.assign(new Error('not found'), { status: 404 }))).toBe(true);
    expect(isMissingFileError(Object.assign(new Error('400 file_id file_abc not found'), { status: 400 }))).toBe(true);
    expect(isMissingFileError(Object.assign(new Error('max_tokens'), { status: 400 }))).toBe(false);
    expect(isMissingFileError(new Error('x', { cause: Object.assign(new Error('gone'), { status: 404 }) }))).toBe(true);
  });

  it('üst düğümü olmayan önerilen alt kazanım düşer', () => {
    const v = validateDiagnosis(
      { ...fixture(), skill_ids: [], proposed_subskill: { code: 'ayt.fiz.x', name: 'x', parent_code: 'ayt.fiz', description: 'x' } },
      index(),
    );
    expect(v.dropped.proposed_subskill).toBe(true);
    expect(v.diagnosis.proposed_subskill).toBeNull();
    expect(v.issues.at(-1)).toBe('geçerli kazanım yok: gözlem yazılmaz');
  });

  it('failing_step_no adım listesinde yoksa ilk hatalı adıma çekilir; doğru çözümde neden ve etiket temizlenir', () => {
    const d = fixture();
    const v = validateDiagnosis({ ...d, failing_step_no: 9 }, index());
    expect(v.diagnosis.failing_step_no).toBe(3);
    const ok = validateDiagnosis(
      { ...d, verdict: 'correct', failing_step_no: null, error_cause: null, student_steps: d.student_steps.map((s) => ({ ...s, status: 'ok' as const })) },
      index(),
    );
    expect(ok.diagnosis.misconception_tags).toEqual([]);
    expect(ok.diagnosis.error_cause).toBeNull();
  });

  it('yanlış çözümde neden yoksa procedure varsayılır', () => {
    const v = validateDiagnosis({ ...fixture(), error_cause: null }, index());
    expect(v.diagnosis.error_cause).toBe('procedure');
  });
});

describe('kopya ve içerik blokları', () => {
  it('tek cümle: bozulan adım + neden; doğru ve okunamayan ayrı', () => {
    expect(diagnosisOneLine({ verdict: 'wrong', failing_step_no: 3, error_cause: 'procedure' })).toBe('Çözümünü inceledim: 3. adımda işlem kuralı.');
    expect(diagnosisOneLine({ verdict: 'wrong', failing_step_no: 2, error_cause: 'careless' })).toBe('Çözümünü inceledim: 2. adımda küçük bir hesap kayması.');
    expect(diagnosisOneLine({ verdict: 'correct', failing_step_no: null, error_cause: null })).toBe('Çözümünü inceledim: yolun baştan sona doğru.');
    expect(diagnosisOneLine({ verdict: 'unreadable', failing_step_no: null, error_cause: null })).toMatch(/okunamadı/);
    expect(diagnosisOneLine({ verdict: 'incomplete', failing_step_no: 4, error_cause: 'time' })).toBe('Çözümünü inceledim: 4. adımda süre yetmemiş.');
    // adım yoksa "son. adımda" gibi bozuk ek yok
    expect(diagnosisOneLine({ verdict: 'incomplete', failing_step_no: null, error_cause: 'time' })).toBe('Çözümünü inceledim: süre yetmemiş.');
    for (const line of [diagnosisOneLine({ verdict: 'incomplete', failing_step_no: 4, error_cause: 'time' })]) {
      expect(line).not.toMatch(/[!%]/);
      expect(line.length).toBeLessThanOrEqual(160);
    }
  });

  it('görsel image, PDF document bloğu olur (Files API file_id; citations yok)', () => {
    const blocks = diagnosisUserBlocks([
      { upload: { mime: 'image/jpeg', kind: 'photo' }, fileId: 'file_1' },
      { upload: { mime: 'application/pdf', kind: 'pdf' }, fileId: 'file_2' },
    ]);
    expect(blocks[0]).toEqual({ type: 'image', source: { type: 'file', file_id: 'file_1' } });
    expect(blocks[1]).toMatchObject({ type: 'document', source: { type: 'file', file_id: 'file_2' } });
    expect(JSON.stringify(blocks)).not.toContain('citations');
    expect(blocks.at(-1)).toMatchObject({ type: 'text' });
  });

  it('kart ertesi İstanbul gününün sonunda düşer', () => {
    expect(cardExpiry(new Date('2026-11-03T20:30:00Z'))).toBe('2026-11-04T21:00:00.000Z'); // 23:30 TRT
    expect(cardExpiry(new Date('2026-11-03T21:30:00Z'))).toBe('2026-11-05T21:00:00.000Z'); // ertesi gün 00:30 TRT
  });

  it('okul denemesi başlığı ve kartı ünlemsiz, tek cümle', () => {
    expect(schoolExamTitle(new Date('2026-11-03T09:00:00Z'))).toBe('Okul denemesi · 3 Kas');
    expect(`${SCHOOL_EXAM_CARD.title} ${SCHOOL_EXAM_CARD.subtitle}`).not.toMatch(/!/);
  });

  it('gömme: VOYAGE_API_KEY yoksa atlanır; varsa 1024 boyutlu vektör döner', async () => {
    expect(await embedDiagnosisText('metin', {})).toBeNull();
    const vec = Array.from({ length: 1024 }, (_, i) => i / 1024);
    let sent: { url: string; body: Record<string, unknown> } | null = null;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      sent = { url, body: JSON.parse(String(init.body)) as Record<string, unknown> };
      return new Response(JSON.stringify({ data: [{ embedding: vec }] }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await embedDiagnosisText('metin', { VOYAGE_API_KEY: 'test-key-not-secret' }, fakeFetch)).toHaveLength(1024);
    expect(sent!.body).toMatchObject({ output_dimension: 1024, input: ['metin'] });
  });
});

/** diagnosis.run için sahte veritabanı: kayıt, yüklemeler, müfredat, apply_diagnosis. */
function diagnosisDb(opts: { studentOf?: string; prevAnalysis?: boolean; raw?: Record<string, unknown>; applyFails?: boolean } = {}) {
  const routes: Route[] = [
    [/from audit\.events/, () => (opts.raw ? [{ diff: opts.raw }] : [])],
    [/from public\.enrollments e join public\.students/, () => [{ id: ENR, student_id: STUDENT, curriculum_id: CUR, course_id: null, public_ref: 's_testabcdefgh' }]],
    [/from public\.uploads where id = any/, () => [
      { id: UP1, student_id: opts.studentOf ?? STUDENT, owner_id: OWNER, kind: 'photo', storage_path: `${OWNER}/${UP1}.jpg`, mime: 'image/jpeg', status: 'processing', anthropic_file_id: null },
      { id: UP2, student_id: opts.studentOf ?? STUDENT, owner_id: OWNER, kind: 'photo', storage_path: `${OWNER}/${UP2}.jpg`, mime: 'image/jpeg', status: 'processing', anthropic_file_id: 'file_onceden' },
    ]],
    [/from public\.solution_analyses/, () => (opts.prevAnalysis ? [{ id: 'sa-eski', verdict: 'wrong' }] : [])],
    [/from public\.skills where curriculum_id/, () => [...index().nodes].map(([id, n]) => ({ id, name: n.name, is_leaf: n.isLeaf, parent_id: n.parentId }))],
    [/from public\.misconception_tags/, () => [...index().tags].map(([tag, skill_id]) => ({ tag, skill_id }))],
    [/public\.apply_diagnosis/, () => {
      if (opts.applyFails) throw new Error('OGR-PROP-001 add_subskill: parent_id (müfredatta) ve name gerekli');
      return [{ id: 'sa-yeni' }];
    }],
  ];
  return routedDb(routes);
}

describe('diagnosis.run (sahte taşıma)', () => {
  it('kayıtlı iş: Files API → teşhis → doğrulama → apply_diagnosis → kart → ready', async () => {
    expect(validateRegistry()).toEqual([]);
    const db = diagnosisDb();
    const transport = new FakeTransport().enqueue('solution_diagnosis', { json: { ...fixture(), misconception_tags: ['sayilar.parantez-eksi-dagitma', 'uydurma.etiket'] } });
    const ctx = jobCtx({ db, transport });
    const res = await getJob('diagnosis.run')!.handler!({ upload_ids: [UP1, UP2], enrollment_id: ENR }, ctx);

    expect(res).toMatchObject({ analysisId: 'sa-yeni', verdict: 'wrong', reused: false, fileIds: [`fake-file-${UP1.slice(0, 8)}`, 'file_onceden'], embedded: false });
    // Files API kimliği yalnız eksik olana yazılır
    const fileUpdates = db.calls.filter((c) => /set anthropic_file_id/.test(c.text));
    expect(fileUpdates.map((c) => c.values)).toEqual([[UP1, `fake-file-${UP1.slice(0, 8)}`]]);

    // teşhis isteği: Opus, iki görsel bloğu file_id ile, sıcaklık yok, biçimli çıktı
    const req = transport.requests.find((r) => r.route === 'solution_diagnosis')!;
    expect(req.body.model).toBe('claude-opus-5-5');
    expect(req.body).not.toHaveProperty('temperature');
    const user = req.body.messages.find((m) => m.role === 'user')!;
    const blocks = user.content as { type: string; source?: { file_id?: string } }[];
    expect(blocks.filter((b) => b.type === 'image').map((b) => b.source?.file_id)).toEqual([`fake-file-${UP1.slice(0, 8)}`, 'file_onceden']);
    expect(req.body.output_config?.format).toBeTruthy();

    // apply_diagnosis girdisi: bilinmeyen etiket düştü, adımlar analysis.steps'te
    const applyCall = db.calls.find((c) => /apply_diagnosis/.test(c.text))!;
    const input = JSON.parse(String(applyCall.values![0])) as Record<string, unknown> & { analysis: Record<string, unknown> };
    expect(input).toMatchObject({
      enrollment_id: ENR,
      upload_ids: [UP1, UP2],
      verdict: 'wrong',
      error_cause: 'procedure',
      failing_step_no: 3,
      skill_ids: ['tyt.mat.cebir.denklem', 'tyt.mat.temel.sayilar'],
      misconception_tags: ['sayilar.parantez-eksi-dagitma'],
      model: 'claude-opus-5-5',
    });
    expect(input).not.toHaveProperty('embedding');
    expect(input.analysis).toMatchObject({ one_line: 'Çözümünü inceledim: 3. adımda işlem kuralı.', validation: { dropped: { misconception_tags: ['uydurma.etiket'] } } });
    expect((input.analysis.steps as unknown[]).length).toBe(5);

    // Bugün kartı + durum
    const card = db.calls.find((c) => /insert into public\.suggestions/.test(c.text))!;
    expect(card.values!.slice(0, 4)).toEqual([STUDENT, ENR, 'Yüklemenin sonucu hazır', 'Çözümünü inceledim: 3. adımda işlem kuralı.']);
    // öneri motorunun anahtarı (analysis:<id>) ve alt satırı: suggestions.refresh kartı silmez, yerinde günceller
    expect(JSON.parse(String(card.values![4]))).toMatchObject({ upload_id: UP1, upload_ids: [UP1, UP2], analysis_id: 'sa-yeni', copy_key: 'analysis:sa-yeni' });
    expect(card.values![5]).toBe('analysis:sa-yeni');
    const statuses = db.calls.filter((c) => /update public\.uploads set status/.test(c.text)).map((c) => c.values![1]);
    expect(statuses).toEqual(['processing', 'ready']);
    // defter: tek ücretli çağrı, öğrenci kimliği public_ref
    expect(ctx.ledger.rows.map((r) => [r.route, r.student_ref])).toEqual([['solution_diagnosis', 's_testabcdefgh']]);
  });

  it('aynı yükleme kümesi ikinci kez teşhis edilmez', async () => {
    const transport = new FakeTransport();
    const ctx = jobCtx({ db: diagnosisDb({ prevAnalysis: true }), transport });
    const res = await getJob('diagnosis.run')!.handler!({ upload_ids: [UP1, UP2], enrollment_id: ENR }, ctx);
    expect(res).toMatchObject({ analysisId: 'sa-eski', reused: true });
    expect(transport.requests).toHaveLength(0);
  });

  it('başka öğrencinin yüklemesi kalıcı hata', async () => {
    const ctx = jobCtx({ db: diagnosisDb({ studentOf: OTHER }) });
    await expect(getJob('diagnosis.run')!.handler!({ upload_ids: [UP1, UP2], enrollment_id: ENR }, ctx)).rejects.toMatchObject({ code: 'OGR-JOB-142' });
  });

  it('model reddederse yüklemeler failed, "yeniden çek" kartı, kalıcı hata', async () => {
    const db = diagnosisDb();
    const transport = new FakeTransport().enqueue('solution_diagnosis', { text: '', stopReason: 'refusal', stopDetails: { category: 'cyber' } });
    const ctx = jobCtx({ db, transport });
    const err = await getJob('diagnosis.run')!.handler!({ upload_ids: [UP1, UP2], enrollment_id: ENR }, ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PermanentJobError);
    expect((err as PermanentJobError).code).toBe('OGR-JOB-143');
    expect(db.calls.some((c) => /apply_diagnosis/.test(c.text))).toBe(false);
    const statuses = db.calls.filter((c) => /update public\.uploads set status/.test(c.text)).map((c) => c.values![1]);
    expect(statuses.at(-1)).toBe('failed');
    const card = db.calls.find((c) => /insert into public\.suggestions/.test(c.text))!;
    expect(card.values![2]).toBe('Fotoğrafı okuyamadım');
    expect(JSON.parse(String(card.values![4]))).toMatchObject({ failed: true, failure: 'reading', copy_key: `upload:${UP1}` });
    // kalıcı neden kartın dışında da saklanır (öneri motoru kartı buradan yeniden kurar)
    const failed = db.calls.find((c) => /app\.audit_event\('diagnosis\.failed'/.test(c.text))!;
    expect(failed.values![0]).toBe(UP1);
    expect(JSON.parse(String(failed.values![1]))).toMatchObject({ upload_ids: [UP1, UP2], enrollment_id: ENR, failure: 'reading', reason: 'OGR-LLM-002' });
  });

  it('kalıcı yapılandırma/kimlik hatası "yeniden çek" demez: "işleyemedim" kartı ve hata kaydı', async () => {
    const db = diagnosisDb();
    const transport = new FakeTransport().enqueue('solution_diagnosis', { error: new RouteConfigError('model erişimi yok') });
    const errors: string[] = [];
    const log = { ...silentLogger, error: (msg: string) => void errors.push(msg) };
    const ctx = jobCtx({ db, transport, log });
    const err = await getJob('diagnosis.run')!.handler!({ upload_ids: [UP1, UP2], enrollment_id: ENR }, ctx).catch((e: unknown) => e);
    expect((err as PermanentJobError).code).toBe('OGR-JOB-146');
    const card = db.calls.find((c) => /insert into public\.suggestions/.test(c.text))!;
    expect(card.values!.slice(2, 4)).toEqual([FAILURE_CARDS.processing.title, FAILURE_CARDS.processing.subtitle]);
    expect(JSON.parse(String(card.values![4]))).toMatchObject({ failure: 'processing', reason: 'OGR-LLM-001' });
    expect(errors).toHaveLength(1);
  });

  it('şemaya uymayan model çıktısı okuma hatasıdır', () => {
    expect(isReadingFailure(new ParseError('x', '{}'))).toBe(true);
    expect(isReadingFailure(new RouteConfigError('x'))).toBe(false);
    expect(isReadingFailure(new Error('x'))).toBe(false);
  });

  it('model çıktısı apply\'dan önce saklanır; apply son denemede de düşerse yüklemeler failed + "işleyemedim" kartı', async () => {
    const run = (retryCount: number, raw?: Record<string, unknown>) => {
      const db = diagnosisDb({ applyFails: true, ...(raw ? { raw } : {}) });
      const transport = new FakeTransport().enqueue('solution_diagnosis', { json: fixture() });
      const ctx = jobCtx({ db, transport, job: { id: 'job-1', name: 'diagnosis.run', retryCount } });
      return { db, transport, ctx, p: getJob('diagnosis.run')!.handler!({ upload_ids: [UP1, UP2], enrollment_id: ENR }, ctx).catch((e: unknown) => e) };
    };
    // ilk deneme: geçici hata yukarı çıkar (pg-boss yeniden dener), çıktı audit.events'e yazıldı, kart yok
    const first = run(0);
    const err = await first.p;
    expect(err).not.toBeInstanceOf(PermanentJobError);
    const saved = first.db.calls.find((c) => /app\.audit_event/.test(c.text))!;
    expect(saved.values![0]).toBe('diagnosis.raw');
    const diff = JSON.parse(String(saved.values![2])) as Record<string, unknown>;
    expect(diff).toMatchObject({ upload_ids: [UP1, UP2], enrollment_id: ENR, model: 'claude-opus-5-5', data: { verdict: 'wrong' } });
    expect(first.db.calls.some((c) => /insert into public\.suggestions/.test(c.text))).toBe(false);

    // son deneme: saklanan çıktı kullanılır (Opus yeniden çağrılmaz), yüklemeler failed + nötr kart, kalıcı hata
    const last = run(3, diff);
    const lastErr = await last.p;
    expect(lastErr).toBeInstanceOf(PermanentJobError);
    expect((lastErr as PermanentJobError).code).toBe('OGR-JOB-145');
    expect(last.transport.requests).toHaveLength(0);
    const statuses = last.db.calls.filter((c) => /update public\.uploads set status/.test(c.text)).map((c) => c.values![1]);
    expect(statuses).toEqual(['processing', 'failed']);
    const card = last.db.calls.find((c) => /insert into public\.suggestions/.test(c.text))!;
    expect(card.values!.slice(2, 4)).toEqual([FAILURE_CARDS.processing.title, FAILURE_CARDS.processing.subtitle]);
    expect(JSON.parse(String(card.values![4]))).toMatchObject({ failed: true, failure: 'processing', analysis_id: null });
  });

  it('saklanan çıktı varsa yeniden denemede Opus çağrılmaz ve maliyet ikinci kez yazılmaz', async () => {
    const db = diagnosisDb({ raw: { upload_ids: [UP1, UP2], enrollment_id: ENR, data: fixture(), model: 'claude-opus-5-5', cost_usd: 0.04, prompt_version: 'v1', file_ids: ['f1', 'f2'] } });
    const transport = new FakeTransport();
    const res = await getJob('diagnosis.run')!.handler!({ upload_ids: [UP1, UP2], enrollment_id: ENR }, jobCtx({ db, transport }));
    expect(res).toMatchObject({ analysisId: 'sa-yeni', rawReused: true, fileIds: ['f1', 'f2'] });
    expect(transport.requests).toHaveLength(0);
    const input = JSON.parse(String(db.calls.find((c) => /apply_diagnosis/.test(c.text))!.values![0])) as Record<string, unknown>;
    expect(input).toMatchObject({ cost_usd: 0, model: 'claude-opus-5-5' });
  });

  it('Files API kimliği yoksa (süresi dolmuş) kimlik boşaltılır, yeniden yüklenir ve çağrı bir kez yinelenir', async () => {
    const db = diagnosisDb();
    const transport = new FakeTransport().enqueue(
      'solution_diagnosis',
      { error: Object.assign(new Error('400 file_id file_onceden not found'), { status: 400 }) },
      { json: fixture() },
    );
    const res = await getJob('diagnosis.run')!.handler!({ upload_ids: [UP1, UP2], enrollment_id: ENR }, jobCtx({ db, transport }));
    expect(res).toMatchObject({ verdict: 'wrong', fileIds: [`fake-file-${UP1.slice(0, 8)}`, `fake-file-${UP2.slice(0, 8)}`] });
    expect(db.calls.some((c) => /set anthropic_file_id = null/.test(c.text) && c.values![0] === UP2)).toBe(true);
    expect(transport.requests.filter((r) => r.route === 'solution_diagnosis')).toHaveLength(2);
  });

  it('öneri apply_proposal biçiminde gider (parent_id)', async () => {
    const db = diagnosisDb();
    const transport = new FakeTransport().enqueue('solution_diagnosis', { json: { ...fixture(), skill_ids: ['tyt.mat.cebir.denklem-sistemi'], misconception_tags: [] } });
    await getJob('diagnosis.run')!.handler!({ upload_ids: [UP1, UP2], enrollment_id: ENR }, jobCtx({ db, transport }));
    const input = JSON.parse(String(db.calls.find((c) => /apply_diagnosis/.test(c.text))!.values![0])) as Record<string, unknown> & { analysis: Record<string, unknown> };
    expect(input.proposed_subskill).toEqual({
      parent_id: 'tyt.mat.cebir',
      name: 'Önerilen alt kazanım: Cebir',
      description: fixture().why_tr,
      code: 'tyt.mat.cebir.denklem-sistemi',
      id: 'tyt.mat.cebir.denklem-sistemi',
    });
    expect(input.analysis.skill_order).toEqual([]);
  });

  it('geçersiz yük şeması reddeder (boş liste, 5 sayfa: Kendi çalışmam en çok 4)', () => {
    const def = getJob('diagnosis.run')!;
    expect(def.payload.safeParse({ upload_ids: [], enrollment_id: ENR }).success).toBe(false);
    expect(def.payload.safeParse({ upload_ids: Array(4).fill(UP1), enrollment_id: ENR }).success).toBe(true);
    expect(def.payload.safeParse({ upload_ids: Array(5).fill(UP1), enrollment_id: ENR }).success).toBe(false);
  });
});

describe('upload.intake', () => {
  const intakeDb = (studentOf = STUDENT, audit: Record<string, unknown>[] = []) =>
    routedDb([
      [/from public\.enrollments where id/, () => [{ id: ENR, student_id: STUDENT, curriculum_id: CUR, course_id: null }]],
      [/from public\.uploads where id = any/, () => [{ id: UP1, student_id: studentOf, owner_id: OWNER }]],
      [/from audit\.events/, () => audit],
      [/insert into public\.exams/, () => [{ exam_id: 'exam-1', session_id: 'sess-1', linked: 1 }]],
    ]);

  it('sayfa sınırı türe göre: Kendi çalışmam 4, Okul denemesi 40', () => {
    const def = getJob('upload.intake')!;
    const base = { student_id: STUDENT, enrollment_id: ENR };
    expect(def.payload.safeParse({ ...base, kind: 'own_work', upload_ids: Array(5).fill(UP1) }).success).toBe(false);
    expect(def.payload.safeParse({ ...base, kind: 'school_exam', upload_ids: Array(40).fill(UP1) }).success).toBe(true);
    expect(def.payload.safeParse({ ...base, kind: 'school_exam', upload_ids: Array(41).fill(UP1) }).success).toBe(false);
  });

  it('Kendi çalışmam → diagnosis.run (tekil anahtar)', async () => {
    const ctx = jobCtx({ db: intakeDb() });
    const res = await getJob('upload.intake')!.handler!({ upload_ids: [UP1], kind: 'own_work', student_id: STUDENT, enrollment_id: ENR }, ctx);
    expect(res).toMatchObject({ kind: 'own_work', enqueued: ['diagnosis.run'] });
    expect(ctx.enqueued).toEqual([{ name: 'diagnosis.run', data: { upload_ids: [UP1], enrollment_id: ENR }, opts: { singletonKey: `diagnosis:${UP1}` } }]);
  });

  it('Okul denemesi → exams(deneme, uploaded) + oturum + audit bağı tek deyimde + "yakında" kartı', async () => {
    const db = intakeDb();
    const ctx = jobCtx({ db });
    const res = await getJob('upload.intake')!.handler!({ upload_ids: [UP1], kind: 'school_exam', student_id: STUDENT, enrollment_id: ENR }, ctx);
    expect(res).toMatchObject({ kind: 'school_exam', examId: 'exam-1', sessionId: 'sess-1', reused: false, enqueued: [] });
    const exam = db.calls.find((c) => /insert into public\.exams/.test(c.text))!;
    expect(exam.text).toMatch(/'deneme', 'uploaded', \$4, 'draft'/);
    expect(exam.values).toEqual([null, CUR, OWNER, 'Okul denemesi · 3 Kas', ENR, UP1, JSON.stringify([UP1])]);
    // sınav, oturum ve audit bağı aynı deyimde (tek işlem)
    expect(exam.text).toMatch(/insert into public\.exam_sessions[\s\S]*app\.audit_event\('exam\.upload_intake'/);
    expect(db.calls.filter((c) => /insert into public\.exam_sessions|audit_event/.test(c.text))).toHaveLength(1);
    const card = db.calls.find((c) => /insert into public\.suggestions/.test(c.text))!;
    expect(card.values!.slice(2, 4)).toEqual([SCHOOL_EXAM_CARD.title, SCHOOL_EXAM_CARD.subtitle]);
    expect(ctx.enqueued).toEqual([]);
  });

  it('yeniden denemede ikinci sınav açılmaz', async () => {
    const db = intakeDb(STUDENT, [{ exam_id: 'exam-0', session_id: 'sess-0' }]);
    const res = await getJob('upload.intake')!.handler!({ upload_ids: [UP1], kind: 'school_exam', student_id: STUDENT, enrollment_id: ENR }, jobCtx({ db }));
    expect(res).toMatchObject({ examId: 'exam-0', sessionId: 'sess-0', reused: true });
    expect(db.calls.some((c) => /insert into public\.exams/.test(c.text))).toBe(false);
  });

  it('başka öğrencinin yüklemesi kalıcı hata', async () => {
    const ctx = jobCtx({ db: intakeDb(OTHER) });
    await expect(getJob('upload.intake')!.handler!({ upload_ids: [UP1], kind: 'own_work', student_id: STUDENT, enrollment_id: ENR }, ctx)).rejects.toMatchObject({ code: 'OGR-JOB-142' });
    expect(ctx.enqueued).toEqual([]);
  });
});
