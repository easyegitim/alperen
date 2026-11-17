// Sahte Supabase'in dersler eki (e2e/fake-supabase.mjs çağırır): Supabase Storage TUS (resumable) ucu +
// register_lesson, list_lessons, lesson_view, review_lesson_claim, apply_lesson_claims, lesson_set_options, retry_lesson
// (0040–0041 yanıt biçimleri). Hat zamanlayıcıyla benzetilir: prepare → stt → label → analyse → done; bitince transkript
// ve beş iddia gelir, güveni eşiğin üstündekiler kendiliğinden uygulanır (ödev ve sonraki adım SQL'deki gibi boş güvenle
// eğitmen onayı bekler). /__lessons/fail ilk dersi düşürür (Yeniden dene akışı). Gerçek yetki, RLS ve BKT supabase/tests/27–29'da sınanır.
import { FAKE_URL, USERS } from './fixtures.mjs';

const STEP_MS = 700;
let seq = 0;
const uuid = (p) => `${p}-0000-4000-8000-${String(++seq + 9000).padStart(12, '0')}`;
const err = (code, message, status = 400) => ({ status, body: { code, message, details: null, hint: null } });
const STUDENT_ID = '10000000-0000-4000-8000-000000000001';

const state = { lessons: [], tus: new Map(), objects: {} };

export function resetLessons() {
  state.lessons = [];
  state.tus = new Map();
  state.objects = {};
}

const isStaff = (tables, caller) => Boolean(caller && tables.profiles.find((p) => p.id === caller.id && ['instructor', 'admin'].includes(p.role)));
const isStudent = (caller) => Boolean(caller && caller.id === USERS.student.id);
const nowIso = () => new Date().toISOString();

function claimsFor(l) {
  const mk = (n, o) => ({ id: uuid('5c000000'), kind: 'skill_mastery', skill_id: 'tyt.mat.temel.sayilar', skill_name: 'Mutlak değerli eşitsizlikler', misconception_tag: null, misconception_id: null, value: { mastery_estimate: 0.6, evidence_count: 1 }, edited_value: null, confidence: 0.74, quote: null, speaker: 'ÖĞRENCİ', t_start_sec: 850, t_end_sec: 856, status: 'pending', auto: false, decided_at: null, applied: false, applied_at: null, mastery: { p: 0.58, evidence_count: 9 }, effect: null, ...o });
  return [
    mk(1, { quote: 'Eksi tarafı hep unutuyorum aslında.' }),
    mk(2, { skill_name: 'Birinci dereceden denklemler', value: { mastery_estimate: 0.9, evidence_count: 1 }, confidence: 0.92, quote: 'Önce çarpmayı yaparım.', t_start_sec: 310, t_end_sec: 318, mastery: { p: 0.91, evidence_count: 9 } }),
    mk(3, { kind: 'misconception', skill_name: null, value: { tag: 'eksi dağıtma', text_instructor: 'Eksiyi parantezdeki her terime dağıtmıyor.' }, confidence: null, quote: 'x − 3 < 5 yazdım.', t_start_sec: 835, mastery: null }),
    mk(4, { kind: 'homework', skill_name: null, skill_id: null, value: { who: 'ÖĞRENCİ', text: 'Çalışma kâğıdının ilk 10 sorusu.', due: '2026-11-10' }, confidence: null, quote: null, t_start_sec: 2820, mastery: null }),
    mk(5, { kind: 'next_step', skill_name: null, skill_id: null, value: { for_student: 'Uç noktaları kontrol ederek beş soru çöz.', for_instructor: 'Uç noktaları tekrar et.' }, confidence: null, quote: null, t_start_sec: null, speaker: null, mastery: null }),
  ].map((c) => ({ ...c, below_threshold: c.confidence == null || c.confidence < l.auto_apply_threshold }));
}

function applyAuto(l) {
  for (const c of l.claims) {
    if (c.status === 'pending' && c.confidence != null && c.confidence >= l.auto_apply_threshold) Object.assign(c, { status: 'approved', auto: true, decided_at: nowIso(), applied: true, applied_at: nowIso() });
  }
}

function counts(l) {
  return { total: l.claims.length, pending: l.claims.filter((c) => c.status === 'pending').length, applied: l.claims.filter((c) => c.applied).length, rejected: l.claims.filter((c) => c.status === 'rejected').length };
}

