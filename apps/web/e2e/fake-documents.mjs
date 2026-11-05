// Sahte Supabase'in belge hattı eki (e2e/fake-supabase.mjs çağırır): request_document, document_request_view,
// review_document, list_my_documents (0034/0035 yanıt biçimleri) ve eğitmenin toplu imzalı adresi. Worker zamanlayıcıyla
// benzetilir: queued → generating → (not) ready/published + Bugün kartı; (deneme) review → eğitmen onayı → published.
// Gerçek yetki, kapsam ve yayın kapısı supabase/tests/22-23'te sınanır.
import { USERS } from './fixtures.mjs';

const COURSE_ID = '50000000-0000-4000-8000-000000000001';
const STEP_MS = 900;
let seq = 0;
const uuid = (p) => `${p}-0000-4000-8000-${String(++seq + 9000).padStart(12, '0')}`;
const err = (code, message, status = 400) => ({ status, body: { code, message, details: null, hint: null } });
const studentOf = (tables, caller) => (caller ? (tables.students.find((s) => s.profile_id === caller.id) ?? null) : null);
const isStaff = (tables, caller) => Boolean(caller && tables.profiles.find((p) => p.id === caller.id && ['instructor', 'admin'].includes(p.role)));

const LINES = { queued: 'Sıraya aldım', generating: 'Hazırlıyorum', verifying: 'Kontrol ediyorum', review: 'Hocan inceliyor', ready: 'Hazır', failed: 'Hazırlayamadım; tekrar isteyebilirsin' };
const PASSED = { schema: { status: 'pass' }, sympy: { status: 'pass', summary: '8 çözüm doğrulandı' }, figures: { status: 'pass' }, duplicates: { status: 'skipped' }, personalization: { status: 'pass' } };

function examOf(tables, docId) {
  return (tables.exams ?? []).find((x) => x.generated_document_id === docId && ['ready', 'published'].includes(x.status)) ?? null;
}

function viewOf(tables, req, caller) {
  const d = tables.generated_documents.find((x) => x.id === req.generated_document_id);
  const masked = Boolean(d?.review_required && d.status !== 'published') && !isStaff(tables, caller);
  return {
    request_id: req.id, kind: req.kind, status: req.status, status_line: LINES[req.status], source: req.source, spec: req.spec, student_id: req.student_id,
    enrollment_id: null, course_id: COURSE_ID, conversation_message_id: null, error: req.status === 'failed' ? req.error : null, created_at: req.created_at, updated_at: req.created_at,
    exam_id: d ? (examOf(tables, d.id)?.id ?? null) : null,
    document: d ? { id: d.id, title: d.title, status: d.status, version: 1, pdf_path: masked ? null : d.pdf_path, html_path: null, review_required: d.review_required, published_at: d.published_at ?? null } : null,
  };
}

function publish(tables, d, req) {
  d.status = 'published';
  d.published_at = new Date().toISOString();
  req.status = 'ready';
  let exam = null;
  if (d.kind === 'mock_exam') {
    exam = { id: uuid('eeeeeeee'), title: d.title, status: 'ready', question_count: 3, duration_min: 75, generated_document_id: d.id };
    (tables.exams ??= []).push(exam);
  }
  tables.suggestions.push({
    id: uuid('5a000000'), student_id: d.student_id, enrollment_id: null, consumed_at: null, expires_at: null, subtitle: null, created_at: new Date().toISOString(), rank: 60,
    kind: 'document_ready', title: d.kind === 'mock_exam' ? 'Denemen hazır' : `${d.title} notun hazır`, payload: { document_id: d.id, kind: d.kind, ...(exam ? { exam_id: exam.id } : {}) },
  });
}

function simulate(tables, d, req) {
  setTimeout(() => {
    d.status = 'generating';
    req.status = 'generating';
  }, STEP_MS);
  setTimeout(() => {
    d.pdf_path = `${d.student_id}/${d.id}.pdf`;
    d.verification = PASSED;
    if (d.review_required) {
      d.status = 'review';
      req.status = 'review';
    } else publish(tables, d, req);
  }, STEP_MS * 2.5);
}

