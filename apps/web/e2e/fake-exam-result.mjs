// Sahte Supabase'in Okul denemesi → bekleme → sonuç → rapor eki (e2e/fake-supabase.mjs çağırır): submit_exam_upload,
// exam_session_view, exam_how_far, exam_blank_reason, list_my_documents (supabase/migrations/0030, 0032) yanıt
// biçimlerini taklit eder ve worker'ı zamanlayıcıyla benzetir (classify → ocr → key → grade → analyse → report → done).
// Gerçek hat, notlama ve RLS supabase/tests/20-21'de ve worker testlerinde sınanır.
import { USERS } from './fixtures.mjs';
import { E2E_ANALYSIS, E2E_ENROLLMENT_ID } from './fake-uploads.mjs';

const STUDENT_ID = '10000000-0000-4000-8000-000000000001';
const COURSE_ID = '50000000-0000-4000-8000-000000000001';
const CURRICULUM_ID = '60000000-0000-4000-8000-000000000001';
/** Aşama adımı (ms): test hızlı bitsin ama bekleme ekranı görünsün. */
const STEP_MS = 600;
const REPORT_MS = 1500;

let seq = 0;
const uuid = (prefix) => `${prefix}-0000-4000-8000-${String(++seq + 700).padStart(12, '0')}`;
const err = (code, message, status = 400) => ({ status, body: { code, message, details: null, hint: null } });

const mode = { failNext: false, keySource: 'inferred' };

/** Notlanmış deneme (6 soru: 3 doğru, 1 yanlış, 2 boş; net 2,75). */
const SCORE = { total: 6, correct: 3, wrong: 1, blank: 2, unfinished: 0, ungraded: 0, net: 2.75, unverified_keys: 0, sections: [{ section: 'mat', total: 6, correct: 3, wrong: 1, blank: 2, unfinished: 0, net: 2.75 }] };
const HEAT = [
  { skill_id: 'tyt.mat.cebir.denklem', name: 'Birinci dereceden denklemler', total: 3, correct: 1, wrong: 1, blank: 1, band: 'low' },
  { skill_id: 'tyt.mat.temel.sayilar', name: 'Sayı kümeleri, işlem önceliği, işaret kuralları', total: 3, correct: 2, wrong: 0, blank: 1, band: 'mid' },
];

function studentOf(tables, caller) {
  return caller ? (tables.students.find((s) => s.profile_id === caller.id) ?? null) : null;
}
function parentOf(tables, caller, studentId) {
  return Boolean(caller && tables.guardian_links.some((l) => l.parent_id === caller.id && l.student_id === studentId && l.status === 'active'));
}

function setProgress(s, stage, counters = {}) {
  s.progress = { ...(s.progress ?? {}), ...counters, stage, updated_at: new Date().toISOString() };
}

/** Worker benzetimi. */
function simulate(tables, s, total) {
  let t = 0;
  const at = (ms, fn) => setTimeout(fn, ms);
  for (let i = 1; i <= total; i++) {
    t += STEP_MS;
    at(t, () => setProgress(s, 'classify', { pages_total: total, pages_done: i }));
  }
  for (const stage of ['ocr', 'key', 'grade']) {
    t += STEP_MS;
    at(t, () => setProgress(s, stage));
  }
  if (mode.failNext) {
    mode.failNext = false;
    return at(t + STEP_MS, () => {
      setProgress(s, 'failed', { error: 'Kitapçık sayfası okunamadı' });
      s.status = 'failed';
    });
  }
  t += STEP_MS;
  at(t, () => {
    s.score = SCORE;
    s.status = 'analysing';
    setProgress(s, 'analyse');
    const exam = tables.exams.find((x) => x.id === s.exam_id);
    if (exam) Object.assign(exam, { status: 'ready', answer_key_source: mode.keySource });
    s.responses = [
      { id: uuid('eeee0001'), no: 3, section: 'mat', outcome: 'wrong', how_far_text: null, work_upload_ids: [], blank_reason: null, solution_analysis_id: null },
      { id: uuid('eeee0001'), no: 5, section: 'mat', outcome: 'blank', how_far_text: null, work_upload_ids: [], blank_reason: null, solution_analysis_id: null },
      { id: uuid('eeee0001'), no: 6, section: 'mat', outcome: 'blank', how_far_text: null, work_upload_ids: [], blank_reason: null, solution_analysis_id: null },
    ];
  });
  t += REPORT_MS;
  at(t, () => {
    const doc = { id: uuid('dddd0001'), student_id: STUDENT_ID, course_id: COURSE_ID, kind: 'report', title: 'Deneme raporu', pdf_path: `${STUDENT_ID}/deneme-rapor-${seq}.pdf`, status: 'rendered', created_at: new Date().toISOString() };
    tables.generated_documents.push(doc);
    s.report_document_id = doc.id;
    s.status = 'done';
    setProgress(s, 'done', { report_status: 'rendered' });
  });
}

