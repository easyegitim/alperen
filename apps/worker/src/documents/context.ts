/**
 * document.generate girdisi: belge + istek satırı, müfredat ve kazanımlar, öğrencinin örüntüleri
 * (`public.student_patterns_for_prompt`), istekten not/deneme isteği (`@ogrenmen/prompts` NotesRequest / ExamRequest).
 */
import type { DifficultyBand, KnownPattern } from '@ogrenmen/contracts';
import { MAX_EXAM_QUESTIONS, type ExamRequest, type NotesRequest, type PatternInput } from '@ogrenmen/prompts';
import type { Db } from '../db.js';

export type GeneratedKind = 'notes' | 'mock_exam' | 'question_set';

export interface DocSpec {
  topic?: string | null;
  skill_ids?: string[] | null;
  length?: 'short' | 'medium' | 'long' | null;
  difficulty?: 'easy' | 'medium' | 'hard' | 'mixed' | null;
  include_my_mistakes?: boolean | null;
  question_count?: number | null;
  duration_min?: number | null;
  title?: string | null;
  review?: boolean | null;
  audience?: string | null;
  source?: string | null;
}

export interface DocRow {
  id: string;
  kind: GeneratedKind;
  title: string;
  spec: DocSpec;
  status: string;
  student_id: string | null;
  course_id: string | null;
  review_required: boolean;
  cost_usd: number;
  content: unknown;
  request_id: string | null;
  request_status: string | null;
  enrollment_id: string | null;
  message_id: string | null;
  curriculum_id: string | null;
  course_title: string | null;
  target_exam: string | null;
  student_ref: string | null;
}

/** Belge (ya da isteği) → satır; yoksa null. */
export async function loadDocument(db: Db, ids: { document_id?: string | undefined; request_id?: string | undefined }): Promise<DocRow | null> {
  const r = await db.query(
    `with target as (
       select coalesce($1::uuid, (select d.generated_document_id from public.document_requests d where d.id = $2::uuid)) as id)
     select gd.id, gd.kind, gd.title, gd.spec, gd.status, gd.student_id, gd.course_id, gd.review_required,
            gd.cost_usd::float8 as cost_usd, gd.content,
            dr.id as request_id, dr.status as request_status,
            coalesce(dr.enrollment_id, (select e2.id from public.enrollments e2
                                         where gd.student_id is not null and e2.student_id = gd.student_id
                                           and (gd.course_id is null or e2.course_id = gd.course_id)
                                         order by (e2.status = 'active') desc, e2.started_at desc limit 1)) as enrollment_id,
            dr.conversation_message_id::text as message_id
       from target t
       join public.generated_documents gd on gd.id = t.id
       left join lateral (select d.* from public.document_requests d where d.generated_document_id = gd.id
                           order by (d.id = $2::uuid) desc, d.created_at desc limit 1) dr on true`,
    [ids.document_id ?? null, ids.request_id ?? null],
  );
  const row = r.rows[0] as Omit<DocRow, 'curriculum_id' | 'course_title' | 'target_exam' | 'student_ref'> | undefined;
  if (!row) return null;
  const x = await db.query(
    `select coalesce(e.curriculum_id, co.curriculum_id) as curriculum_id, coalesce(co.title, c.label) as course_title,
            e.target_exam, st.public_ref as student_ref
       from (select 1) one
       left join public.enrollments e on e.id = $1::uuid
       left join public.courses co on co.id = $2::uuid
       left join public.curricula c on c.id = coalesce(e.curriculum_id, co.curriculum_id)
       left join public.students st on st.id = $3::uuid`,
    [row.enrollment_id, row.course_id, row.student_id],
  );
  const extra = (x.rows[0] ?? {}) as Pick<DocRow, 'curriculum_id' | 'course_title' | 'target_exam' | 'student_ref'>;
  return {
    ...row,
    spec: (row.spec ?? {}) as DocSpec,
    cost_usd: Number(row.cost_usd ?? 0),
    curriculum_id: extra.curriculum_id ?? null,
    course_title: extra.course_title ?? null,
    target_exam: extra.target_exam ?? null,
    student_ref: extra.student_ref ?? null,
  };
}

export interface SkillRow {
  id: string;
  parent_id: string | null;
  name: string;
  is_leaf: boolean;
  order_no: number;
}

export async function loadSkills(db: Db, curriculumId: string): Promise<SkillRow[]> {
  const r = await db.query(`select s.id, s.parent_id, s.name, s.is_leaf, s.order_no from public.skills s where s.curriculum_id = $1::uuid order by s.order_no, s.id`, [curriculumId]);
  return r.rows as unknown as SkillRow[];
}

/** Kökten yaprağa: yaprağın en üst atası (bölüm adı için). */
export function topAncestor(skills: readonly SkillRow[], id: string): SkillRow | null {
  const by = new Map(skills.map((s) => [s.id, s]));
  let cur = by.get(id) ?? null;
  for (let guard = 0; cur?.parent_id && guard < 20; guard++) cur = by.get(cur.parent_id) ?? cur;
  return cur;
}

