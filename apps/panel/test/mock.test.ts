// Mock veri kaynağı sunucu kurallarını taklit eder (can_see / can_edit, OGR-Q-003, tek onaylı plan) ve deterministiktir.
import { describe, expect, it } from 'vitest';
import { createMockDataSource, deterministicCode } from '../lib/data/mock';
import { PanelError } from '../lib/errors';
import { resolveMockRole } from '../lib/data';

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof PanelError ? e.code : String(e);
  }
};

describe('mock data source', () => {
  it('role filtering mirrors app.can_see_student', async () => {
    const coord = await createMockDataSource({ role: 'coordinator' }).students();
    const inst = await createMockDataSource({ role: 'instructor' }).students();
    const obs = await createMockDataSource({ role: 'observer' }).students();
    expect(coord.map((s) => s.label)).toEqual(['Elif K.', 'Mert D.', 'Zeynep Ç.']);
    expect(inst).toHaveLength(3);
    expect(obs.map((s) => s.public_ref)).toEqual(['s_qk7m2rx4tn5a']);
    expect(await createMockDataSource({ role: 'observer' }).student('s_vd3hp6wz2kc7')).toBeNull();
  });

  it('observer writes are refused with OGR-AUTH-002', async () => {
    const ds = createMockDataSource({ role: 'observer' });
    expect(await code(ds.approveLesson('6c9f9fd0-59cc-5f1c-94eb-4a41b4edc0af', []))).toBe('OGR-AUTH-002');
    expect(await code(ds.approveQuestion('3287fc04-ca60-5ed1-96c1-a35c6740d5fa', 'approved', null))).toBe('OGR-AUTH-002');
    expect(await code(ds.flag(1, 'x'))).toBe('OGR-AUTH-002');
    expect(await code(ds.setCitationRelevance('10a57dea-4d1f-56c3-a154-277401baaac5', 2))).toBe('OGR-AUTH-002');
    expect(await code(ds.peekAnswerKey('0a86bcef-4c31-5214-a19f-7e6d5cf47e9c'))).toBe('OGR-AUTH-002');
  });

  it('not_applicable key needs peek before approve (OGR-Q-003); pending figure blocks (OGR-Q-001)', async () => {
    const ds = createMockDataSource({ role: 'instructor' });
    const q = '0a86bcef-4c31-5214-a19f-7e6d5cf47e9c';
    expect(await code(ds.approveQuestion(q, 'approved', null))).toBe('OGR-Q-003');
    const key = await ds.peekAnswerKey(q);
    expect(key).toMatchObject({ correct_option: 'B', sympy_status: 'not_applicable' });
    expect(await code(ds.approveQuestion(q, 'approved', null))).toBe('ok');
    expect((await ds.queue()).some((r) => r.ref_id === q)).toBe(false);
    expect(await code(ds.approveQuestion('15c5b12a-3176-5348-a0d2-ddc391f2acba', 'approved', null))).toBe('OGR-Q-001');
    await ds.decideFigure('eb17b011-7afc-5389-9a88-65711d3c5053', 'verified');
    expect(await code(ds.approveQuestion('15c5b12a-3176-5348-a0d2-ddc391f2acba', 'approved', null))).toBe('ok');
  });

  it('instructor-written questions count set_answer_key as the key being seen', async () => {
    const ds = createMockDataSource({ role: 'instructor' });
    const id = await ds.addQuestion({
      skill_id: 'tyt.mat.temel.rasyonel-sayilar',
      stem: '1/2 + 1/4 kaçtır?',
      options: [
        { key: 'A', text: '3/4', misconception_tag: null },
        { key: 'B', text: '2/6', misconception_tag: null },
        { key: 'C', text: '1/8', misconception_tag: null },
        { key: 'D', text: '1', misconception_tag: null },
      ],
      correct_option: 'A',
      solution: 'Payda 4: 2/4 + 1/4 = 3/4.',
      difficulty: 0.3,
    });
    expect((await ds.queue()).some((r) => r.ref_id === id && r.kind === 'question')).toBe(true);
    const row = await ds.queueDetail({ kind: 'question', ref_id: id, created_at: '', reason: '', student_ref: null, staff_hint: null });
    // live ile aynı satır: aktif müfredat, pending_review, verification.sympy not_applicable
    expect(row?.kind === 'question' && row.question).toMatchObject({ curriculum_id: '7a988b84-8937-5242-8c35-ddbc4ea9216d', status: 'pending_review', verification: { sympy: 'not_applicable' } });
    expect(await code(ds.approveQuestion(id, 'approved', null))).toBe('ok');
    // aynı kök ve şıklar (boşluk/harf farkıyla) ikinci kez yazılmaz: content_hash unique
    const again = ds.addQuestion({
      skill_id: 'tyt.mat.temel.rasyonel-sayilar',
      stem: '  1/2 +\n 1/4 kaçtır? ',
      options: [
        { key: 'A', text: '3/4', misconception_tag: null },
        { key: 'B', text: '2/6', misconception_tag: null },
        { key: 'C', text: '1/8', misconception_tag: null },
        { key: 'D', text: '1', misconception_tag: null },
      ],
      correct_option: 'A',
      solution: 'x',
      difficulty: 0.3,
    });
    expect(await code(again)).toBe('PANEL-FORM');
  });

  it('approve_priority_plan keeps one approved plan per course and period', async () => {
    const ds = createMockDataSource({ role: 'instructor' });
    await ds.approvePriorityPlan('e0cc9cfb-fffd-5244-8eaf-45e360ce3381', 'approved');
    const plans = await ds.priorityPlans('TYT-MAT');
    expect(plans.filter((p) => p.status === 'approved').map((p) => p.id)).toEqual(['e0cc9cfb-fffd-5244-8eaf-45e360ce3381']);
    expect(await code(ds.approvePriorityPlan('nope', 'approved'))).toBe('OGR-PLAN-002');
  });

  it('guardian web token: valid once, consent becomes given, student becomes active', async () => {
    const ds = createMockDataSource({ role: 'coordinator' });
    const before = (await ds.consents('s_mb5tj7ye4ql2'))[0];
    expect(before.missing).toEqual(['veli_onayi']);
    const text = await ds.guardianFormText();
    const form = { guardian_name: 'Ayten Çelik', guardian_relation: 'anne', confirmed_at: '2026-10-20T09:00:00Z', declarations: [1, 2, 4], doc_version: text.doc_version, legal_text_id: text.legal_text_id };
    expect(await code(ds.redeemGuardianToken('W4QX-7KD2', { ...form, declarations: [1, 2] }))).toBe('PANEL-FORM');
    expect(await ds.redeemGuardianToken('w4qx 7kd2', form)).toBe(true);
    expect(await ds.redeemGuardianToken('W4QX-7KD2', form)).toBe(false);
    const after = (await ds.consents('s_mb5tj7ye4ql2'))[0];
    expect(after).toMatchObject({ consent_ok: true, status: 'active', missing: [] });
    const veli = after.consents.find((c) => c.kind === 'veli_onayi')!;
    expect(veli).toMatchObject({ method: 'web_token', given_by: 'guardian', legal_text_id: '436801a0-024e-56dd-ab6e-257889632603' });
    // gösterilen metin sürümü kanıta yazılır
    expect(veli.evidence).toMatchObject({ doc_version: '2026-10-v1', legal_text_id: '436801a0-024e-56dd-ab6e-257889632603', declarations: [1, 2, 4] });
    // yeni web kodu üretilir: RPC gibi tiresiz 8 karakter (§3.9); tireli ve tiresiz biçim kabul edilir
    const fresh = await ds.mintGuardianCode('s_vd3hp6wz2kc7', 'web');
    expect(fresh).toMatch(/^[A-Z2-7]{8}$/);
    expect(await ds.redeemGuardianToken(`${fresh.slice(0, 4)}-${fresh.slice(4)}`, form)).toBe(true);
    expect(await code(ds.redeemGuardianToken('W4QX-7KD2', { ...form, doc_version: '' }))).toBe('PANEL-FORM');
  });

  it('guardian form text is the versioned docs/hukuk form with retention days from retention_policies', async () => {
    const t = await createMockDataSource({ role: 'coordinator' }).guardianFormText();
    expect(t).toMatchObject({ doc_version: '2026-10-v1', legal_text_id: '436801a0-024e-56dd-ab6e-257889632603', days_source: 'retention_policies', aydinlatma_version: '2026-10-v1' });
    expect(t.form_md).toContain('mesajları kaydedilir ve 90 gün sonra silinir');
    expect(t.form_md).toContain('Yapay zekâya gönderilen tam bağlam 30 gün sonra boşaltılır');
    expect(t.form_md).toContain('Ham kayıt 30 gün sonra silinir');
    expect(t.form_md).not.toContain('{{');
    expect(t.form_md).not.toContain('## 5. Beyan');
    expect(t.aydinlatma_md).not.toContain('{{');
    expect(t.aydinlatma_md).toContain('Aydınlatma Metni');
  });

  it('figure decisions store only §3.4 review_status values', async () => {
    const ds = createMockDataSource({ role: 'instructor' });
    const id = 'eb17b011-7afc-5389-9a88-65711d3c5053';
    await ds.decideFigure(id, 'rejected');
    const detail = await ds.queueDetail({ kind: 'figure', ref_id: id, created_at: '', reason: '', student_ref: null, staff_hint: null });
    expect(detail?.kind === 'figure' && detail.figure.review_status).toBe('rejected');
    expect(['pending', 'verified', 'rejected']).toContain(detail?.kind === 'figure' ? detail.figure.review_status : '');
    expect(await code(ds.decideFigure(id, 'failed' as 'rejected'))).toBe('PANEL-FORM');
    expect((await ds.queue()).some((r) => r.kind === 'figure' && r.ref_id === id)).toBe(false);
  });

  it('confirming a pending_review misconception opens it (§10.3) instead of resolving it', async () => {
    const ds = createMockDataSource({ role: 'instructor' });
    const id = '275a73df';
    const row = (await ds.queue()).find((r) => r.kind === 'misconception' && r.ref_id.startsWith(id))!;
    const detail = await ds.queueDetail(row);
    expect(detail?.kind === 'misconception' && detail.misconception.status).toBe('pending_review');
    await ds.confirmMisconception(row.ref_id);
    const after = await ds.queueDetail(row);
    expect(after?.kind === 'misconception' && after.misconception.status).toBe('open');
    expect((await ds.queue()).some((r) => r.ref_id === row.ref_id)).toBe(false);
    // öğrenci profilindeki "Açık kavram yanılgıları" listesinde görünür
    const students = await ds.students();
    const profiles = await Promise.all(students.map((s) => ds.student(s.public_ref)));
    const owner = profiles.find((p) => p?.open_misconceptions.some((m) => m.id === row.ref_id));
    expect(owner?.open_misconceptions.find((m) => m.id === row.ref_id)?.status).toBe('open');
    // ikinci onay yok (yalnız pending_review değişir); gözlemci onaylayamaz
    expect(await code(ds.confirmMisconception(row.ref_id))).toBe('PANEL-NOTFOUND');
    const other = (await createMockDataSource({ role: 'observer' }).queue()).find((r) => r.kind === 'misconception');
    if (other) expect(await code(createMockDataSource({ role: 'observer' }).confirmMisconception(other.ref_id))).toBe('OGR-AUTH-002');
  });

  it('revoking a consent or flipping is_minor recomputes students.status', async () => {
    const ds = createMockDataSource({ role: 'coordinator' });
    const [elif] = await ds.consents('s_qk7m2rx4tn5a');
    expect(elif.status).toBe('active');
    await ds.setMinor('s_qk7m2rx4tn5a', true);
    const minor = (await ds.consents('s_qk7m2rx4tn5a'))[0];
    expect(minor.consent_ok ? 'active' : 'pending_consent').toBe(minor.status);
    await ds.setMinor('s_qk7m2rx4tn5a', false);
    const kvkk = (await ds.consents('s_qk7m2rx4tn5a'))[0].consents.find((c) => c.kind === 'kvkk_aydinlatma' && c.status === 'given')!;
    await ds.revokeConsent(kvkk.id);
    expect((await ds.consents('s_qk7m2rx4tn5a'))[0]).toMatchObject({ consent_ok: false, status: 'pending_consent' });
  });

  it('chat and upload rules are the shared lib/validation rules', async () => {
    const ds = createMockDataSource({ role: 'coordinator' });
    const [chat] = await ds.chats();
    expect(await code(ds.updateChat(chat.chat_id, { retention_days: 0 }))).toBe('PANEL-FORM');
    expect(await code(ds.updateChat(chat.chat_id, { group_auto_answer_min: 241 }))).toBe('PANEL-FORM');
    expect(await code(ds.updateChat(chat.chat_id, { retention_days: 30 }))).toBe('ok');
    const [course] = await ds.courses();
    const meta = { course_id: course.id, year: 2024, term: 'vize' as const, legal_basis: 'eğitmenin kendi sınavı' as const, instructor_alias: 'hoca-B' };
    expect(await code(ds.uploadExamSource(new Blob(['x'], { type: 'text/plain' }), meta))).toBe('PANEL-FORM');
    expect(await code(ds.uploadExamSource(new Blob(['%PDF'], { type: 'application/pdf' }), { ...meta, instructor_alias: 'Ayşe' }))).toBe('PANEL-FORM');
    expect(await code(ds.uploadExamSource(new Blob(['%PDF'], { type: 'application/pdf' }), meta))).toBe('ok');
  });

  it('paper consent needs paper|panel and an editable student', async () => {
    const ds = createMockDataSource({ role: 'instructor' });
    expect(await code(ds.recordStaffConsent('s_mb5tj7ye4ql2', 'veli_onayi', 'telegram_button' as 'paper', {}))).toBe('OGR-CONS-004');
    expect(await code(ds.recordStaffConsent('s_mb5tj7ye4ql2', 'veli_onayi', 'paper', { form_no: 'F-7' }))).toBe('ok');
    expect((await ds.students()).find((s) => s.public_ref === 's_mb5tj7ye4ql2')).toMatchObject({ consent_ok: true, status: 'active' });
    expect(await code(createMockDataSource({ role: 'observer' }).recordStaffConsent('s_qk7m2rx4tn5a', 'ders_kaydi', 'paper', { form_no: 'F-8' }))).toBe('OGR-AUTH-002');
  });

  it('update_student_pii accepts only the allowed fields; full name only for the coordinator', async () => {
    const ds = createMockDataSource({ role: 'coordinator' });
    expect(await code(ds.updateStudentPii('s_qk7m2rx4tn5a', { birth_year: '2001' } as never))).toBe('OGR-PII-001');
    await ds.updateStudentPii('s_qk7m2rx4tn5a', { school: 'Örnek Lisesi' });
    expect(await ds.studentFullName('s_qk7m2rx4tn5a')).toBe('Elif Kaya');
    const audit = await ds.auditRecent(10);
    expect(audit.map((a) => a.action)).toEqual(['RPC:student_full_name', 'RPC:update_student_pii']);
    expect(await code(createMockDataSource({ role: 'instructor' }).studentFullName('s_qk7m2rx4tn5a'))).toBe('OGR-AUTH-002');
  });

  it('spend keeps lesson analysis outside the chat cap', async () => {
    const view = await createMockDataSource({ role: 'coordinator' }).spend();
    expect(view.check.lesson_month_usd).toBeCloseTo(0.2535, 6);
    expect(view.check.month_usd).toBeCloseTo(0.000476 + 0.000238 + 0.001216 + 0.001454 + 0.000714 + 0.000201, 6);
    expect(view.check.state).toBe('normal');
    expect(await code(createMockDataSource({ role: 'instructor' }).setFlag('paid_llm_enabled', true))).toBe('OGR-AUTH-002');
  });

  it('degraded_mode changes only state, not paid_allowed (§3.9 check_spend)', async () => {
    const ds = createMockDataSource({ role: 'coordinator' });
    await ds.setFlag('degraded_mode', true);
    const v = await ds.spend();
    expect(v.check).toMatchObject({ degraded: true, state: 'degraded', paid_allowed: true });
    await ds.setFlag('paid_llm_enabled', false);
    expect((await ds.spend()).check).toMatchObject({ state: 'degraded', paid_allowed: false });
  });

  it('is deterministic', async () => {
    const a = createMockDataSource({ role: 'coordinator' });
    const b = createMockDataSource({ role: 'coordinator' });
    expect(await a.mintGuardianCode('s_vd3hp6wz2kc7', 'telegram')).toBe(await b.mintGuardianCode('s_vd3hp6wz2kc7', 'telegram'));
    expect(await a.mintStaffCode('de70e65e-1410-5026-a773-c5e55a3e6368')).toBe(await b.mintStaffCode('de70e65e-1410-5026-a773-c5e55a3e6368'));
    expect(deterministicCode('x')).toBe(deterministicCode('x'));
    expect(deterministicCode('x')).not.toBe(deterministicCode('y'));
    expect(JSON.stringify(await a.overview())).toBe(JSON.stringify(await b.overview()));
  });

  it('mock role comes from ?role= and persists in sessionStorage', () => {
    const store = new Map<string, string>();
    const kv = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(resolveMockRole('', kv)).toBe('coordinator');
    expect(resolveMockRole('?role=observer', kv)).toBe('observer');
    expect(resolveMockRole('', kv)).toBe('observer');
    expect(resolveMockRole('?role=admin', kv)).toBe('observer');
  });
});
