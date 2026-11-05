/**
 * Tarz kütüphanesi veritabanı erişimi (worker, service_role/postgres: app.is_trusted()). Yazımlar RPC ile
 * (register_exam_items, upsert_question_styles, compute_priority_plan; 0037/0038); okumalar düz sorgu.
 */
import type { Db } from '../db.js';

const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

export interface SourceRow {
  id: string;
  course_id: string;
  course_code: string | null;
  course_title: string | null;
  curriculum_id: string | null;
  year: number;
  term: string;
  status: string;
  upload_ids: string[];
}

export async function loadSource(db: Db, id: string): Promise<SourceRow | null> {
  const r = await db.query(
    `select s.id, s.course_id, co.code as course_code, co.title as course_title, co.curriculum_id, s.year, s.term, s.status,
            case when cardinality(s.upload_ids) > 0 then s.upload_ids when s.upload_id is not null then array[s.upload_id] else '{}' end as upload_ids
       from public.exam_sources s join public.courses co on co.id = s.course_id
      where s.id = $1::uuid`,
    [id],
  );
  const x = r.rows[0];
  if (!x) return null;
  return {
    id: String(x.id),
    course_id: String(x.course_id),
    course_code: str(x.course_code),
    course_title: str(x.course_title),
    curriculum_id: str(x.curriculum_id),
    year: Number(x.year),
    term: String(x.term),
    status: String(x.status),
    upload_ids: strs(x.upload_ids),
  };
}

export interface CourseItem {
  id: string;
  source_id: string;
  item_no: number;
  year: number | null;
  term: string | null;
  topic: string | null;
  kind: string;
  format: string | null;
  trick: string | null;
  difficulty: number | null;
  points: number | null;
  skill_ids: string[];
  ocr_text: string;
  style_id: string | null;
  embedding: number[] | null;
}

function parseVector(v: unknown): number[] | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s.startsWith('[')) return null;
  const arr = s.slice(1, -1).split(',').map(Number);
  return arr.length > 0 && arr.every(Number.isFinite) ? arr : null;
}

/** Dersin düşmemiş kaynaklarındaki bütün maddeler (kümeleme sırası: yıl, kaynak, madde no). */
export async function loadCourseItems(db: Db, courseId: string): Promise<CourseItem[]> {
  const r = await db.query(
    `select ei.id, ei.source_id, ei.item_no, coalesce(ei.year, s.year) as year, coalesce(ei.term, s.term) as term, ei.topic,
            ei.kind, ei.format, ei.trick, ei.difficulty, ei.points,
            case when cardinality(ei.skill_ids) > 0 then ei.skill_ids when ei.skill_id is not null then array[ei.skill_id] else '{}' end as skill_ids,
            coalesce(ei.ocr_text, '') as ocr_text, ei.style_id, ei.embedding::text as embedding
       from public.exam_items ei join public.exam_sources s on s.id = ei.source_id
      where s.course_id = $1::uuid and s.status <> 'failed'
      order by coalesce(ei.year, s.year), s.created_at, s.id, ei.item_no`,
    [courseId],
  );
  return r.rows.map((x) => ({
    id: String(x.id),
    source_id: String(x.source_id),
    item_no: Number(x.item_no),
    year: num(x.year),
    term: str(x.term),
    topic: str(x.topic),
    kind: String(x.kind),
    format: str(x.format),
    trick: str(x.trick),
    difficulty: num(x.difficulty),
    points: num(x.points),
    skill_ids: strs(x.skill_ids),
    ocr_text: String(x.ocr_text ?? ''),
    style_id: str(x.style_id),
    embedding: parseVector(x.embedding),
  }));
}

export interface StyleRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  format: string | null;
  trick: string | null;
  difficulty_band: string | null;
  status: string;
  source: string;
  reviewed: boolean;
  skill_ids: string[];
  exemplar_item_ids: string[];
  years_hit: number[];
  frequency_score: number | null;
  priority_score: number | null;
  course_id: string;
  curriculum_id: string | null;
}

const STYLE_COLS = `qs.id, qs.code, qs.name, qs.description, qs.format, qs.trick, qs.difficulty_band, qs.status, qs.source,
  qs.reviewed_at is not null as reviewed, qs.skill_ids, qs.exemplar_item_ids, qs.years_hit, qs.frequency_score, qs.priority_score,
  qs.course_id, coalesce(qs.curriculum_id, co.curriculum_id) as curriculum_id`;