const SEGMENTS = [
  { t0: 0, t1: 6, speaker: 'EĞİTMEN', text: 'Bugün mutlak değerli eşitsizliklere bakalım.' },
  { t0: 310, t1: 318, speaker: 'ÖĞRENCİ', text: 'Önce çarpmayı yaparım.' },
  { t0: 828, t1: 835, speaker: 'EĞİTMEN', text: 'Peki öbür taraf? Mutlak değer bize neyi söylüyor?' },
  { t0: 835, t1: 842, speaker: 'ÖĞRENCİ', text: 'x − 3 < 5 yazdım.' },
  { t0: 850, t1: 856, speaker: 'ÖĞRENCİ', text: 'Eksi tarafı hep unutuyorum aslında.' },
  { t0: 2820, t1: 2830, speaker: 'EĞİTMEN', text: 'Çalışma kâğıdının ilk 10 sorusunu çöz.' },
];

function advance(l) {
  const order = ['prepare', 'stt', 'label', 'analyse', 'done'];
  const i = order.indexOf(l.progress.stage);
  if (i < 0 || i >= order.length - 1) return;
  const next = order[i + 1];
  l.progress = { ...l.progress, stage: next, updated_at: nowIso() };
  if (next === 'label') l.transcript = { segments: SEGMENTS, language: 'tr', provider: 'fake', labeled: false, segment_count: SEGMENTS.length, updated_at: nowIso() };
  if (next === 'analyse' && l.transcript) l.transcript.labeled = true;
  if (next === 'done') {
    l.status = 'analyzed';
    l.duration_sec ??= 2880;
    l.claims = claimsFor(l);
    applyAuto(l);
  } else setTimeout(() => advance(l), STEP_MS);
}

function row(l) {
  const c = counts(l);
  return {
    id: l.id, no: l.no, title: l.title, held_at: l.held_at, duration_sec: l.duration_sec, status: l.status, stage: l.progress.stage, error: l.progress.error ?? null, student_visible: l.student_visible,
    enrollment_id: l.enrollment_id, course_id: l.course_id, course_title: 'TYT Matematik', student: { id: STUDENT_ID, name: 'Ayşe Yılmaz' }, transcript_ready: Boolean(l.transcript),
    claims: { total: c.total, pending: c.pending, applied: c.applied },
  };
}

function staffView(l) {
  return {
    role: 'staff',
    lesson: { ...row(l), progress: l.progress, auto_apply_threshold: l.auto_apply_threshold, retain_until: null, video_deleted_at: null, audio_deleted_at: null, instructor: { id: USERS.instructor.id, name: 'Zeynep Hoca' }, can_manage: true },
    transcript: l.transcript,
    analysis: l.claims.length ? { id: uuid('5a000000'), version: 1, status: 'draft', model: 'fake', created_at: nowIso(), next_step: null, talk: null } : null,
    claims: l.claims,
    counts: counts(l),
  };
}

function studentView(l) {
  const ok = l.claims.filter((c) => ['approved', 'edited'].includes(c.status));
  const topics = [...new Set(ok.filter((c) => c.kind === 'skill_mastery').map((c) => c.skill_name))];
  const next = ok.find((c) => c.kind === 'next_step')?.value.for_student ?? null;
  const homework = ok.filter((c) => c.kind === 'homework').map((c) => ({ text: c.value.text, due: c.value.due }));
  return { role: 'student', lesson: { id: l.id, no: l.no, title: l.title, held_at: l.held_at, duration_sec: l.duration_sec }, summary: { ready: Boolean(next || topics.length || homework.length), next_step: next, topics, homework } };
}