function itemState(r) {
  if (r.solution_analysis_id) return 'diagnosed';
  if (r.blank_reason) return 'reason_given';
  if (r.how_far_text || r.work_upload_ids.length > 0) return 'pending';
  return 'needs_input';
}

function viewOf(tables, s, parent) {
  const exam = tables.exams.find((x) => x.id === s.exam_id) ?? {};
  const graded = ['analysing', 'done'].includes(s.status) && Boolean(s.score);
  const report = s.report_document_id ? tables.generated_documents.find((d) => d.id === s.report_document_id) : null;
  const sc = s.score;
  const items = graded && !parent
    ? (s.responses ?? []).map((r) => {
        const sa = r.solution_analysis_id ? tables.solution_analyses.find((a) => a.id === r.solution_analysis_id) : null;
        return {
          response_id: r.id, exam_question_id: r.id, no: r.no, section: r.section, kind: 'mcq', outcome: r.outcome, answer: null, stem_text: null, options: [],
          page_upload_id: null, bbox: null, figure_upload_id: null, skill_ids: [], how_far_text: r.how_far_text, work_upload_ids: r.work_upload_ids,
          blank_reason: r.blank_reason, solution_analysis_id: r.solution_analysis_id,
          diagnosis: sa ? { verdict: sa.verdict, error_cause: sa.error_cause, failing_step_no: sa.failing_step_no, one_line: sa.analysis.one_line } : null,
          state: itemState(r),
        };
      })
    : [];
  return {
    session_id: s.id, exam_id: s.exam_id, title: exam.title ?? 'Deneme', kind: 'deneme', source: exam.source ?? 'in_app', mode: s.mode, status: s.status, pending: !graded,
    progress: s.progress ?? null, started_at: s.started_at ?? null, finished_at: null, duration_sec: null, deadline_at: null, is_copyrighted: Boolean(exam.is_copyrighted),
    answer_key_source: exam.answer_key_source ?? null, pages: parent ? [] : (s.upload_ids ?? []),
    report: report ? { id: report.id, status: report.status, pdf_path: report.pdf_path } : null,
    summary: graded
      ? { ...sc, sections: undefined, weakest: { skill_id: HEAT[0].skill_id, name: HEAT[0].name }, top_cause: 'procedure',
          one_line: '6 soruda 3 doğru, 1 yanlış, 2 boş. Net 2,75. En çok zorlandığın konu: Birinci dereceden denklemler.' }
      : null,
    sections: graded ? [{ section: 'mat', title: 'Matematik', total: 6, correct: 3, wrong: 1, blank: 2, unfinished: 0, net: 2.75 }] : [],
    heatmap: graded ? HEAT : [],
    items, items_hidden: parent,
  };
}

