// Canlı veri kaynağı: sahte fetch ile PostgREST/GoTrue istekleri doğrulanır (ağ yok, anahtar yok).
import { describe, expect, it } from 'vitest';
import { SupabaseClient } from '../lib/supabase';
import { createLiveDataSource } from '../lib/data/live';
import { PanelError, errorText } from '../lib/errors';

const URL_BASE = 'https://proje.supabase.test';
const ANON = 'anon-test-key';
const UID = 'de70e65e-1410-5026-a773-c5e55a3e6368';

interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

type Route = (c: Call) => { status?: number; json?: unknown; raw?: string } | undefined;

function memoryStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

function setup(role: 'instructor' | 'observer' | 'coordinator', routes: Route[] = [], signedIn = true) {
  const calls: Call[] = [];
  const store = memoryStore();
  if (signedIn) {
    store.setItem('ogrenmen.panel.session', JSON.stringify({ access_token: 'user-token', refresh_token: 'r', expires_at: 4102444800, user: { id: UID, email: 'ayse@example.test' } }));
  }
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    let body: unknown = init?.body;
    if (typeof body === 'string') body = JSON.parse(body);
    const call: Call = { method: init?.method ?? 'GET', path: decodeURIComponent(url.slice(URL_BASE.length)), headers, body };
    calls.push(call);
    if (call.path.startsWith('/rest/v1/staff?select=id,full_name,role,subject')) {
      return new Response(JSON.stringify([{ id: UID, full_name: 'Ayşe Yılmaz', role, subject: 'matematik' }]), { status: 200 });
    }
    for (const r of routes) {
      const out = r(call);
      if (out) return new Response(out.raw ?? (out.json === undefined ? '' : JSON.stringify(out.json)), { status: out.status ?? 200 });
    }
    return new Response('[]', { status: 200 });
  }) as typeof fetch;
  const client = new SupabaseClient({ url: URL_BASE, anonKey: ANON, fetch: fetchImpl, storage: store, now: () => Date.parse('2026-10-20T09:00:00Z') });
  return { calls, client, ds: createLiveDataSource(client), store };
}

describe('SupabaseClient', () => {
  it('password sign-in stores the session and uses it as bearer', async () => {
    const { client, calls, store } = setup('instructor', [
      (c) => (c.path.startsWith('/auth/v1/token?grant_type=password') ? { json: { access_token: 'tok-1', refresh_token: 'ref-1', expires_in: 3600, user: { id: UID, email: 'a@b.test' } } } : undefined),
    ], false);
    await client.auth.signInWithPassword('a@b.test', 'gizli');
    expect(calls[0]).toMatchObject({ method: 'POST', body: { email: 'a@b.test', password: 'gizli' } });
    expect(calls[0].headers.apikey).toBe(ANON);
    expect(JSON.parse(store.getItem('ogrenmen.panel.session')!).access_token).toBe('tok-1');
    await client.from('students').select('id, public_ref').eq('public_ref', 's_abc').in('status', ['active', 'paused']).order('created_at', { ascending: false }).limit(5);
    const last = calls[calls.length - 1];
    expect(last.path).toBe('/rest/v1/students?select=id,public_ref&public_ref=eq.s_abc&status=in.(active,paused)&order=created_at.desc&limit=5');
    expect(last.headers.Authorization).toBe('Bearer tok-1');
  });

  it('maps OGR error codes from PostgREST bodies', async () => {
    const { ds } = setup('instructor', [(c) => (c.path === '/rest/v1/rpc/approve_question' ? { status: 400, json: { code: 'P0001', message: 'OGR-Q-003 anahtar görülmeden onay yok' } } : undefined)]);
    const err = await ds.approveQuestion('q1', 'approved', null).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PanelError);
    expect((err as PanelError).code).toBe('OGR-Q-003');
    expect(errorText(err)).toBe('Önce cevap anahtarını gör; anahtar görülmeden onay yok.');
  });

  it('anon RPC (veli onayı) uses the anon key with or without a staff session', async () => {
    const form = { guardian_name: 'Ayten Çelik', guardian_relation: 'anne', confirmed_at: '2026-10-20T09:00:00Z', declarations: [1, 2, 4], doc_version: '2026-10-v1', legal_text_id: null };
    for (const signedIn of [false, true]) {
      const { ds, calls } = setup('instructor', [(c) => (c.path === '/rest/v1/rpc/redeem_guardian_token' ? { json: true } : undefined)], signedIn);
      expect(await ds.redeemGuardianToken('W4QX-7KD2', form)).toBe(true);
      const call = calls.find((c) => c.path === '/rest/v1/rpc/redeem_guardian_token')!;
      // oturum açık personel tarayıcısında da `authenticated` olarak gitmez (yalnız anon'a grant, §3.9)
      expect(call.headers.Authorization).toBe(`Bearer ${ANON}`);
      expect(call.body).toEqual({ p_token: 'W4QX-7KD2', p_form: form });
    }
  });

  it('non-JSON GoTrue errors become panel errors, not SyntaxError', async () => {
    const html = (status: number) => (c: Call) => (c.path.startsWith('/auth/v1/token') ? { status, raw: '<html>Bad Gateway</html>' } : undefined);
    for (const [status, codeWanted] of [
      [502, 'PANEL-NET'],
      [400, 'PANEL-AUTH'],
    ] as const) {
      const { client } = setup('instructor', [html(status)], false);
      const err = await client.auth.signInWithPassword('a@b.test', 'x').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PanelError);
      expect((err as PanelError).code).toBe(codeWanted);
    }
  });
});