const rpcs = {
  register_lesson(tables, caller, body) {
    if (!isStaff(tables, caller)) return err('42501', 'OGR-AUTH-002 dersi yalnız eğitmen yükler', 403);
    const up = tables.uploads.find((u) => u.id === body.p_upload_id);
    if (!up || up.owner_id !== caller.id) return err('P0001', 'OGR-LESSON-001 yükleme bulunamadı ya da senin değil');
    if (!['video', 'audio', 'transcript'].includes(up.kind)) return err('P0001', 'OGR-LESSON-001 ders yüklemesi video, ses ya da transkript olmalı');
    const again = state.lessons.find((l) => l.upload_id === up.id);
    if (again) return { status: 200, body: { lesson_id: again.id, status: again.status, created: false, job_id: null } };
    const meta = body.p_meta ?? {};
    const enr = tables.enrollments.find((e) => e.id === meta.enrollment_id);
    if (!enr) return err('P0001', 'OGR-LESSON-001 kayıt bulunamadı');
    const l = {
      id: uuid('5b000000'), no: state.lessons.length + 1, title: meta.title ?? null, held_at: meta.held_at ?? nowIso(), duration_sec: null, status: 'processing', progress: { stage: 'prepare', updated_at: nowIso() },
      student_visible: false, auto_apply_threshold: meta.auto_apply_threshold ?? 0.8, enrollment_id: enr.id, course_id: enr.course_id, upload_id: up.id, transcript_upload_id: meta.transcript_upload_id ?? null, transcript: null, claims: [],
    };
    state.lessons.unshift(l);
    setTimeout(() => advance(l), STEP_MS);
    return { status: 200, body: { lesson_id: l.id, status: l.status, created: true, job_id: 'job-prepare' } };
  },

  list_lessons(tables, caller) {
    if (isStaff(tables, caller)) return { status: 200, body: state.lessons.map((l) => row(l)) };
    if (isStudent(caller)) {
      return { status: 200, body: state.lessons.filter((l) => l.student_visible).map((l) => ({ id: l.id, no: l.no, title: l.title, held_at: l.held_at, duration_sec: l.duration_sec, summary_ready: studentView(l).summary.ready })) };
    }
    return err('42501', 'OGR-AUTH-001 dersleri yalnız eğitmen ve öğrenci görür', 403);
  },

  lesson_view(tables, caller, body) {
    const l = state.lessons.find((x) => x.id === body.p_lesson);
    if (!l) return err('42501', 'OGR-AUTH-001 bu ders için yetki yok', 403);
    if (isStaff(tables, caller)) return { status: 200, body: staffView(l) };
    if (isStudent(caller) && l.student_visible) return { status: 200, body: studentView(l) };
    return err('42501', 'OGR-AUTH-001 bu ders için yetki yok', 403);
  },

  review_lesson_claim(tables, caller, body) {
    if (!isStaff(tables, caller)) return err('42501', 'OGR-AUTH-002 yalnız dersin eğitmeni', 403);
    for (const l of state.lessons) {
      const c = l.claims.find((x) => x.id === body.p_claim);
      if (!c) continue;
      const d = body.p_decision;
      if (!['approve', 'edit', 'reject'].includes(d)) return err('P0001', 'OGR-LESSON-005 geçersiz karar');
      if (d === 'approve') {
        if (c.status === 'pending') Object.assign(c, { status: 'approved', decided_at: nowIso(), applied: true, applied_at: nowIso() });
      } else if (d === 'edit') {
        c.edited_value = { ...c.value, ...(body.p_edit ?? {}) };
        Object.assign(c, { status: 'edited', decided_at: nowIso(), applied: true, applied_at: nowIso() });
      } else Object.assign(c, { status: 'rejected', decided_at: nowIso(), applied: false, applied_at: null });
      return { status: 200, body: { claim_id: c.id, status: c.status, applied: c.applied, changed: true, pending: counts(l).pending } };
    }
    return err('P0001', 'OGR-LESSON-005 iddia bulunamadı');
  },

  apply_lesson_claims(tables, caller, body) {
    if (!isStaff(tables, caller)) return err('42501', 'OGR-AUTH-002 yalnız dersin eğitmeni', 403);
    const l = state.lessons.find((x) => x.id === body.p_lesson);
    if (!l || l.claims.length === 0) return err('P0001', 'OGR-LESSON-004 dersin analizi yok');
    const before = counts(l).applied;
    applyAuto(l);
    const c = counts(l);
    return { status: 200, body: { lesson_id: l.id, applied: c.applied - before, pending: c.pending, total: c.total, threshold: l.auto_apply_threshold, memory_job_id: null } };
  },

  retry_lesson(tables, caller, body) {
    if (!isStaff(tables, caller)) return err('42501', 'OGR-AUTH-001 bu ders için yetki yok', 403);
    const l = state.lessons.find((x) => x.id === body.p_lesson);
    if (!l) return err('P0001', 'OGR-LESSON-002 ders bulunamadı');
    if (l.status !== 'failed') return err('P0001', `OGR-LESSON-003 yalnız düşen ders yeniden denenir (${l.status})`);
    Object.assign(l, { status: 'processing', progress: { stage: 'prepare', updated_at: nowIso(), retried: (l.progress.retried ?? 0) + 1 }, transcript: null, claims: [] });
    setTimeout(() => advance(l), STEP_MS);
    return { status: 200, body: { lesson_id: l.id, status: 'processing', stage: 'prepare', job_id: 'job-prepare' } };
  },

  lesson_set_options(tables, caller, body) {
    if (!isStaff(tables, caller)) return err('42501', 'OGR-AUTH-002 yalnız dersin eğitmeni', 403);
    const l = state.lessons.find((x) => x.id === body.p_lesson);
    if (!l) return err('42501', 'OGR-AUTH-001 bu ders için yetki yok', 403);
    const o = body.p_options ?? {};
    if (typeof o.student_visible === 'boolean') l.student_visible = o.student_visible;
    if (typeof o.auto_apply_threshold === 'number') l.auto_apply_threshold = o.auto_apply_threshold;
    if (typeof o.title === 'string') l.title = o.title || null;
    return { status: 200, body: { lesson_id: l.id, student_visible: l.student_visible, auto_apply_threshold: l.auto_apply_threshold, title: l.title } };
  },
};