const rpcs = {
  submit_exam_upload(tables, caller, body) {
    const st = studentOf(tables, caller);
    if (!st) return err('42501', 'OGR-AUTH-001 deneme yüklemesi yalnız öğrenci oturumunda gönderilir', 403);
    const ids = Array.isArray(body.p_upload_ids) ? body.p_upload_ids : [];
    if (ids.length < 1 || ids.length > 40 || new Set(ids).size !== ids.length) return err('P0001', `OGR-UPL-001 okul denemesi için 1–40 tekil sayfa gerekir (gelen ${ids.length})`);
    const rows = ids.map((id) => tables.uploads.find((u) => u.id === id && u.owner_id === caller.id));
    if (rows.some((r) => !r)) return err('P0001', 'OGR-UPL-002 yükleme bulunamadı ya da senin değil');
    for (const r of rows) r.status ??= 'stored';
    if (rows.some((r) => r.status !== 'stored')) return err('P0001', 'OGR-UPL-003 sayfaların bir kısmı başka bir gönderimde işleniyor');
    const examId = uuid('eeee0002');
    const sessionId = uuid('eeee0003');
    tables.exams.push({ id: examId, title: 'Okul denemesi', kind: 'deneme', source: 'uploaded', is_copyrighted: true, status: 'processing', question_count: 0, duration_min: null, answer_key_source: null });
    const s = { id: sessionId, exam_id: examId, enrollment_id: E2E_ENROLLMENT_ID, mode: 'uploaded', status: 'grading', upload_ids: ids, started_at: new Date().toISOString(), progress: { stage: 'classify', pages_total: ids.length, pages_done: 0 }, score: null, responses: [], report_document_id: null };
    tables.exam_sessions.push(s);
    for (const r of rows) r.status = 'processing';
    simulate(tables, s, ids.length);
    return { status: 200, body: { exam_id: examId, session_id: sessionId, enrollment_id: E2E_ENROLLMENT_ID, job_id: `job-${++seq}`, upload_ids: ids, reused: false } };
  },

  exam_session_view(tables, caller, body) {
    const s = tables.exam_sessions.find((x) => x.id === body.p_session);
    if (!s) return err('P0001', 'OGR-EXAM-001 oturum bulunamadı');
    const own = studentOf(tables, caller);
    const parent = !own && parentOf(tables, caller, STUDENT_ID);
    if (!own && !parent) return err('42501', 'OGR-AUTH-001 bu oturum için yetki yok', 403);
    return { status: 200, body: viewOf(tables, s, parent) };
  },

  exam_how_far(tables, caller, body) {
    if (!studentOf(tables, caller)) return err('42501', 'OGR-AUTH-001 yetki yok', 403);
    const s = tables.exam_sessions.find((x) => (x.responses ?? []).some((r) => r.id === body.p_response));
    const r = s?.responses.find((x) => x.id === body.p_response);
    if (!r) return err('P0001', 'OGR-EXAM-001 cevap bulunamadı');
    const text = typeof body.p_text === 'string' && body.p_text.trim() ? body.p_text.trim() : null;
    const ids = Array.isArray(body.p_upload_ids) ? body.p_upload_ids : [];
    if (!text && ids.length === 0) return err('P0001', 'OGR-EXAM-007 metin ya da en az bir fotoğraf gerekir');
    if (r.solution_analysis_id || r.how_far_text || r.work_upload_ids.length > 0) return err('P0001', 'OGR-EXAM-009 bu soru zaten teşhis edildi');
    r.how_far_text = text;
    r.work_upload_ids = ids;
    for (const id of ids) {
      const u = tables.uploads.find((x) => x.id === id);
      if (u) u.status = 'processing';
    }
    // teşhis benzetimi
    setTimeout(() => {
      const id = uuid('bbbb0001');
      tables.solution_analyses.push({
        id, enrollment_id: E2E_ENROLLMENT_ID, upload_ids: ids, question_text: '$2(x+1) - 3(x-2) = 4$ olduğuna göre $x$ kaçtır?', analysis: E2E_ANALYSIS, verdict: 'wrong', failing_step_no: 3,
        error_cause: 'procedure', skill_ids: ['tyt.mat.cebir.denklem', 'tyt.mat.temel.sayilar'], misconception_tags: ['sayilar.parantez-eksi-dagitma'], created_at: new Date().toISOString(),
      });
      r.solution_analysis_id = id;
      for (const uid of ids) {
        const u = tables.uploads.find((x) => x.id === uid);
        if (u) u.status = 'ready';
      }
    }, 1500);
    return { status: 200, body: { response_id: r.id, job_id: `job-${++seq}`, reused: false } };
  },

  exam_blank_reason(tables, caller, body) {
    if (!studentOf(tables, caller)) return err('42501', 'OGR-AUTH-001 yetki yok', 403);
    if (!['not_started', 'time'].includes(body.p_reason)) return err('P0001', 'OGR-EXAM-007 geçersiz neden');
    const s = tables.exam_sessions.find((x) => (x.responses ?? []).some((r) => r.id === body.p_response));
    const r = s?.responses.find((x) => x.id === body.p_response);
    if (!r) return err('P0001', 'OGR-EXAM-001 cevap bulunamadı');
    if (r.outcome === 'wrong') return err('P0001', 'OGR-EXAM-007 neden yalnız boş bırakılan soru için');
    if (r.blank_reason && r.blank_reason !== body.p_reason) return err('P0001', 'OGR-EXAM-009 neden zaten verildi');
    const changed = r.blank_reason !== body.p_reason;
    r.blank_reason = body.p_reason;
    return { status: 200, body: { response_id: r.id, blank_reason: r.blank_reason, observations_marked: 0, changed } };
  },

  list_my_documents(tables, caller, body) {
    const own = studentOf(tables, caller);
    // gerçek RPC gibi: veli p_student vermezse tüm çocuklarının hazır raporlarını görür
    const kids = !own && caller ? tables.guardian_links.filter((l) => l.parent_id === caller.id && l.status === 'active' && (!body.p_student || l.student_id === body.p_student)).map((l) => l.student_id) : [];
    if (!own && kids.length === 0) return err('42501', 'OGR-AUTH-001 belge listesi öğrenci ya da veli içindir', 403);
    const parent = !own;
    const sids = own ? [own.id] : kids;
    const docs = tables.generated_documents
      .filter((d) => d.kind !== 'answer_key' && sids.includes(d.student_id) && (!body.p_kind || d.kind === body.p_kind) && (!parent || (d.kind === 'report' && ['rendered', 'published'].includes(d.status))))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .map((d) => ({ ...d, version: 1, html_path: null, course_title: 'TYT Matematik', scope: 'personal', exam_session_id: tables.exam_sessions.find((s) => s.report_document_id === d.id)?.id ?? null, updated_at: d.created_at }));
    return { status: 200, body: { documents: docs, count: docs.length } };
  },
};

