// Sahte Supabase'in uygulama içi sınav eki (e2e/fake-supabase.mjs çağırır): start_exam_session / record_exam_response /
// finish_exam_session (0031_exam_inapp.sql) ve v_exam_questions_student yanıt biçimlerini taklit eder. Süre sınırı ve
// tolerans (30 sn) sunucudadır: sahte de aynı kuralı uygular. Gerçek notlama/RLS/süre denetimi supabase/tests/19_exam_inapp.sql'dedir.
import { USERS } from './fixtures.mjs';

export const E2E_EXAM_ID = 'eeeeeeee-0000-4000-8000-000000000001';
const STUDENT_ID = '10000000-0000-4000-8000-000000000001';
const ENROLLMENT_ID = '10000000-0000-4000-8000-0000000000e1';
const NOW = '2026-11-04T08:00:00+00:00';
const GRACE_MS = 30_000;

const qid = (n) => `eeeeeeee-0000-4000-8000-${String(n + 100).padStart(12, '0')}`;
const OPTS = (texts) => texts.map((t, i) => ({ key: 'ABCDE'[i], text: t }));

export function seedExamTables() {
  return {
    exams: [{ id: E2E_EXAM_ID, title: 'TYT Matematik Deneme 1', status: 'ready', question_count: 3, duration_min: 75 }],
    v_exam_questions_student: [
      { id: qid(1), exam_id: E2E_EXAM_ID, no: 1, section: 'mat', kind: 'mcq', stem_text: '`-3(x-2)` ifadesinin eşiti hangisidir?', options: OPTS(['`-3x-6`', '`-3x+6`', '`3x-6`', '`-3x-2`', '`3x+6`']), is_copyrighted: false, figure_upload_id: null, page_upload_id: null, bbox: null, skill_ids: [] },
      { id: qid(2), exam_id: E2E_EXAM_ID, no: 2, section: 'mat', kind: 'mcq', stem_text: '`2x+4=10` ise `x` kaçtır?', options: OPTS(['`1`', '`2`', '`3`', '`4`', '`5`']), is_copyrighted: false, figure_upload_id: null, page_upload_id: null, bbox: null, skill_ids: [] },
      { id: qid(3), exam_id: E2E_EXAM_ID, no: 3, section: 'mat', kind: 'mcq', stem_text: '`5!/3!` kaçtır?', options: OPTS(['`10`', '`20`', '`30`', '`40`', '`60`']), is_copyrighted: false, figure_upload_id: null, page_upload_id: null, bbox: null, skill_ids: [] },
    ],
    exam_responses: [],
  };
}

const err = (code, message, status = 400) => ({ status, body: { code, message, details: null, hint: null } });

function studentOf(tables, caller) {
  return caller ? (tables.students.find((s) => s.profile_id === caller.id) ?? null) : null;
}

function deadlineOf(tables, session) {
  const exam = tables.exams.find((x) => x.id === session.exam_id);
  return exam?.duration_min ? Date.parse(session.started_at) + exam.duration_min * 60_000 : null;
}

function stateOf(tables, session) {
  const exam = tables.exams.find((x) => x.id === session.exam_id);
  const deadline = deadlineOf(tables, session);
  const now = Date.now();
  const qs = tables.v_exam_questions_student.filter((q) => q.exam_id === session.exam_id);
  return {
    session_id: session.id,
    exam_id: session.exam_id,
    enrollment_id: session.enrollment_id,
    title: exam.title,
    mode: 'in_app',
    status: session.status,
    started_at: session.started_at,
    server_now: new Date(now).toISOString(),
    duration_min: exam.duration_min,
    deadline_at: deadline ? new Date(deadline).toISOString() : null,
    remaining_sec: deadline ? Math.max(0, Math.floor((deadline - now) / 1000)) : null,
    expired: deadline ? deadline <= now : false,
    question_count: qs.length,
    sections: [],
    answers: tables.exam_responses
      .filter((r) => r.session_id === session.id)
      .map((r) => ({ exam_question_id: r.exam_question_id, no: qs.find((q) => q.id === r.exam_question_id)?.no, answer: r.answer, flagged: r.flagged, has_work: r.work_upload_ids.length > 0 })),
  };
}

