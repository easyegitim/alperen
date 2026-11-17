// Sahte Supabase'in Onboarding → Bugün → Test → Sonuç → Gelişim eki (e2e/fake-supabase.mjs çağırır). P1 RPC'lerinin
// (0020 suggestions, 0021 practice, 0022 onboarding; supabase/README.md "P1 RPC'leri") yanıt biçimlerini taklit eder;
// worker benzetimi: onboarding_enroll'dan ~3 sn sonra müfredat taslağı "ready" olur ve öneriler + bir not belgesi yazılır.
// Gerçek notlama, BKT ve RLS test/student-flow.db.test.ts'te gerçek Postgres'le sınanır.
import { USERS } from './fixtures.mjs';

const NOW = '2026-11-03T09:00:00+00:00';
const CURRICULUM_ID = '60000000-0000-4000-8000-000000000001';
const DOC_ID = 'dddddddd-0000-4000-8000-000000000001';
export const E2E_DRAFT_MS = 3000;

let seq = 0;
const uuid = (prefix) => `${prefix}-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

/** Soru bankası (anahtar yalnız burada; yanıtlara girmez). */
const QUESTIONS = [
  {
    id: 'cccccccc-0000-4000-8000-000000000001',
    kind: 'mcq',
    stem: 'Sayı doğrusunda A ile B noktalarının tam ortasındaki sayı kaçtır?',
    figure: { id: 'ffffffff-0000-4000-8000-000000000001', png_path: 'figures/sayi-dogrusu.svg', svg_path: null, alt_text: 'Sayı doğrusu: −1 ile 1 arası çeyrek çentikli. A noktası −3/4, B noktası 1/2 üzerinde.' },
    options: [
      { key: 'A', text: '`-1/4`', misconception_tag: 'rasyonel.orta-nokta-toplam' },
      { key: 'B', text: '`-1/8`', misconception_tag: null },
      { key: 'C', text: '`1/8`', misconception_tag: 'rasyonel.isaret' },
      { key: 'D', text: '`-5/8`', misconception_tag: null },
      { key: 'E', text: '`1/4`', misconception_tag: null },
    ],
    key: 'B',
    skill: { id: 'tyt.mat.rasyonel', name: 'Rasyonel sayılar' },
  },
  {
    id: 'cccccccc-0000-4000-8000-000000000002',
    kind: 'mcq',
    stem: '`-3(x-2)` ifadesinin eşiti hangisidir?',
    figure: null,
    options: [
      { key: 'A', text: '`-3x-6`', misconception_tag: 'sayilar.parantez-eksi-dagitma' },
      { key: 'B', text: '`-3x+6`', misconception_tag: null },
      { key: 'C', text: '`3x-6`', misconception_tag: null },
      { key: 'D', text: '`-3x-2`', misconception_tag: null },
      { key: 'E', text: '`3x+6`', misconception_tag: null },
    ],
    key: 'B',
    skill: { id: 'tyt.mat.temel.sayilar', name: 'Sayı kümeleri, işlem önceliği, işaret kuralları' },
  },
];

const TAG_TEXT = {
  'sayilar.parantez-eksi-dagitma': 'Eksi işareti parantezdeki her terime dağılır.',
  'rasyonel.orta-nokta-toplam': 'Orta nokta iki sayının toplamının yarısıdır.',
  'rasyonel.isaret': 'Negatif kesrin yeri sıfırın solundadır.',
};

const FIGURE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 92" width="300" height="92"><line x1="14" y1="50" x2="286" y2="50" stroke="#051c60" stroke-width="2"/><circle cx="60" cy="50" r="5.5" fill="#051c60"/><circle cx="210" cy="50" r="5.5" fill="#051c60"/><text x="60" y="30" text-anchor="middle" font-size="15" fill="#051c60">A</text><text x="210" y="30" text-anchor="middle" font-size="15" fill="#051c60">B</text><text x="30" y="78" text-anchor="middle" font-size="13" fill="#051c60">-1</text><text x="150" y="78" text-anchor="middle" font-size="13" fill="#051c60">0</text><text x="270" y="78" text-anchor="middle" font-size="13" fill="#051c60">1</text></svg>`;

