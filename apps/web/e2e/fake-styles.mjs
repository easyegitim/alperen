// Sahte Supabase'in tarz kütüphanesi eki (e2e/fake-supabase.mjs çağırır): style_library_view, ingest_exam_source,
// upsert_question_styles, merge_styles, request_style_questions, compute_priority_plan, approve_priority_plan,
// student_style_coverage (0036–0038 yanıt biçimleri). Çıkmış sınav "işi" zamanlayıcıyla benzetilir: yüklenen sınav
// bir süre "ayrılıyor" (pending_sources) kalır, sonra yeni bir taslak tarz eklenir. Gerçek yetki, RLS ve skorlar
// supabase/tests/24–26'da sınanır.
import { USERS } from './fixtures.mjs';

const COURSE_ID = '50000000-0000-4000-8000-000000000001';
const STEP_MS = 1200;
let seq = 0;
const uuid = (p) => `${p}-0000-4000-8000-${String(++seq + 7000).padStart(12, '0')}`;
const err = (code, message, status = 400) => ({ status, body: { code, message, details: null, hint: null } });
const NOW = '2025-11-01T08:00:00Z';

function seedState() {
  const mk = (n, name, years, score, over = {}) => ({
    id: `5e000000-0000-4000-8000-${String(n).padStart(12, '0')}`, code: `T-0${n}`, name, description: `${name} tanımı.`, format: 'çoktan seçmeli', trick: 'Uç noktaların dahil olması', difficulty_band: 'mid',
    status: 'active', source: 'instructor', reviewed_at: NOW, skills: [{ id: '1.1', name: 'Eşitsizlikler' }], years_hit: years, last_year: Math.max(...years), frequency: years.length / 4, recency: 1, alignment: 0.8, score,
    appearances: years.map((y, i) => ({ item_id: `5e100000-0000-4000-8000-${String(n * 10 + i).padStart(12, '0')}`, year: y, term: 'osym', item_no: 10 + i })),
    coverage: { students_total: 12, students_solved: 7, solved: 24, correct: 17, unsolved: [{ enrollment_id: '5e200000-0000-4000-8000-000000000001', display_name: 'Mert A.' }] },
    ...over,
  });
  return {
    sources: [{ year: 2023 }, { year: 2024 }, { year: 2025 }],
    pending: 0,
    styles: [
      mk(1, 'Mutlak değerli eşitsizlikte aralık', [2025, 2024, 2023], 0.91),
      mk(2, 'Karışım problemi', [2025, 2023], 0.62),
      mk(3, 'İki basamaklı sayı çözümleme', [2025, 2024], 0.4, { status: 'draft', source: 'extracted', reviewed_at: null, coverage: { students_total: 12, students_solved: 10, solved: 30, correct: 20, unsolved: [] } }),
    ],
    plan: null,
    requests: [],
  };
}

let state = seedState();
const isStaff = (tables, caller) => Boolean(caller && tables.profiles.find((p) => p.id === caller.id && ['instructor', 'admin'].includes(p.role)));
const years = () => [...new Set(state.sources.map((s) => s.year))].sort();

function view() {
  const ys = years();
  const styles = state.styles.map((s) => ({ ...s, years_total: ys.length }));
  return {
    role: 'staff', can_manage: true, course: { id: COURSE_ID, code: 'TYT-MAT', title: 'TYT Matematik' },
    archive: { years_from: ys[0] ?? null, years_to: ys.at(-1) ?? null, years_total: ys.length, sources: state.sources.length, items: 40 * state.sources.length, styled_items: 30 * state.sources.length, pending_sources: state.pending, last_clustered_at: NOW },
    plan: state.plan, styles,
  };
}