const rpcs = {
  start_exam_session(tables, caller, body) {
    const st = studentOf(tables, caller);
    if (!st) return err('42501', 'OGR-AUTH-001 uygulama içi deneme yalnız öğrenci oturumunda başlar', 403);
    const exam = tables.exams.find((x) => x.id === body.p_exam);
    if (!exam) return err('P0001', 'OGR-EXAM-001 sınav bulunamadı');
    let s = tables.exam_sessions.find((x) => x.exam_id === exam.id && x.mode === 'in_app' && x.status === 'in_progress');
    if (!s) {
      s = { id: `eeeeeeee-0000-4000-8000-${String(900 + tables.exam_sessions.length).padStart(12, '0')}`, exam_id: exam.id, enrollment_id: ENROLLMENT_ID, mode: 'in_app', status: 'in_progress', started_at: new Date().toISOString() };
      tables.exam_sessions.push(s);
    }
    return { status: 200, body: stateOf(tables, s) };
  },

  // exam_clock (0033): salt okur; yeni oturum açmaz, yalnız süren oturumun sınırını ve sunucu saatini döner
  exam_clock(tables, caller, body) {
    if (!studentOf(tables, caller)) return err('42501', 'OGR-AUTH-001 bu oturum için yetki yok', 403);
    const s = tables.exam_sessions.find((x) => x.id === body.p_session);
    if (!s) return err('42501', 'OGR-AUTH-001 bu oturum için yetki yok', 403);
    const st = stateOf(tables, s);
    return { status: 200, body: { session_id: st.session_id, status: st.status, deadline_at: st.deadline_at, server_now: st.server_now } };
  },

  record_exam_response(tables, caller, body) {
    const s = tables.exam_sessions.find((x) => x.id === body.p_session);
    if (!s) return err('P0001', 'OGR-EXAM-001 oturum bulunamadı');
    const q = tables.v_exam_questions_student.find((x) => x.id === body.p_exam_question && x.exam_id === s.exam_id);
    if (!q) return err('P0001', 'OGR-EXAM-004 soru bu oturumun sınavında değil');
    const answer = typeof body.p_answer === 'string' && body.p_answer.trim() ? body.p_answer.trim().toUpperCase() : null;
    const deadline = deadlineOf(tables, s);
    if (s.status !== 'in_progress') return err('P0001', `OGR-EXAM-003 oturum ${s.status}: yeni cevap yazılamaz`);
    if (deadline && Date.now() > deadline + GRACE_MS) return err('P0001', 'OGR-EXAM-008 süre doldu: cevap yazılamaz, oturumu bitir');
    let r = tables.exam_responses.find((x) => x.session_id === s.id && x.exam_question_id === q.id);
    if (!r) {
      r = { id: `eeeeeeee-0000-4000-8000-${String(500 + tables.exam_responses.length).padStart(12, '0')}`, session_id: s.id, exam_question_id: q.id, answer: null, flagged: false, work_upload_ids: [], time_spent_sec: null };
      tables.exam_responses.push(r);
    }
    r.answer = answer;
    r.flagged = body.p_flagged ?? r.flagged;
    r.time_spent_sec = body.p_time_spent_sec ?? r.time_spent_sec;
    if (Array.isArray(body.p_work_upload_ids)) r.work_upload_ids = body.p_work_upload_ids;
    return { status: 200, body: r.id };
  },

  finish_exam_session(tables, caller, body) {
    const s = tables.exam_sessions.find((x) => x.id === body.p_session);
    if (!s) return err('P0001', 'OGR-EXAM-001 oturum bulunamadı');
    if (s.status === 'in_progress') s.status = 'analysing';
    return { status: 200, body: { session_id: s.id, status: s.status } };
  },
};

export async function handleExam({ req, res, path, tables, send, readBody, userFromAuth }) {
  if (path === '/__exam') return send(res, 200, { sessions: tables.exam_sessions.filter((s) => s.mode === 'in_app'), responses: tables.exam_responses, uploads: tables.uploads }), true;
  if (path === '/__exam/suggest') {
    // Bugün'e mini_exam önerisi (rank en üstte)
    tables.suggestions.push({ id: 'eeeeeeee-0000-4000-8000-0000000000a1', student_id: STUDENT_ID, enrollment_id: ENROLLMENT_ID, kind: 'mini_exam', title: 'TYT Matematik Deneme 1', subtitle: '3 soru · 75 dk', payload: { exam_id: E2E_EXAM_ID }, rank: -10, expires_at: null, consumed_at: null, created_at: NOW });
    return send(res, 200, { ok: true }), true;
  }
  if (path === '/__exam/age') {
    // oturumların başlangıcını 2 saat geriye çek (75 dk süre doldu)
    for (const s of tables.exam_sessions.filter((x) => x.mode === 'in_app')) s.started_at = new Date(Date.now() - 2 * 3600_000).toISOString();
    return send(res, 200, { ok: true }), true;
  }
  if (path === '/__exam/cleanup') {
    tables.suggestions = tables.suggestions.filter((s) => s.kind !== 'mini_exam');
    tables.exam_sessions = tables.exam_sessions.filter((s) => s.mode !== 'in_app');
    tables.exam_responses.length = 0;
    return send(res, 200, { ok: true }), true;
  }
  const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(path);
  if (rpc && req.method === 'POST' && Object.hasOwn(rpcs, rpc[1])) {
    const body = await readBody(req);
    const out = rpcs[rpc[1]](tables, userFromAuth(req), body);
    return send(res, out.status, out.body), true;
  }
  return false;
}

export const E2E_EXAM_USER = USERS.student;