/** Verilen kodların yaprakları (üst düğüm verildiyse altındaki yapraklar). */
export function leavesOf(skills: readonly SkillRow[], ids: readonly string[]): SkillRow[] {
  const want = new Set(ids);
  const out: SkillRow[] = [];
  for (const s of skills) {
    if (!s.is_leaf) continue;
    let cur: SkillRow | undefined = s;
    const by = new Map(skills.map((k) => [k.id, k]));
    for (let guard = 0; cur && guard < 20; guard++) {
      if (want.has(cur.id)) {
        out.push(s);
        break;
      }
      cur = cur.parent_id ? by.get(cur.parent_id) : undefined;
    }
  }
  return out;
}

const norm = (s: string) => s.toLocaleLowerCase('tr').normalize('NFC');

/**
 * Hedef yapraklar: istekteki kodlar → konu adı eşleşmesi → kaydın en zayıf iki yaprağı → müfredatın ilk yaprakları.
 */
export async function targetLeaves(db: Db, doc: DocRow, skills: readonly SkillRow[], max: number): Promise<SkillRow[]> {
  const ids = doc.spec.skill_ids ?? [];
  if (ids.length > 0) {
    const l = leavesOf(skills, ids);
    if (l.length > 0) return l.slice(0, max);
  }
  const topic = doc.spec.topic ? norm(doc.spec.topic) : '';
  if (topic) {
    const words = topic.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4);
    const hits = skills.filter((s) => s.is_leaf && (norm(s.name).includes(topic) || words.some((w) => norm(s.name).includes(w.slice(0, Math.max(4, w.length - 2))))));
    if (hits.length > 0) return hits.slice(0, max);
  }
  if (doc.enrollment_id) {
    const r = await db.query(`select m.skill_id from public.mastery m where m.enrollment_id = $1::uuid order by m.p asc, m.skill_id limit 2`, [doc.enrollment_id]);
    const weak = r.rows.map((x) => String(x.skill_id));
    const l = skills.filter((s) => s.is_leaf && weak.includes(s.id));
    if (l.length > 0) return l.slice(0, max);
  }
  return skills.filter((s) => s.is_leaf).slice(0, Math.min(max, 2));
}

// ------------------------------------------------------------------------------------------------ örüntüler

interface PatternsRpc {
  patterns?: { lines?: { pattern_id: string; text: string; dates: string[] }[]; updated_at?: string | null };
  misconceptions?: { pattern_id: string; tag: string | null; skill_id: string | null; text_student: string | null; evidence_count: number | null; dates: string[] }[];
  recent_analyses?: { pattern_id: string; dates: string[]; skill_ids: string[] | null; one_line: string | null; error_cause: string | null }[];
}

/** DB kimliği `patterns.md#<satır>` → prompt/AST kimliği `patterns.md:<satır>` (iki yazım da kabul edilir). */
export function normalizePatternId(id: string): string {
  return id.replace(/^patterns\.md#(\d+)$/, 'patterns.md:$1');
}

const isoDay = (s: string | null | undefined) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);

/** `student_patterns_for_prompt` → prompt örüntüleri (en çok 12; hedef yapraklara ait olanlar önce). */
export async function loadPatterns(db: Db, studentId: string, courseId: string | null, focus: readonly string[]): Promise<{ patterns: PatternInput[]; known: KnownPattern[] }> {
  const r = await db.query('select public.student_patterns_for_prompt($1::uuid, $2::uuid) as p', [studentId, courseId]);
  const p = (r.rows[0]?.p ?? {}) as PatternsRpc;
  const out: PatternInput[] = [];
  const fallbackDay = isoDay(p.patterns?.updated_at ?? null);
  for (const l of p.patterns?.lines ?? []) {
    const dates = l.dates.length > 0 ? l.dates : fallbackDay ? [fallbackDay] : [];
    if (dates.length === 0 || !l.text.trim()) continue;
    out.push({ source: 'patterns.md', id: normalizePatternId(l.pattern_id), dates, skill_code: null, summary: l.text, count: Math.max(1, l.dates.length) });
  }
  for (const m of p.misconceptions ?? []) {
    if (m.dates.length === 0) continue;
    out.push({ source: 'misconception', id: m.pattern_id, dates: m.dates, skill_code: m.skill_id, summary: m.text_student || m.tag || m.pattern_id, count: Math.max(1, m.evidence_count ?? 1) });
  }
  for (const a of p.recent_analyses ?? []) {
    if (a.dates.length === 0 || !a.one_line) continue;
    out.push({ source: 'analysis', id: a.pattern_id, dates: a.dates, skill_code: a.skill_ids?.[0] ?? null, summary: a.one_line, count: 1 });
  }
  const rank = (x: PatternInput) => (x.skill_code && focus.includes(x.skill_code) ? 0 : x.skill_code === null ? 1 : 2);
  const patterns = out.map((x, i) => ({ x, i })).sort((a, b) => rank(a.x) - rank(b.x) || a.i - b.i).map((z) => z.x).slice(0, 12);
  return { patterns, known: patterns.map((x) => ({ source: x.source, id: x.id, dates: x.dates })) };
}