const rpcs = {
  request_document(tables, caller, body) {
    const st = studentOf(tables, caller);
    if (!st) return err('42501', 'OGR-AUTH-001 öğrenci değil', 403);
    const spec = body.p_spec ?? {};
    const kind = body.p_kind;
    if (!['notes', 'mock_exam', 'question_set'].includes(kind)) return err('P0001', 'OGR-DOC-001 geçersiz belge türü');
    if (kind !== 'mock_exam' && !spec.topic && !(spec.skill_ids ?? []).length) return err('P0001', 'OGR-DOC-005 not ve soru seti için konu ya da kazanım gerekli');
    const title = spec.title ?? (kind === 'mock_exam' ? `${spec.question_count ?? 40} soruluk deneme` : String(spec.topic).replace(/^./u, (c) => c.toLocaleUpperCase('tr')));
    const d = { id: uuid('dddddddd'), student_id: st.id, course_id: COURSE_ID, kind, title, status: 'queued', review_required: kind === 'mock_exam', pdf_path: null, verification: null, created_at: new Date().toISOString() };
    const req = { id: uuid('99999999'), kind, status: 'queued', source: body.p_source ?? 'chat', spec, student_id: st.id, generated_document_id: d.id, created_at: d.created_at };
    tables.generated_documents.push(d);
    (tables.document_requests ??= []).push(req);
    simulate(tables, d, req);
    return { status: 200, body: { ...viewOf(tables, req, caller), job_id: 'job-doc', reused: false } };
  },

  document_request_view(tables, caller, body) {
    const req = (tables.document_requests ?? []).find((r) => r.id === body.p_id);
    const st = studentOf(tables, caller);
    if (!req || (!isStaff(tables, caller) && req.student_id !== st?.id)) return err('42501', 'OGR-AUTH-001 istek bulunamadı ya da senin değil', 403);
    return { status: 200, body: viewOf(tables, req, caller) };
  },

  review_document(tables, caller, body) {
    if (!isStaff(tables, caller)) return err('42501', 'OGR-AUTH-002 belgeyi yalnız eğitmen inceler', 403);
    const d = tables.generated_documents.find((x) => x.id === body.p_id);
    if (!d) return err('P0001', 'OGR-DOC-001 belge bulunamadı');
    if (d.status !== 'review') return err('P0001', `OGR-DOC-006 belge incelemede değil (${d.status})`);
    const req = (tables.document_requests ?? []).find((r) => r.generated_document_id === d.id);
    d.review_note = body.p_note ?? null;
    if (body.p_decision === 'approve') {
      d.verification = { ...d.verification, review: { status: 'pass' } };
      publish(tables, d, req);
    } else {
      d.status = 'failed';
      req.status = 'failed';
    }
    return { status: 200, body: { document_id: d.id, decision: body.p_decision, document_status: d.status, request: viewOf(tables, req, caller) } };
  },

  list_my_documents(tables, caller, body) {
    const st = studentOf(tables, caller);
    if (!st) return null;
    const docs = tables.generated_documents
      .filter((d) => d.kind !== 'answer_key' && d.student_id === st.id && (!body.p_kind || d.kind === body.p_kind))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .map((d) => {
        const req = (tables.document_requests ?? []).find((r) => r.generated_document_id === d.id);
        const masked = Boolean(d.review_required && d.status !== 'published');
        return {
          id: d.id, kind: d.kind, title: d.title, status: d.status, version: 1, pdf_path: masked ? null : d.pdf_path, html_path: null, student_id: d.student_id, course_id: d.course_id,
          course_title: 'TYT Matematik', scope: 'personal', exam_session_id: tables.exam_sessions?.find((s) => s.report_document_id === d.id)?.id ?? null,
          review_required: Boolean(d.review_required), published_at: d.published_at ?? null, request_id: req?.id ?? null, request_status: req?.status ?? null,
          exam_id: examOf(tables, d.id)?.id ?? null, created_at: d.created_at, updated_at: d.created_at,
        };
      });
    return { status: 200, body: { documents: docs, count: docs.length } };
  },
};

export async function handleDocuments({ req, res, path, tables, send, readBody, userFromAuth }) {
  if (path === '/__documents') return send(res, 200, { documents: tables.generated_documents, requests: tables.document_requests ?? [] }), true;
  if (path === '/__documents/cleanup') {
    const mine = new Set((tables.document_requests ?? []).map((r) => r.generated_document_id));
    tables.generated_documents = tables.generated_documents.filter((d) => !mine.has(d.id));
    tables.document_requests = [];
    tables.suggestions = tables.suggestions.filter((s) => s.kind !== 'document_ready' || !mine.has(s.payload?.document_id));
    tables.exams = (tables.exams ?? []).filter((x) => !x.generated_document_id);
    return send(res, 200, { ok: true }), true;
  }
  // Eğitmen: incelemedeki PDF'ler için toplu imzalı adres (supabase-js createSignedUrls).
  if (path === '/storage/v1/object/sign/documents' && req.method === 'POST') {
    const caller = userFromAuth(req);
    if (!isStaff(tables, caller)) return send(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' }), true;
    const body = await readBody(req);
    return send(res, 200, (body.paths ?? []).map((p) => ({ error: null, path: p, signedURL: `/object/sign/documents/${p}?token=e2e` }))), true;
  }
  const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(path);
  if (rpc && req.method === 'POST' && Object.hasOwn(rpcs, rpc[1])) {
    const caller = userFromAuth(req);
    // list_my_documents öğrenci dışında (veli) fake-exam-result'a kalır; gövde okunmadan bırakılmalı (akış tek okunur).
    if (rpc[1] === 'list_my_documents' && !studentOf(tables, caller)) return false;
    const body = await readBody(req);
    const out = rpcs[rpc[1]](tables, caller, body);
    return send(res, out.status, out.body), true;
  }
  return false;
}

export const E2E_DOC_USERS = { student: USERS.student, instructor: USERS.instructor };