function tinyPdf(text) {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = `BT /F1 24 Tf 72 760 Td (${text}) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

export function seedPracticeTables() {
  return {
    curricula: [{ id: CURRICULUM_ID, code: 'TYT-MAT', version: '2026.1', label: 'TYT Matematik', status: 'active', origin: 'seed', draft_status: null, draft_progress: 0, created_at: NOW, published_at: NOW }],
    suggestions: [],
    practice_sets: [],
    practice_items: [],
    attempts: [],
    exam_sessions: [],
    generated_documents: [],
    mastery_view: [],
  };
}

const err = (code, message, status = 400) => ({ status, body: { code, message, details: null, hint: null } });

function studentOf(tables, caller) {
  if (!caller) return null;
  return tables.students.find((s) => s.profile_id === caller.id) ?? null;
}

function setJson(tables, ps) {
  const items = tables.practice_items
    .filter((i) => i.set_id === ps.id)
    .sort((a, b) => a.no - b.no)
    .map((i) => {
      const q = QUESTIONS.find((x) => x.id === i.question_id);
      const a = tables.attempts.find((x) => x.id === i.attempt_id);
      return {
        no: i.no,
        question_id: q.id,
        kind: q.kind,
        stem: q.stem,
        stem_values: {},
        options: q.options.map(({ key, text }) => ({ key, text })),
        figure: q.figure,
        skill_ids: [q.skill.id],
        answered: Boolean(i.attempt_id),
        correct: a ? a.is_correct : null,
      };
    });
  return {
    set_id: ps.id,
    enrollment_id: ps.enrollment_id,
    suggestion_id: ps.suggestion_id,
    status: ps.status,
    skill_ids: ps.skill_ids,
    target_count: ps.target_count,
    started_at: ps.started_at,
    finished_at: ps.finished_at,
    summary: ps.summary,
    total: items.length,
    answered: items.filter((i) => i.answered).length,
    items,
  };
}

/** Worker benzetimi: taslak hazır → kazanımlar, öneriler (kahraman + 2 kutu + belge kartı), not belgesi. */
function draftReady(tables, { curriculumId, studentId, enrollmentId, courseId }) {
  const cur = tables.curricula.find((c) => c.id === curriculumId);
  if (!cur) return;
  Object.assign(cur, { status: 'active', draft_status: 'ready', draft_progress: 100, published_at: new Date().toISOString() });
  tables.generated_documents.push({ id: DOC_ID, student_id: studentId, course_id: courseId, kind: 'notes', title: 'Rasyonel sayılar', pdf_path: `${studentId}/rasyonel-not.pdf`, status: 'published', created_at: new Date().toISOString() });
  const base = { student_id: studentId, enrollment_id: enrollmentId, consumed_at: null, expires_at: null, subtitle: null, created_at: new Date().toISOString() };
  tables.suggestions.push(
    { ...base, id: uuid('5a000000'), kind: 'practice', title: 'Rasyonel sayılar', payload: { count: 2, minutes: 4 }, rank: 0 },
    { ...base, id: uuid('5a000000'), kind: 'weekly_homework', title: 'Haftalık ödev', payload: { count: 10, minutes: 20 }, rank: 10 },
    { ...base, id: uuid('5a000000'), kind: 'lesson_review', title: 'Ders tekrarı', payload: { count: 5, minutes: 15 }, rank: 20 },
    { ...base, enrollment_id: null, id: uuid('5a000000'), kind: 'document_ready', title: 'Rasyonel sayılar notun hazır', payload: { document_id: DOC_ID }, rank: 30 },
  );
}

const rpcs = {
  onboarding_enroll(tables, caller, body) {
    const text = String(body.p_course_text ?? '').trim();
    if (text.length < 2 || text.length > 120) return err('P0001', 'OGR-ONB-001 ders metni 2–120 harf');
    const examDate = body.p_exam_date ?? null;
    if (examDate && examDate < new Date().toISOString().slice(0, 10)) return err('P0001', 'OGR-ONB-002 hedef tarih geçmişte olamaz');
    // Gerçek RPC gibi: hedef sınav metinden (TYT/AYT/LGS/KPSS ya da boş), tarih yalnız parametreden.
    const targetExam = ['TYT', 'AYT', 'LGS', 'KPSS'].find((k) => text.toUpperCase() === k) ?? null;
    const profile = tables.profiles.find((p) => p.id === caller?.id);
    if (!profile || profile.role !== 'student') return err('42501', 'OGR-AUTH-001 yalnız öğrenci', 403);
    let st = studentOf(tables, caller);
    if (!st) {
      st = { id: uuid('b7000000'), public_ref: `s_${seq}`, profile_id: caller.id, grade: null, school: null, status: 'active', created_at: NOW };
      tables.students.push(st);
    }
    const curriculumId = uuid('6a000000');
    const courseId = uuid('5b000000');
    const enrollmentId = uuid('7b000000');
    tables.curricula.push({ id: curriculumId, code: text.toUpperCase(), version: '1', label: text, status: 'draft', origin: 'ai_draft', draft_status: 'queued', draft_progress: 0, created_at: new Date().toISOString(), published_at: null });
    tables.courses.push({ id: courseId, code: text.toUpperCase(), title: text, kind: 'exam_track', curriculum_id: curriculumId, description: null, visibility: 'shared', created_by: null, created_at: NOW });
    tables.enrollments.push({ id: enrollmentId, student_id: st.id, curriculum_id: curriculumId, course_id: courseId, status: 'active', target_exam: targetExam, exam_date: examDate, period_label: examDate ? examDate.slice(0, 4) : null, created_at: new Date().toISOString() });
    profile.onboarded_at = new Date().toISOString();
    setTimeout(() => Object.assign(tables.curricula.find((c) => c.id === curriculumId), { draft_status: 'drafting', draft_progress: 60 }), E2E_DRAFT_MS / 2);
    setTimeout(() => draftReady(tables, { curriculumId, studentId: st.id, enrollmentId, courseId }), E2E_DRAFT_MS);
    return { status: 200, body: { enrollment_id: enrollmentId, course_id: courseId, course_code: text.toUpperCase(), course_title: text, curriculum_id: curriculumId, curriculum_status: 'draft', curriculum_origin: 'ai_draft', matched: 'created', created: true, target_exam: targetExam, exam_date: examDate, period_label: examDate ? examDate.slice(0, 4) : null, draft_job_id: 'job-1' } };
  },

  list_today_suggestions(tables, caller) {
    const st = studentOf(tables, caller);
    if (!st) return err('42501', 'OGR-AUTH-001 öneriler yalnız öğrenci oturumunda', 403);
    const now = Date.now();
    const rows = tables.suggestions
      .filter((s) => s.student_id === st.id && !s.consumed_at && (!s.expires_at || Date.parse(s.expires_at) > now))
      .sort((a, b) => a.rank - b.rank || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
      .slice(0, 4)
      .map(({ id, enrollment_id, kind, title, subtitle, payload, rank, expires_at, created_at }) => ({ id, enrollment_id, kind, title, subtitle, payload, rank, expires_at, created_at }));
    return { status: 200, body: rows };
  },

  consume_suggestion(tables, caller, body) {
    const st = studentOf(tables, caller);
    const s = tables.suggestions.find((x) => x.id === body.p_id);
    if (!s) return err('P0001', `OGR-SUG-001 öneri bulunamadı ${body.p_id}`);
    if (!st || s.student_id !== st.id) return err('42501', 'OGR-AUTH-001 öneriyi yalnız öğrencinin kendisi başlatır', 403);
    s.consumed_at ??= new Date().toISOString();
    return { status: 200, body: { id: s.id, kind: s.kind, enrollment_id: s.enrollment_id, payload: s.payload, consumed_at: s.consumed_at } };
  },

  start_practice(tables, caller, body) {
    const st = studentOf(tables, caller);
    if (!st) return err('42501', 'OGR-AUTH-001 öğrenci değil', 403);
    let enrollmentId = body.p_enrollment ?? null;
    let count = body.p_count ?? null;
    let suggestionId = null;
    if (body.p_suggestion) {
      const s = tables.suggestions.find((x) => x.id === body.p_suggestion && x.student_id === st.id);
      if (!s) return err('P0001', 'OGR-SUG-001 öneri bulunamadı');
      if (!['practice', 'weekly_homework', 'lesson_review', 'gap_analysis'].includes(s.kind)) return err('P0001', 'OGR-PRAC-002 öneri alıştırma değil');
      const existing = tables.practice_sets.find((p) => p.suggestion_id === s.id);
      if (existing) return { status: 200, body: setJson(tables, existing) };
      s.consumed_at ??= new Date().toISOString();
      suggestionId = s.id;
      enrollmentId = s.enrollment_id;
      count ??= s.payload?.count ?? null;
    }
    const enr = tables.enrollments.find((e) => e.id === enrollmentId && e.student_id === st.id);
    if (!enr) return err('P0001', 'OGR-PRAC-001 kayıt bulunamadı');
    // Ders müfredatının onaylı sorusu yoksa (fixture öğrencisinin kaydı) set boş açılır: practice.generate kuyruğa.
    const bank = enr.curriculum_id === CURRICULUM_ID ? [] : QUESTIONS;
    const n = Math.min(bank.length, Math.max(1, Math.min(10, count ?? 8)));
    const ps = { id: uuid('9a000000'), enrollment_id: enr.id, suggestion_id: suggestionId, status: bank.length ? 'in_progress' : 'needs_generation', skill_ids: bank.slice(0, n).map((q) => q.skill.id), target_count: count ?? 8, summary: null, started_at: new Date().toISOString(), finished_at: null };
    tables.practice_sets.push(ps);
    bank.slice(0, n).forEach((q, i) => tables.practice_items.push({ set_id: ps.id, no: i + 1, question_id: q.id, attempt_id: null }));
    return { status: 200, body: setJson(tables, ps) };
  },

  get_practice_set(tables, caller, body) {
    const ps = tables.practice_sets.find((p) => p.id === body.p_set);
    const st = studentOf(tables, caller);
    if (!ps || !st || !tables.enrollments.some((e) => e.id === ps.enrollment_id && e.student_id === st.id)) return err('P0001', `OGR-PRAC-001 set bulunamadı ${body.p_set}`);
    return { status: 200, body: setJson(tables, ps) };
  },

  answer_practice_item(tables, caller, body) {
    const ps = tables.practice_sets.find((p) => p.id === body.p_set);
    const st = studentOf(tables, caller);
    if (!ps || !st || !tables.enrollments.some((e) => e.id === ps.enrollment_id && e.student_id === st.id)) return err('P0001', 'OGR-PRAC-001 set bulunamadı');
    const item = tables.practice_items.find((i) => i.set_id === ps.id && i.question_id === body.p_question);
    if (!item) return err('P0001', 'OGR-PRAC-004 soru bu sette değil');
    const q = QUESTIONS.find((x) => x.id === item.question_id);
    const total = tables.practice_items.filter((i) => i.set_id === ps.id).length;
    const answeredNow = () => tables.practice_items.filter((i) => i.set_id === ps.id && i.attempt_id).length;
    if (item.attempt_id) {
      const a = tables.attempts.find((x) => x.id === item.attempt_id);
      return { status: 200, body: { set_id: ps.id, question_id: q.id, no: item.no, correct: a.is_correct, misconception_tag: a.misconception_tag, misconception_text: TAG_TEXT[a.misconception_tag] ?? null, answered: answeredNow(), total, remaining: total - answeredNow(), already_answered: true } };
    }
    if (ps.status !== 'in_progress') return err('P0001', `OGR-PRAC-003 set cevaplanamaz (durum ${ps.status})`);
    const ans = String(body.p_answer ?? '').trim().toUpperCase();
    if (!/^[A-E]$/.test(ans)) return err('P0001', 'OGR-PRAC-005 şık A–E olmalı');
    const correct = ans === q.key;
    const tag = correct ? null : (q.options.find((o) => o.key === ans)?.misconception_tag ?? null);
    const attempt = { id: tables.attempts.length + 1, enrollment_id: ps.enrollment_id, question_id: q.id, context: 'practice', session_id: ps.id, chosen: { key: ans }, is_correct: correct, misconception_tag: tag, response_ms: body.p_response_ms ?? null, created_at: new Date().toISOString() };
    tables.attempts.push(attempt);
    item.attempt_id = attempt.id;
    return { status: 200, body: { set_id: ps.id, question_id: q.id, no: item.no, correct, misconception_tag: tag, misconception_text: TAG_TEXT[tag] ?? null, answered: answeredNow(), total, remaining: total - answeredNow(), already_answered: false } };
  },

  finish_practice(tables, caller, body) {
    const ps = tables.practice_sets.find((p) => p.id === body.p_set);
    const st = studentOf(tables, caller);
    if (!ps || !st || !tables.enrollments.some((e) => e.id === ps.enrollment_id && e.student_id === st.id)) return err('P0001', 'OGR-PRAC-001 set bulunamadı');
    if (ps.summary) return { status: 200, body: ps.summary };
    const items = tables.practice_items.filter((i) => i.set_id === ps.id);
    const attempts = items.map((i) => tables.attempts.find((a) => a.id === i.attempt_id)).filter(Boolean);
    const correct = attempts.filter((a) => a.is_correct).length;
    const tags = new Map();
    for (const a of attempts) if (a.misconception_tag) tags.set(a.misconception_tag, (tags.get(a.misconception_tag) ?? 0) + 1);
    const [topTag, topN] = [...tags.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
    const per = new Map();
    for (const i of items) {
      const q = QUESTIONS.find((x) => x.id === i.question_id);
      const a = tables.attempts.find((x) => x.id === i.attempt_id);
      const cur = per.get(q.skill.id) ?? { skill_id: q.skill.id, name: q.skill.name, correct: 0, total: 0 };
      cur.total += 1;
      if (a?.is_correct) cur.correct += 1;
      per.set(q.skill.id, cur);
    }
    const skills = [...per.values()];
    const weak = [...skills].sort((a, b) => a.correct / a.total - b.correct / b.total)[0] ?? null;
    const status = attempts.length === 0 ? 'abandoned' : 'finished';
    ps.status = status;
    ps.finished_at = new Date().toISOString();
    ps.summary = {
      set_id: ps.id, status, total: items.length, answered: attempts.length, correct, wrong: attempts.length - correct, unanswered: items.length - attempts.length,
      top_misconception: topTag ? { tag: topTag, text: TAG_TEXT[topTag] ?? null, count: topN } : null,
      weak_skill: weak ? { ...weak, band: null } : null,
      skills, mastery: [], finished_at: ps.finished_at,
    };
    // BKT benzetimi: Gelişim › Konular için yaprak ustalığı
    for (const s of skills) {
      const row = tables.mastery_view.find((m) => m.enrollment_id === ps.enrollment_id && m.skill_id === s.skill_id);
      const band = s.correct === s.total ? 'mid' : 'low';
      if (row) Object.assign(row, { band, evidence_count: row.evidence_count + s.total });
      else tables.mastery_view.push({ student_id: st.id, enrollment_id: ps.enrollment_id, course_id: null, curriculum_id: null, skill_id: s.skill_id, skill_name: s.name, parent_id: null, evidence_count: 6, p: band === 'mid' ? 0.62 : 0.31, band });
    }
    return { status: 200, body: ps.summary };
  },
};

/** İstek bu eke aitse işler ve true döner. */
export async function handlePractice({ req, res, path, tables, send, readBody, userFromAuth }) {
  if (path === '/__practice/cleanup') {
    // bekleyen (needs_generation) setleri sil: sonraki özel durum sınamaları temiz Bugün görsün
    tables.practice_sets = tables.practice_sets.filter((s) => s.status !== 'needs_generation');
    return send(res, 200, { ok: true }), true;
  }
  if (path === '/__practice') return send(res, 200, { sets: tables.practice_sets, attempts: tables.attempts, suggestions: tables.suggestions }), true;

  const fig = /^\/storage\/v1\/object\/public\/figures\/(.+)$/.exec(path);
  if (fig && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'image/svg+xml', 'access-control-allow-origin': '*' });
    res.end(FIGURE_SVG);
    return true;
  }
  const sign = /^\/storage\/v1\/object\/sign\/documents\/(.+)$/.exec(path);
  if (sign && req.method === 'POST') {
    const user = userFromAuth(req);
    const name = decodeURIComponent(sign[1]);
    const doc = tables.generated_documents.find((d) => d.pdf_path === name);
    const st = user ? tables.students.find((s) => s.profile_id === user.id) : null;
    if (!doc || !st || doc.student_id !== st.id) return send(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' }), true;
    return send(res, 200, { signedURL: `/object/sign/documents/${sign[1]}?token=e2e` }), true;
  }
  if (sign && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/pdf', 'access-control-allow-origin': '*' });
    res.end(tinyPdf('Rasyonel sayilar'));
    return true;
  }

  const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(path);
  if (rpc && req.method === 'POST' && Object.hasOwn(rpcs, rpc[1])) {
    const body = await readBody(req);
    const out = rpcs[rpc[1]](tables, userFromAuth(req), body);
    return send(res, out.status, out.body), true;
  }
  return false;
}

export const E2E_ONBOARDING_USER = USERS.kurulum;