export async function handleExamResult({ req, res, path, tables, send, readBody, userFromAuth }) {
  if (path === '/__examresult') return send(res, 200, { sessions: tables.exam_sessions.filter((s) => s.mode === 'uploaded'), uploads: tables.uploads, exams: tables.exams.filter((x) => x.source === 'uploaded') }), true;
  if (path === '/__examresult/cleanup') {
    const mine = tables.exam_sessions.filter((x) => x.mode === 'uploaded');
    const docIds = new Set(mine.map((x) => x.report_document_id).filter(Boolean));
    tables.generated_documents = tables.generated_documents.filter((d) => !docIds.has(d.id));
    tables.exam_sessions = tables.exam_sessions.filter((x) => x.mode !== 'uploaded');
    tables.exams = tables.exams.filter((x) => x.source !== 'uploaded');
    tables.solution_analyses = tables.solution_analyses.filter((a) => !String(a.id).startsWith('bbbb0001'));
    mode.failNext = false;
    return send(res, 200, { ok: true }), true;
  }
  if (path === '/__examresult/fail-next') return (mode.failNext = true), send(res, 200, { ok: true }), true;
  if (path === '/__examresult/key-source') {
    mode.keySource = new URL(req.url, 'http://x').searchParams.get('value') || 'inferred';
    return send(res, 200, { ok: true }), true;
  }
  // Veli, çocuğunun raporunu imzalı adresle açar (öğrenci imzası fake-practice'te)
  const sign = /^\/storage\/v1\/object\/sign\/documents\/(.+)$/.exec(path);
  if (sign && req.method === 'POST') {
    const user = userFromAuth(req);
    const name = decodeURIComponent(sign[1]);
    const doc = tables.generated_documents.find((d) => d.pdf_path === name);
    if (user && doc && !studentOf(tables, user) && parentOf(tables, user, doc.student_id) && doc.kind === 'report') return send(res, 200, { signedURL: `/object/sign/documents/${sign[1]}?token=e2e` }), true;
    return false;
  }
  const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(path);
  if (rpc && req.method === 'POST' && Object.hasOwn(rpcs, rpc[1])) {
    const body = await readBody(req);
    const out = rpcs[rpc[1]](tables, userFromAuth(req), body);
    return send(res, out.status, out.body), true;
  }
  return false;
}

export const E2E_RESULT_USERS = { student: USERS.student, parent: USERS.parent };
export { COURSE_ID, CURRICULUM_ID };
