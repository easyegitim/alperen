// Sahte Supabase'in veli ve bildirim eki (e2e/fake-supabase.mjs çağırır): parent_child_summary, parent_recent_activity,
// parent_exam_sessions, parent_mastery_overview, parent_reports, parent_request_report (0043), list_notifications,
// mark_notification_read, list_notification_rules, set_notification_rule, register/unregister_push_subscription (0042),
// list_guardian_links (0044). Yanıt biçimleri göçlerdekiyle aynıdır; gerçek yetki, RLS, sınır ve dışlamalar
// supabase/tests/30–32'de sınanır. Veli sohbeti bellek deposundadır (OGRENMEN_CHAT_STORE=memory); araçları bu RPC'leri çağırır.
const err = (code, message, status = 400) => ({ status, body: { code, message, details: null, hint: null } });
const DEFAULT_KINDS = ['exam_analysed', 'weekly_summary', 'inactivity', 'improvement', 'misconception_resolved', 'instructor_note_shared', 'report_ready', 'guardian_linked'];
const MAX_REPORTS = 3;
const SESSION_ID = '5e550000-0000-4000-8000-000000000001';

const state = { requests: [], rules: new Map(), channels: new Map(), push: new Map(), seq: 0 };

const parentOf = (tables, caller, studentId) =>
  Boolean(caller && tables.profiles.find((p) => p.id === caller.id && p.role === 'parent') && tables.guardian_links.some((l) => l.parent_id === caller.id && l.student_id === studentId && l.status === 'active'));
const deny = () => err('42501', 'OGR-AUTH-001 bu öğrenci için veli yetkisi yok (yalnız aktif bağlı veli)', 403);
const noAuth = () => err('42501', 'OGR-AUTH-001 oturum gerekli', 401);
const nameOf = (tables, studentId) => {
  const st = tables.students.find((s) => s.id === studentId);
  const p = st && tables.profiles.find((x) => x.id === st.profile_id);
  return (p?.display_name ?? 'Öğrenci').split(/\s+/)[0];
};
const readyReports = (tables, studentId) =>
  tables.generated_documents.filter((d) => d.kind === 'report' && d.student_id === studentId && ['rendered', 'published'].includes(d.status) && d.pdf_path).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