/** Koç sohbetindeki istek cümlesi (yalnız metin blokları; veri olarak gider). */
export async function studentRequestText(db: Db, messageId: string | null): Promise<string | null> {
  if (!messageId) return null;
  const r = await db.query(`select m.content from public.conversation_messages m where m.id = $1::bigint and m.role = 'user'`, [messageId]);
  const c = r.rows[0]?.content as { type?: string; text?: string }[] | string | undefined;
  if (!c) return null;
  const text = typeof c === 'string' ? c : c.filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join(' ');
  return text.trim() ? text.trim().slice(0, 400) : null;
}

// ------------------------------------------------------------------------------------------------ istekler

export const NOTE_PAGES = { short: 3, medium: 6, long: 10 } as const;

export function notesRequest(doc: DocRow, leaves: readonly SkillRow[], patterns: PatternInput[], studentRequest: string | null): NotesRequest {
  const count = doc.spec.question_count ?? 5;
  return {
    topic: (doc.spec.topic ?? leaves[0]?.name ?? doc.title).slice(0, 120),
    skills: leaves.map((l) => ({ code: l.id, name: l.name })),
    pages: NOTE_PAGES[doc.spec.length ?? 'medium'],
    include_mistakes: doc.student_id !== null && doc.spec.include_my_mistakes !== false,
    self_check_count: Math.min(10, Math.max(1, count)),
    patterns: doc.student_id !== null && doc.spec.include_my_mistakes !== false ? patterns : [],
    student_request: studentRequest,
  };
}

const DIFF_SHARE: Record<string, Record<DifficultyBand, number>> = {
  easy: { easy: 0.6, medium: 0.3, hard: 0.1 },
  medium: { easy: 0.3, medium: 0.5, hard: 0.2 },
  hard: { easy: 0.1, medium: 0.4, hard: 0.5 },
  mixed: { easy: 0.3, medium: 0.45, hard: 0.25 },
};

/** Zorluk bantları (toplam = n; en büyük kalan yöntemi). */
export function difficultySplit(n: number, level: string): Record<DifficultyBand, number> {
  const share = DIFF_SHARE[level] ?? DIFF_SHARE.mixed!;
  const bands: DifficultyBand[] = ['easy', 'medium', 'hard'];
  const raw = bands.map((b) => share[b] * n);
  const out = raw.map(Math.floor);
  let left = n - out.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => ({ i, r: v - Math.floor(v) })).sort((a, b) => b.r - a.r);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k]!.i]!++;
  return { easy: out[0]!, medium: out[1]!, hard: out[2]! };
}

/** Bölümler: hedef yapraklar en üst atalarına göre gruplanır (≤ 6), soru sayısı yaprak sayısıyla orantılı (her bölüme ≥ 1). */
export function examSections(skills: readonly SkillRow[], leaves: readonly SkillRow[], total: number): { name: string; count: number; skills: string[] }[] {
  const groups = new Map<string, { name: string; skills: string[] }>();
  for (const l of leaves) {
    const top = topAncestor(skills, l.id) ?? l;
    const g = groups.get(top.id) ?? { name: top.id === l.id ? l.name : top.name, skills: [] };
    g.skills.push(l.id);
    groups.set(top.id, g);
  }
  const list = [...groups.values()].sort((a, b) => b.skills.length - a.skills.length).slice(0, Math.min(6, total));
  const totalLeaves = list.reduce((a, g) => a + g.skills.length, 0);
  const counts = list.map((g) => Math.max(1, Math.floor((g.skills.length / totalLeaves) * total)));
  let diff = total - counts.reduce((a, b) => a + b, 0);
  for (let i = 0; diff !== 0 && counts.length > 0; i = (i + 1) % counts.length) {
    if (diff > 0) {
      counts[i]!++;
      diff--;
    } else if (counts[i]! > 1) {
      counts[i]!--;
      diff++;
    }
  }
  return list.map((g, i) => ({ name: g.name.slice(0, 80), count: counts[i]!, skills: g.skills }));
}

export function examRequest(doc: DocRow, skills: readonly SkillRow[], leaves: readonly SkillRow[], patterns: PatternInput[], weak: readonly string[]): ExamRequest {
  const want = doc.spec.question_count ?? (doc.kind === 'mock_exam' ? 40 : 10);
  const total = Math.min(MAX_EXAM_QUESTIONS, Math.max(1, want));
  const sections = examSections(skills, leaves, total);
  const exam = (doc.target_exam ?? 'TYT').slice(0, 40);
  const include = doc.student_id !== null && doc.spec.include_my_mistakes === true;
  return {
    title: doc.title,
    exam,
    sections,
    difficulty: difficultySplit(sections.reduce((a, s) => a + s.count, 0), doc.spec.difficulty ?? 'mixed'),
    duration_min: doc.kind === 'mock_exam' ? (doc.spec.duration_min ?? Math.max(10, Math.round(total * 1.5))) : (doc.spec.duration_min ?? null),
    options_per_question: /^LGS/i.test(exam) ? 4 : 5,
    include_mistakes: include,
    focus_skills: include ? weak.slice(0, 6) : [],
    patterns: include ? patterns : [],
  };
}