describe('live DataSource', () => {
  it('calls RPCs with the §3.9 parameter names', async () => {
    const { ds, calls } = setup('coordinator', [
      (c) => (c.path === '/rest/v1/rpc/panel_overview' ? { json: { tiles: { unanswered: 0, silent: 0, deadlines: 0, response_hours: null }, alerts: [], response_series: [], pilot: [] } } : undefined),
      (c) => (c.path.startsWith('/rest/v1/students?') ? { json: [{ id: 'sid-1', public_ref: 's_qk7m2rx4tn5a', status: 'active', is_minor: false, tier: 'standard' }] } : undefined),
      (c) => (c.path === '/rest/v1/rpc/mint_guardian_code' ? { json: 'K7F3-2QX9' } : undefined),
    ]);
    await ds.overview();
    await ds.resolveAlert('al-1');
    await ds.approveLesson('an-1', [{ claim_id: 'c1', status: 'approved' }]);
    await ds.approvePriorityPlan('p1', 'retired');
    await ds.setFlag('paid_llm_enabled', true);
    expect(await ds.mintGuardianCode('s_qk7m2rx4tn5a', 'web')).toBe('K7F3-2QX9');
    await ds.recordStaffConsent('s_qk7m2rx4tn5a', 'ders_kaydi', 'paper', { form_no: 'F-12' });
    await ds.linkStaffTelegram(UID, 700000101, 'ayse_hoca', '@ayse_hoca');
    const rpc = (name: string) => calls.find((c) => c.path === `/rest/v1/rpc/${name}`)?.body;
    expect(rpc('resolve_alert')).toEqual({ p_alert: 'al-1' });
    expect(rpc('approve_lesson_analysis')).toEqual({ p_analysis: 'an-1', p_decisions: [{ claim_id: 'c1', status: 'approved' }] });
    expect(rpc('approve_priority_plan')).toEqual({ p_plan: 'p1', p_decision: 'retired' });
    expect(rpc('set_runtime_flag')).toEqual({ p_key: 'paid_llm_enabled', p_value: true });
    expect(rpc('mint_guardian_code')).toEqual({ p_student: 'sid-1', p_channel: 'web' });
    expect(rpc('record_staff_consent')).toEqual({ p_student: 'sid-1', p_kind: 'ders_kaydi', p_method: 'paper', p_evidence: { form_no: 'F-12' } });
    expect(rpc('link_staff_telegram')).toEqual({ p_staff: UID, p_telegram_user_id: 700000101, p_username: 'ayse_hoca', p_mention_handle: '@ayse_hoca' });
  });

  it('raw message text comes from v_messages_staff for instructors and never for observers', async () => {
    const row = { id: 5, in_message_id: 14, chat_id: 1, student_id: 'sid-1', memory_fact_ids: [], cost_usd: '0.000238', response_text: 'Tamam.' };
    const routes: Route[] = [
      (c) => (c.path.startsWith('/rest/v1/bot_responses?') ? { json: [row] } : undefined),
      (c) => (c.path === '/rest/v1/rpc/person_labels' ? { json: [{ student_id: 'sid-1', label: 'Mert D.', public_ref: 's_vd3hp6wz2kc7' }] } : undefined),
      (c) => (c.path.startsWith('/rest/v1/v_messages_staff?') ? { json: [{ id: 14, text_raw: 'ham metin', text_llm: 'temiz metin' }] } : undefined),
      (c) => (c.path.startsWith('/rest/v1/messages?') ? { json: [{ id: 14, text_llm: 'temiz metin' }] } : undefined),
    ];
    const inst = setup('instructor', routes);
    const [a] = await inst.ds.botResponses({});
    expect(a).toMatchObject({ in_text: 'ham metin', student_label: 'Mert D.', cost_usd: 0.000238 });
    expect(inst.calls.some((c) => c.path.startsWith('/rest/v1/v_messages_staff?select=id,text_raw,text_llm'))).toBe(true);

    const obs = setup('observer', routes);
    const [b] = await obs.ds.botResponses({});
    expect(b.in_text).toBe('temiz metin');
    expect(obs.calls.some((c) => c.path.includes('v_messages_staff'))).toBe(false);
    expect(obs.calls.filter((c) => c.path.startsWith('/rest/v1/messages?')).every((c) => !c.path.includes('text_raw'))).toBe(true);
  });

  it('exam OCR text only via v_exam_items_full (E/K), exam_items without ocr_text for observers', async () => {
    const inst = setup('instructor');
    await inst.ds.examItems(['e1']);
    expect(inst.calls.at(-1)!.path).toBe('/rest/v1/v_exam_items_full?select=id,source_id,item_no,topic,kind,points,skill_id,ocr_text&id=in.(e1)');
    const obs = setup('observer');
    await obs.ds.examItems(['e1']);
    expect(obs.calls.at(-1)!.path).toBe('/rest/v1/exam_items?select=id,source_id,item_no,topic,kind,points,skill_id&id=in.(e1)');
  });

  it('uploads the exam PDF to Storage then inserts the exam_sources row', async () => {
    const { ds, calls } = setup('instructor', [
      (c) => (c.method === 'POST' && c.path.startsWith('/rest/v1/exam_sources') ? { status: 201, json: [{ ...(c.body as object), created_at: '2026-10-20T09:00:00Z', error: null }] } : undefined),
    ]);
    const file = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
    const row = await ds.uploadExamSource(file, { course_id: 'course-1', year: 2024, term: 'vize', legal_basis: 'eğitmenin kendi sınavı', instructor_alias: 'hoca-B' });
    const upload = calls.find((c) => c.path.startsWith('/storage/v1/object/exams/'))!;
    expect(upload.headers['Content-Type']).toBe('application/pdf');
    expect(upload.path).toBe(`/storage/v1/object/exams/${row.id}.pdf`);
    const insert = calls.find((c) => c.method === 'POST' && c.path.startsWith('/rest/v1/exam_sources'))!;
    expect(insert.headers.Prefer).toBe('return=representation');
    expect(insert.body).toMatchObject({ storage_path: `exams/${row.id}.pdf`, instructor_alias: 'hoca-B', uploaded_by: UID, status: 'uploaded', legal_basis: 'eğitmenin kendi sınavı' });
  });

  it('flag writes only the flag columns', async () => {
    const { ds, calls } = setup('instructor');
    await ds.flag(30, 'Cevabı tek adımda verdi');
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.path).toBe('/rest/v1/bot_responses?select=*&id=eq.30');
    expect(Object.keys(patch.body as object).sort()).toEqual(['flag_reason', 'flagged', 'flagged_at', 'flagged_by']);
  });

  it('addQuestion inserts content_hash, verification and pending_review, then set_answer_key', async () => {
    const { ds, calls } = setup('instructor', [
      (c) => (c.path.startsWith('/rest/v1/curricula?') ? { json: [{ id: 'cur-1' }] } : undefined),
      (c) => (c.method === 'POST' && c.path.startsWith('/rest/v1/questions') ? { status: 201, json: [{ id: 'q-new' }] } : undefined),
    ]);
    const options = [
      { key: 'A', text: '7/8', misconception_tag: null },
      { key: 'B', text: ' 4/12 ', misconception_tag: 'kesir-pay-payda-toplama' },
      { key: 'C', text: '1', misconception_tag: null },
      { key: 'D', text: '5/8', misconception_tag: null },
    ];
    const id = await ds.addQuestion({ skill_id: 'tyt.mat.temel.rasyonel-sayilar', stem: '  3/4 + 1/8\n toplamı  kaçtır? ', options, correct_option: 'A', solution: 'Payda 8.', difficulty: 0.4 });
    expect(id).toBe('q-new');
    const insert = calls.find((c) => c.method === 'POST' && c.path.startsWith('/rest/v1/questions'))!;
    const body = insert.body as Record<string, unknown>;
    expect(body.content_hash).toMatch(/^[0-9a-f]{64}$/);
    // content/tyt-matematik/templates/_common.py content_hash() ile aynı değer (Python'da hesaplandı)
    expect(body.content_hash).toBe('6f1d58e0c01b3b3024096d9a5c6a6d23e4922b479057629a05adfb6858171c30');
    expect(body).toMatchObject({
      curriculum_id: 'cur-1',
      source: 'instructor',
      status: 'pending_review',
      verification: { schema: true, sympy: 'not_applicable', render: 'not_applicable', vision: 'not_applicable', attempts: 0 },
    });
    const key = calls.find((c) => c.path === '/rest/v1/rpc/set_answer_key')!;
    expect(key.body).toEqual({ p_question: 'q-new', p_key: { correct_option: 'A', solution: 'Payda 8.' } });
    expect(calls.indexOf(key)).toBeGreaterThan(calls.indexOf(insert));
  });

  it('addQuestion removes the draft or reports the orphan when set_answer_key fails', async () => {
    const base: Route[] = [
      (c) => (c.path.startsWith('/rest/v1/curricula?') ? { json: [{ id: 'cur-1' }] } : undefined),
      (c) => (c.method === 'POST' && c.path.startsWith('/rest/v1/questions') ? { status: 201, json: [{ id: 'q-new' }] } : undefined),
      (c) => (c.path === '/rest/v1/rpc/set_answer_key' ? { status: 400, json: { message: 'OGR-AUTH-002' } } : undefined),
    ];
    const q = { skill_id: 's', stem: 'x', options: [{ key: 'A', text: '1', misconception_tag: null }], correct_option: 'A', solution: 'y', difficulty: 0.5 };
    const ok = setup('coordinator', base);
    expect(await ok.ds.addQuestion(q).catch((e: PanelError) => e.code)).toBe('OGR-AUTH-002');
    expect(ok.calls.some((c) => c.method === 'DELETE' && c.path.startsWith('/rest/v1/questions?') && c.path.includes('id=eq.q-new'))).toBe(true);
    const denied = setup('coordinator', [(c) => (c.method === 'DELETE' ? { status: 403, json: { message: 'permission denied' } } : undefined), ...base]);
    expect(await denied.ds.addQuestion(q).catch((e: PanelError) => e.code)).toBe('PANEL-ORPHAN');
  });

  it('figure rejection writes review_status rejected; misconception confirm is a guarded status update', async () => {
    const { ds, calls } = setup('instructor', [(c) => (c.method === 'PATCH' && c.path.startsWith('/rest/v1/misconceptions') ? { json: [{ id: 'm1' }] } : undefined)]);
    await ds.decideFigure('f1', 'rejected');
    const fig = calls.find((c) => c.method === 'PATCH' && c.path.startsWith('/rest/v1/figures'))!;
    expect((fig.body as Record<string, unknown>).review_status).toBe('rejected');
    await ds.confirmMisconception('m1');
    const m = calls.find((c) => c.method === 'PATCH' && c.path.startsWith('/rest/v1/misconceptions'))!;
    expect(m.path).toBe('/rest/v1/misconceptions?select=*&id=eq.m1&status=eq.pending_review');
    expect(m.body).toEqual({ status: 'open' });
    expect(calls.some((c) => c.path.includes('resolve_misconception'))).toBe(false);
    // satır değişmediyse (zaten açık / başka biri karar verdi) sessizce geçmez
    const none = setup('instructor');
    expect(await none.ds.confirmMisconception('m2').catch((e: PanelError) => e.code)).toBe('PANEL-NOTFOUND');
  });

  it('updateChat refuses out-of-range values without sending a request', async () => {
    const { ds, calls } = setup('coordinator');
    for (const fields of [{ retention_days: 0 }, { retention_days: 366 }, { retention_days: 1.5 }, { group_auto_answer_min: -1 }, { group_auto_answer_min: 241 }]) {
      expect(await ds.updateChat(-100123, fields).catch((e: PanelError) => e.code)).toBe('PANEL-FORM');
    }
    expect(calls.filter((c) => c.path.startsWith('/rest/v1/tg_chats'))).toEqual([]);
    await ds.updateChat(-100123, { retention_days: 90, group_auto_answer_min: 30 });
    const patch = calls.find((c) => c.method === 'PATCH' && c.path.startsWith('/rest/v1/tg_chats'))!;
    expect(patch.body).toEqual({ group_auto_answer_min: 30, retention_days: 90 });
  });

  it('revoking a consent recomputes students.status like the RPCs', async () => {
    const { ds, calls } = setup('coordinator', [
      (c) => (c.method === 'PATCH' && c.path.startsWith('/rest/v1/consents') ? { json: [{ id: 'c1', student_id: 'sid-1' }] } : undefined),
      (c) => (c.method === 'GET' && c.path.startsWith('/rest/v1/students?') ? { json: [{ id: 'sid-1', public_ref: 's_x', status: 'active', is_minor: true, tier: 'standard' }] } : undefined),
      (c) => (c.method === 'GET' && c.path.startsWith('/rest/v1/consents?') ? { json: [{ kind: 'kvkk_aydinlatma' }] } : undefined),
    ]);
    await ds.revokeConsent('c1');
    const patch = calls.find((c) => c.method === 'PATCH' && c.path.startsWith('/rest/v1/students'))!;
    expect(patch.path).toContain('id=eq.sid-1');
    expect(patch.body).toEqual({ status: 'pending_consent' });
  });

  it('exam upload checks the file and removes the PDF when the row cannot be written', async () => {
    const { ds, calls } = setup('instructor', [(c) => (c.method === 'POST' && c.path.startsWith('/rest/v1/exam_sources') ? { status: 400, json: { message: 'violates check constraint' } } : undefined)]);
    const meta = { course_id: 'course-1', year: 2024, term: 'vize' as const, legal_basis: 'eğitmenin kendi sınavı' as const, instructor_alias: 'hoca-B' };
    expect(await ds.uploadExamSource(new Blob(['x'], { type: 'text/plain' }), meta).catch((e: PanelError) => e.code)).toBe('PANEL-FORM');
    expect(calls.some((c) => c.path.startsWith('/storage/'))).toBe(false);
    await ds.uploadExamSource(new Blob(['%PDF-1.4'], { type: 'application/pdf' }), meta).catch(() => undefined);
    const up = calls.find((c) => c.method === 'POST' && c.path.startsWith('/storage/v1/object/exams/'))!;
    const del = calls.find((c) => c.method === 'DELETE' && c.path.startsWith('/storage/v1/object/exams/'))!;
    expect(del.path).toBe(up.path);
  });

  it('pilot gate reads CI status rows from pilot_metrics', async () => {
    const period = '2026-10-19';
    const gate = { cost_per_student: { max_usd: 0.1 }, isolation_tests: 'pass', key_leak_tests: 'pass' };
    const metrics = [
      { metric: 'cost_per_student', period, value: '0.05', detail: {}, computed_at: period },
      { metric: 'isolation_tests', period: '2026-10-20', value: null, detail: { status: 'pass' }, computed_at: '2026-10-20' },
      { metric: 'key_leak_tests', period: '2026-10-20', value: null, detail: { status: 'pass' }, computed_at: '2026-10-20' },
    ];
    const { ds } = setup('coordinator', [
      (c) => (c.path.startsWith('/rest/v1/pilot_metrics?') ? { json: metrics } : undefined),
      (c) => (c.path.startsWith('/rest/v1/settings?') ? { json: [{ value: gate }] } : undefined),
    ]);
    const res = await ds.pilotGate();
    expect(res.rows.map((r) => [r.metric, r.verdict])).toEqual([
      ['cost_per_student', 'PASS'],
      ['isolation_tests', 'PASS'],
      ['key_leak_tests', 'PASS'],
    ]);
    expect(res.gate).toBe('AÇIK');
  });

  it('guardian form text in live mode is the build-time versioned text (anon cannot read legal_texts)', async () => {
    const { ds, calls } = setup('instructor', [], false);
    const t = await ds.guardianFormText();
    expect(t).toMatchObject({ doc_version: '2026-10-v1', legal_text_id: null, days_source: 'build' });
    expect(t.form_md).toContain('90 gün sonra silinir');
    expect(calls).toEqual([]);
  });

  it('viewer is null without a staff row', async () => {
    const calls: string[] = [];
    const store = memoryStore();
    store.setItem('ogrenmen.panel.session', JSON.stringify({ access_token: 't', refresh_token: 'r', expires_at: 4102444800, user: { id: 'u-x', email: null } }));
    const client = new SupabaseClient({
      url: URL_BASE,
      anonKey: ANON,
      storage: store,
      now: () => Date.parse('2026-10-20T09:00:00Z'),
      fetch: (async (u: RequestInfo | URL) => {
        calls.push(String(u));
        return new Response('[]', { status: 200 });
      }) as typeof fetch,
    });
    expect(await createLiveDataSource(client).viewer()).toBeNull();
    expect(calls[0]).toContain('/rest/v1/staff?');
  });
});