const rpcs = {
  parent_child_summary(tables, caller, body) {
    if (!parentOf(tables, caller, body.p_student)) return deny();
    const rep = readyReports(tables, body.p_student)[0];
    return {
      status: 200,
      body: {
        student: { id: body.p_student, name: nameOf(tables, body.p_student), grade: '11' }, tz: 'Europe/Istanbul',
        week: { start: '2026-11-02', minutes: 270, hours: 4.5, questions: 38, practice_sets: 5, exams: 0, diagnoses: 2, active_days: 4 },
        prev_week: { start: '2026-10-26', minutes: 180, hours: 3, questions: 25, practice_sets: 3, exams: 1, diagnoses: 0, active_days: 3 },
        last_exam: { session_id: SESSION_ID, title: 'Deneme 4', finished_at: '2026-11-01T10:00:00Z', net: 27.5, total: 40, correct: 30, wrong: 10, blank: 0, report_document_id: null },
        courses: [
          { course_id: '50000000-0000-4000-8000-000000000001', enrollment_id: 'e1', title: 'TYT Matematik', target_exam: 'TYT', bands: { low: 2, mid: 5, high: 3, insufficient: 4 }, trend: 'up' },
          { course_id: '50000000-0000-4000-8000-000000000002', enrollment_id: 'e2', title: 'TYT Türkçe', target_exam: 'TYT', bands: { low: 4, mid: 2, high: 0, insufficient: 1 }, trend: 'steady' },
        ],
        open_misconceptions: 2, summary_md: null, summary_updated_at: null,
        latest_report: rep ? { id: rep.id, title: rep.title, status: rep.status, created_at: rep.created_at, ready: true } : null,
        last_activity_at: '2026-11-03T16:00:00Z',
      },
    };
  },
  parent_recent_activity(tables, caller, body) {
    if (!parentOf(tables, caller, body.p_student)) return deny();
    return { status: 200, body: { days: body.p_days ?? 7, items: [{ day: '2026-11-03', minutes: 70, questions: 12, kinds: ['practice'] }, { day: '2026-11-02', minutes: 90, questions: 14, kinds: ['practice', 'diagnosis'] }] } };
  },
  parent_exam_sessions(tables, caller, body) {
    if (!parentOf(tables, caller, body.p_student)) return deny();
    return { status: 200, body: [{ session_id: SESSION_ID, title: 'Deneme 4', finished_at: '2026-11-01T10:00:00Z', net: 27.5, total: 40, correct: 30, wrong: 10, blank: 0 }] };
  },
  parent_mastery_overview(tables, caller, body) {
    if (!parentOf(tables, caller, body.p_student)) return deny();
    return { status: 200, body: { courses: [{ title: 'TYT Matematik', bands: { low: 2, mid: 5, high: 3, insufficient: 4 }, trend: 'up', skills: [] }] } };
  },
  parent_reports(tables, caller, body) {
    if (!parentOf(tables, caller, body.p_student)) return deny();
    return { status: 200, body: readyReports(tables, body.p_student).map((d) => ({ id: d.id, title: d.title, report_kind: 'exam', status: d.status, ready: true, created_at: d.created_at })) };
  },
  parent_request_report(tables, caller, body) {
    if (!parentOf(tables, caller, body.p_student)) return deny();
    if (!['weekly', 'exam', 'topic', 'trend', 'custom'].includes(body.p_kind)) return err('P0001', 'OGR-REPORT-001 geçersiz rapor türü');
    const p = body.p_params ?? {};
    if (body.p_kind === 'exam' && p.session_id !== SESSION_ID) return err('P0001', 'OGR-REPORT-001 session_id çocuğun bitmiş oturumu olmalı');
    if (body.p_kind === 'topic' && !String(p.topic ?? '').trim()) return err('P0001', 'OGR-REPORT-001 topic ya da skill_ids gerekli');
    const used = state.requests.filter((r) => r.parent_id === caller.id && r.student_id === body.p_student).length;
    if (used >= MAX_REPORTS) return err('P0001', `OGR-REPORT-002 günlük rapor sınırı (${MAX_REPORTS}) doldu`);
    state.seq += 1;
    const rec = { id: `5e660000-0000-4000-8000-${String(state.seq).padStart(12, '0')}`, parent_id: caller.id, student_id: body.p_student, kind: body.p_kind, params: p };
    state.requests.push(rec);
    return { status: 200, body: { document_id: rec.id, title: 'Haftalık rapor', status: 'queued', report_kind: body.p_kind, job_id: `job-${state.seq}`, used: used + 1, max: MAX_REPORTS } };
  },

  list_notifications(tables, caller, body) {
    if (!caller) return noAuth();
    const mine = tables.notifications.filter((n) => n.recipient_id === caller.id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const items = mine.filter((n) => !body.p_unread_only || !n.read_at).slice(0, body.p_limit ?? 20);
    return { status: 200, body: { unread: mine.filter((n) => !n.read_at).length, items: items.map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, payload: n.payload ?? {}, channels: n.channels, read_at: n.read_at, created_at: n.created_at })) } };
  },
  mark_notification_read(tables, caller, body) {
    if (!caller) return noAuth();
    let n = 0;
    for (const x of tables.notifications) {
      if (x.recipient_id !== caller.id || x.read_at || (body.p_id && x.id !== body.p_id)) continue;
      x.read_at = new Date().toISOString();
      n += 1;
    }
    return { status: 200, body: n };
  },
  list_notification_rules(tables, caller) {
    if (!caller) return noAuth();
    const mine = state.rules.get(caller.id) ?? new Map();
    const ch = state.channels.get(caller.id) ?? new Map();
    return { status: 200, body: DEFAULT_KINDS.map((kind) => ({ kind, enabled: mine.has(kind) ? mine.get(kind) : true, params: { channels: ch.get(kind) ?? ['in_app', 'push'] }, is_default: !mine.has(kind) && !ch.has(kind) })) };
  },
  set_notification_rule(tables, caller, body) {
    if (!caller) return noAuth();
    if (!DEFAULT_KINDS.includes(body.p_kind)) return err('P0001', 'OGR-NOTIF-001 geçersiz bildirim türü');
    const mine = state.rules.get(caller.id) ?? new Map();
    if (typeof body.p_enabled === 'boolean') mine.set(body.p_kind, body.p_enabled);
    state.rules.set(caller.id, mine);
    if (Array.isArray(body.p_params?.channels)) {
      const ch = state.channels.get(caller.id) ?? new Map();
      ch.set(body.p_kind, [...new Set(['in_app', ...body.p_params.channels])].sort());
      state.channels.set(caller.id, ch);
    }
    return { status: 200, body: { kind: body.p_kind, enabled: mine.get(body.p_kind) ?? true, params: {}, is_default: false } };
  },
  register_push_subscription(tables, caller, body) {
    if (!caller) return noAuth();
    state.push.set(body.p_endpoint, caller.id);
    return { status: 200, body: `5e770000-0000-4000-8000-${String(state.push.size).padStart(12, '0')}` };
  },
  unregister_push_subscription(tables, caller, body) {
    if (!caller) return noAuth();
    return { status: 200, body: state.push.delete(body.p_endpoint) };
  },
  list_guardian_links(tables, caller, body) {
    if (!caller) return noAuth();
    const rows = tables.guardian_links.filter((l) => l.student_id === body.p_student && l.status === 'active').map((l) => ({
      link_id: l.id, status: 'active', relation: l.relation ?? null, parent_name: tables.profiles.find((p) => p.id === l.parent_id)?.display_name ?? null, accepted_at: l.created_at, invite_expires_at: null, created_at: l.created_at,
    }));
    return { status: 200, body: rows };
  },
};

export async function handleParent({ req, res, path, tables, send, readBody, userFromAuth }) {
  if (path === '/__parent') return send(res, 200, { requests: state.requests, push: [...state.push.entries()], rules: [...state.rules.entries()].map(([k, v]) => [k, [...v.entries()]]), channels: [...state.channels.entries()].map(([k, v]) => [k, [...v.entries()]]) }), true;
  if (path === '/__parent/reset') {
    state.requests = [];
    state.rules.clear();
    state.channels.clear();
    state.push.clear();
    for (const n of tables.notifications) n.read_at = null;
    return send(res, 200, { ok: true }), true;
  }
  const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(path);
  if (rpc && req.method === 'POST' && Object.hasOwn(rpcs, rpc[1])) {
    const caller = userFromAuth(req);
    const body = await readBody(req);
    const out = rpcs[rpc[1]](tables, caller, body);
    return send(res, out.status, out.body), true;
  }
  return false;
}