const rpcs = {
  style_library_view(tables, caller) {
    if (!isStaff(tables, caller)) return err('42501', 'OGR-AUTH-001 tarz kütüphanesini yalnız dersin öğrencisi ve eğitmeni görür', 403);
    return { status: 200, body: view() };
  },

  ingest_exam_source(tables, caller, body) {
    if (!isStaff(tables, caller)) return err('42501', 'OGR-AUTH-002 çıkmış sınavı yalnız dersin eğitmeni yükler', 403);
    const year = Number(body.p_meta?.year);
    if (!Number.isInteger(year) || year < 1950) return err('P0001', 'OGR-STYLE-002 year dört haneli geçerli bir yıl olmalı');
    const ids = body.p_upload_ids ?? [];
    if (ids.length < 1 || ids.length > 60) return err('P0001', 'OGR-UPL-001 çıkmış sınav için 1–60 tekil dosya gerekir');
    const rows = ids.map((id) => tables.uploads.find((u) => u.id === id));
    if (rows.some((r) => !r || r.student_id !== null || r.owner_id !== caller.id)) return err('P0001', 'OGR-UPL-002 yükleme bulunamadı, senin değil ya da arşiv dosyası değil');
    state.sources.push({ year });
    state.pending += 1;
    setTimeout(() => {
      state.pending -= 1;
      const n = state.styles.length + 1;
      state.styles.push({ ...state.styles[0], id: `5e000000-0000-4000-8000-${String(n).padStart(12, '0')}`, code: `T-0${n}`, name: `Yeni taslak tarz ${year}`, description: null, status: 'draft', source: 'extracted', reviewed_at: null, years_hit: [year], last_year: year, score: 0.2, appearances: [] });
    }, STEP_MS);
    return { status: 200, body: { source_id: uuid('5e300000'), course_id: COURSE_ID, status: 'uploaded', job_id: 'job-ingest', upload_ids: ids, reused: false } };
  },

  upsert_question_styles(tables, caller, body) {
    if (!isStaff(tables, caller)) return err('42501', 'OGR-AUTH-002 tarzları yalnız worker, dersin eğitmeni ya da admin yazar', 403);
    const out = [];
    for (const st of body.p_styles ?? []) {
      const name = typeof st.name === 'string' ? st.name.trim() : null;
      if (name !== null && (name.length < 3 || name.length > 80)) return err('P0001', `OGR-STYLE-007 ${st.code}: ad 3–80 karakter`);
      let row = state.styles.find((s) => s.code === st.code);
      const created = !row;
      if (!row) {
        if (!name) return err('P0001', `OGR-STYLE-007 ${st.code}: yeni tarz ad ister`);
        const n = state.styles.length + 1;
        row = { id: `5e000000-0000-4000-8000-${String(n).padStart(12, '0')}`, code: st.code, name, description: null, format: null, trick: null, difficulty_band: null, status: 'active', source: 'instructor', reviewed_at: NOW, skills: [], years_hit: [], last_year: null, frequency: 0, recency: 0, alignment: 0, score: 0, appearances: [], coverage: { students_total: 12, students_solved: 0, solved: 0, correct: 0, unsolved: [] } };
        state.styles.push(row);
      }
      if (name) row.name = name;
      if ('description' in st) row.description = st.description;
      if (st.status) row.status = st.status;
      row.reviewed_at = NOW;
      out.push({ code: st.code, id: row.id, created });
    }
    return { status: 200, body: { course_id: COURSE_ID, styles: out } };
  },

  merge_styles(tables, caller, body) {
    if (!isStaff(tables, caller)) return err('42501', 'OGR-AUTH-002 yalnız dersin eğitmeni', 403);
    const keep = state.styles.find((s) => s.id === body.p_keep);
    const gone = state.styles.find((s) => s.id === body.p_merge);
    if (!keep || !gone || keep === gone) return err('P0001', 'OGR-STYLE-008 birleştirmek için aynı dersten iki ayrı tarz gerekir');
    keep.years_hit = [...new Set([...keep.years_hit, ...gone.years_hit])].sort((a, b) => b - a);
    keep.appearances = [...keep.appearances, ...gone.appearances];
    state.styles = state.styles.filter((s) => s !== gone);
    return { status: 200, body: { keep: keep.id, merged: gone.id, moved: {} } };
  },

  request_style_questions(tables, caller, body) {
    if (!isStaff(tables, caller)) return err('42501', 'OGR-AUTH-002 yalnız dersin eğitmeni', 403);
    const st = state.styles.find((s) => s.id === body.p_style);
    if (!st) return err('P0001', 'OGR-STYLE-013 tarz bulunamadı');
    state.requests.push({ style_id: st.id, count: body.p_count ?? 5 });
    return { status: 200, body: { style_id: st.id, count: body.p_count ?? 5, job_id: 'job-gen' } };
  },

  compute_priority_plan(tables, caller) {
    if (!isStaff(tables, caller)) return err('42501', 'OGR-AUTH-002 plan yalnız eğitmen', 403);
    if (years().length < 2) return err('P0001', 'OGR-STYLE-010 öncelik planı için en az iki yılın arşivi gerekir');
    const rows = [...state.styles].filter((s) => s.status !== 'retired').sort((a, b) => b.score - a.score).map((s, i) => ({ rank: i + 1, topic: s.name, kind: 'çoktan seçmeli', hits: s.years_hit.length, years: years().length, points_text: '≈10 puan', evidence_count: s.years_hit.length, evidence_item_ids: [s.id], syllabus_alignment: 'covered_and_asked', style_ids: [s.id] }));
    state.plan = { id: uuid('5e400000'), status: 'pending_review', period: `${years()[0]}–${years().at(-1)}`, created_at: NOW, approved_at: null, plan: { rows, others: [], uncovered_topics: [] } };
    return { status: 200, body: { plan_id: state.plan.id, status: 'pending_review', plan: state.plan.plan, scores: [] } };
  },

  approve_priority_plan(tables, caller, body) {
    if (!isStaff(tables, caller)) return err('42501', 'OGR-AUTH-002 planı yalnız dersin eğitmeni onaylar', 403);
    if (!state.plan || state.plan.id !== body.p_plan) return err('P0001', 'OGR-STYLE-012 plan bulunamadı');
    state.plan.status = body.p_decision;
    if (body.p_decision === 'approved') state.plan.approved_at = NOW;
    return { status: 200, body: { plan_id: state.plan.id, status: body.p_decision } };
  },

  student_style_coverage(tables, caller) {
    if (!caller || caller.id !== USERS.student.id) return err('42501', 'OGR-AUTH-001 bu kaydın kapsamasını yalnız öğrenci görür', 403);
    const rows = [
      { style_id: 's1', name: 'Mutlak değerli eşitsizlikte aralık', text: '3 çözdün, 1 doğru', solved: 3 },
      { style_id: 's2', name: 'Karışım problemi', text: 'Bu tarzı hiç çözmedin', solved: 0 },
      { style_id: 's3', name: 'İki basamaklı sayı çözümleme', text: 'Bu tarzı hiç çözmedin', solved: 0 },
    ];
    return { status: 200, body: { enrollment_id: 'e', course_id: COURSE_ID, styles: rows, summary: { styles: 3, never_solved: 2, solved: 3, correct: 1 } } };
  },
};

export async function handleStyles({ req, res, path, tables, send, readBody, userFromAuth }) {
  if (path === '/__styles') return send(res, 200, { ...state, view: view() }), true;
  if (path === '/__styles/reset') return (state = seedState()), send(res, 200, { ok: true }), true;
  const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(path);
  if (rpc && req.method === 'POST' && Object.hasOwn(rpcs, rpc[1])) {
    const caller = userFromAuth(req);
    const body = await readBody(req);
    const out = rpcs[rpc[1]](tables, caller, body);
    return send(res, out.status, out.body), true;
  }
  return false;
}