const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': '*', 'tus-resumable': '1.0.0' };

function b64(v) {
  return Buffer.from(v, 'base64').toString('utf8');
}

async function handleTus({ req, res, path }) {
  const m = /^\/storage\/v1\/upload\/resumable(?:\/([\w-]+))?$/.exec(path);
  if (!m) return false;
  if (req.method === 'POST' && !m[1]) {
    const meta = Object.fromEntries(
      String(req.headers['upload-metadata'] ?? '').split(',').filter(Boolean).map((p) => {
        const [k, v] = p.trim().split(' ');
        return [k, v ? b64(v) : ''];
      }),
    );
    const length = Number(req.headers['upload-length']);
    if (meta.bucketName !== 'lessons' || !meta.objectName || !(length > 0)) {
      res.writeHead(400, CORS);
      return res.end(), true;
    }
    const id = uuid('7e000000');
    state.tus.set(id, { objectName: meta.objectName, length, offset: 0, chunks: 0 });
    res.writeHead(201, { ...CORS, location: `${FAKE_URL}/storage/v1/upload/resumable/${id}`, 'upload-offset': '0' });
    return res.end(), true;
  }
  const up = m[1] ? state.tus.get(m[1]) : null;
  if (!up) {
    res.writeHead(404, CORS);
    return res.end(), true;
  }
  if (req.method === 'HEAD') {
    res.writeHead(200, { ...CORS, 'upload-offset': String(up.offset), 'upload-length': String(up.length), 'cache-control': 'no-store' });
    return res.end(), true;
  }
  if (req.method === 'PATCH') {
    let n = 0;
    await new Promise((resolve) => {
      req.on('data', (c) => (n += c.length));
      req.on('end', resolve);
    });
    up.offset += n;
    up.chunks += 1;
    if (up.offset >= up.length) state.objects[up.objectName] = { bytes: up.length, chunks: up.chunks };
    res.writeHead(204, { ...CORS, 'upload-offset': String(up.offset) });
    return res.end(), true;
  }
  res.writeHead(405, CORS);
  return res.end(), true;
}

export async function handleLessons({ req, res, path, tables, send, readBody, userFromAuth }) {
  if (path === '/__lessons') return send(res, 200, { lessons: state.lessons, objects: state.objects }), true;
  if (path === '/__lessons/reset') return resetLessons(), send(res, 200, { ok: true }), true;
  if (path === '/__lessons/fail') {
    const l = state.lessons[0];
    if (l) Object.assign(l, { status: 'failed', progress: { ...l.progress, stage: 'failed', error: 'Kayıt hazırlanamadı: kayıtta ses akışı yok', updated_at: nowIso() } });
    return send(res, 200, { ok: Boolean(l) }), true;
  }
  if (await handleTus({ req, res, path })) return true;
  const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(path);
  if (rpc && req.method === 'POST' && Object.hasOwn(rpcs, rpc[1])) {
    const caller = userFromAuth(req);
    const body = await readBody(req);
    const out = rpcs[rpc[1]](tables, caller, body);
    return send(res, out.status, out.body), true;
  }
  return false;
}