function styleRow(x: Record<string, unknown>): StyleRow {
  return {
    id: String(x.id),
    code: String(x.code),
    name: String(x.name),
    description: str(x.description),
    format: str(x.format),
    trick: str(x.trick),
    difficulty_band: str(x.difficulty_band),
    status: String(x.status),
    source: String(x.source),
    reviewed: x.reviewed === true,
    skill_ids: strs(x.skill_ids),
    exemplar_item_ids: strs(x.exemplar_item_ids),
    years_hit: Array.isArray(x.years_hit) ? x.years_hit.map(Number) : [],
    frequency_score: num(x.frequency_score),
    priority_score: num(x.priority_score),
    course_id: String(x.course_id),
    curriculum_id: str(x.curriculum_id),
  };
}

export async function loadStyles(db: Db, courseId: string): Promise<StyleRow[]> {
  const r = await db.query(
    `select ${STYLE_COLS} from public.question_styles qs join public.courses co on co.id = qs.course_id
      where qs.course_id = $1::uuid order by qs.code`,
    [courseId],
  );
  return r.rows.map(styleRow);
}

export async function loadStyle(db: Db, styleId: string): Promise<StyleRow | null> {
  const r = await db.query(`select ${STYLE_COLS} from public.question_styles qs join public.courses co on co.id = qs.course_id where qs.id = $1::uuid`, [styleId]);
  return r.rows[0] ? styleRow(r.rows[0]) : null;
}

export async function skillNames(db: Db, curriculumId: string | null): Promise<Map<string, { name: string; description: string | null; leaf: boolean }>> {
  if (!curriculumId) return new Map();
  const r = await db.query('select id, name, description, is_leaf from public.skills where curriculum_id = $1::uuid', [curriculumId]);
  return new Map(r.rows.map((x) => [String(x.id), { name: String(x.name), description: str(x.description), leaf: x.is_leaf === true }]));
}

/** register_exam_items maddesi (exam-item v2 + gömme). */
export interface ItemPayload {
  item_no: number;
  topic: string | null;
  kind: 'proof' | 'calc' | 'mc' | 'other';
  format: string | null;
  trick: string | null;
  difficulty: number | null;
  points: number | null;
  year: number | null;
  skill_ids: string[];
  ocr_text: string;
  embedding?: number[] | null;
}

export async function registerExamItems(db: Db, sourceId: string, items: readonly ItemPayload[]): Promise<{ item_count: number; items: { item_no: number; id: string }[] }> {
  const r = await db.query('select public.register_exam_items($1::uuid, $2::jsonb) as r', [sourceId, JSON.stringify(items)]);
  return r.rows[0]!.r as { item_count: number; items: { item_no: number; id: string }[] };
}

export interface StylePayload {
  code: string;
  name?: string;
  description?: string | null;
  format?: string | null;
  trick?: string | null;
  difficulty_band?: string | null;
  skill_ids?: string[];
  item_ids?: string[];
  exemplar_item_ids?: string[];
  embedding?: number[] | null;
}

export async function upsertStyles(db: Db, courseId: string, styles: readonly StylePayload[]): Promise<{ code: string; id: string; created: boolean }[]> {
  const out: { code: string; id: string; created: boolean }[] = [];
  for (let i = 0; i < styles.length; i += 100) {
    const r = await db.query('select public.upsert_question_styles($1::uuid, $2::jsonb) as r', [courseId, JSON.stringify(styles.slice(i, i + 100))]);
    out.push(...(((r.rows[0]?.r as { styles?: { code: string; id: string; created: boolean }[] }) ?? {}).styles ?? []));
  }
  return out;
}

export type PlanOutcome =
  | { status: 'computed'; plan_id: string; rows: number; evidence: number }
  | { status: 'skipped'; reason: 'insufficient_years' | 'no_styled_items'; detail: string };

/** compute_priority_plan; iki yıldan az arşiv (OGR-STYLE-010) ya da tarza atanmış madde yoksa (OGR-STYLE-011) atlanır. */
export async function computePlan(db: Db, courseId: string): Promise<PlanOutcome> {
  try {
    const r = await db.query('select public.compute_priority_plan($1::uuid) as r', [courseId]);
    const x = r.rows[0]!.r as { plan_id: string; plan: { rows?: unknown[]; evidence_count?: number } };
    return { status: 'computed', plan_id: x.plan_id, rows: x.plan.rows?.length ?? 0, evidence: Number(x.plan.evidence_count ?? 0) };
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('OGR-STYLE-010')) return { status: 'skipped', reason: 'insufficient_years', detail: msg.slice(0, 200) };
    if (msg.includes('OGR-STYLE-011')) return { status: 'skipped', reason: 'no_styled_items', detail: msg.slice(0, 200) };
    throw err;
  }
}

export async function markSourceFailed(db: Db, sourceId: string, error: string): Promise<void> {
  await db.query(
    `with s as (update public.exam_sources set status = 'failed', error = left($2, 500)
                 where id = $1::uuid and status = 'uploaded' returning upload_ids)
     update public.uploads u set status = 'failed' from s where u.id = any(s.upload_ids) and u.status = 'processing'`,
    [sourceId, error],
  );
}
