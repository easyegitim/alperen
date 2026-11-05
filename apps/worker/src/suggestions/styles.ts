/**
 * Öneri motoru tarz kuralı (P4, docs/PLAN-v2.md §11 "kapsama"): kaydın dersinde etkin, sorulmuş (yılı olan) ve bankasında
 * onaylı tarz sorusu bulunan tarzlardan kapsaması en düşük olanı (hiç çözülmemiş; önce hiç görülmemiş, sonra öncelik
 * skoru) → 'practice' kartı, payload.style_id ("Bu tarzı hiç çözmedin · 8 soru · 12 dk"). Bütün tarzlar en az bir kez
 * çözüldüyse kart yoktur (Bugün sade kalır). Kartın kazanımları bugün başka kartta ya da bugün çalışıldıysa kart açılmaz.
 * Sinyal signals.ts'te tek satırla (`styleGap`), kart rules.ts'te tek satırla (`styleSuggestion`) eklenir.
 */
import type { Db } from '../db.js';
import type { EnrollmentSignals, PlannedSuggestion } from './rules.js';

export interface StyleGap {
  styleId: string;
  name: string;
  skillIds: string[];
  seen: number;
  solved: number;
  correct: number;
  /** "Bu tarzı hiç çözmedin" | "Bu tarzı gördün, henüz çözmedin". */
  coverageText: string;
}

/** Kartın sırası: en zayıf yaprak alıştırmasından (10) sonra, eksik analizinden (20) önce. */
export const RANK_STYLE_GAP = 15;
export const STYLE_PRACTICE = { count: 8, minutes: 12 } as const;

export async function styleGapOf(db: Db, enrollmentId: string): Promise<StyleGap | null> {
  const r = await db.query(
    `select qs.id, qs.name, qs.skill_ids, coalesce(sc.seen_count, 0) as seen, coalesce(sc.solved_count, 0) as solved,
            coalesce(sc.correct_count, 0) as correct
       from public.enrollments e
       join public.question_styles qs on qs.course_id = e.course_id
       left join public.style_coverage sc on sc.enrollment_id = e.id and sc.style_id = qs.id
      where e.id = $1::uuid and qs.status = 'active' and cardinality(qs.years_hit) > 0 and cardinality(qs.skill_ids) > 0
        and coalesce(sc.solved_count, 0) = 0
        and exists (select 1 from public.questions q where q.style_id = qs.id and q.status = 'approved')
      order by coalesce(sc.seen_count, 0), qs.priority_score desc nulls last, qs.name, qs.id
      limit 1`,
    [enrollmentId],
  );
  const x = r.rows[0];
  if (!x) return null;
  const seen = Number(x.seen);
  return {
    styleId: String(x.id),
    name: String(x.name),
    skillIds: Array.isArray(x.skill_ids) ? x.skill_ids.map(String) : [],
    seen,
    solved: Number(x.solved),
    correct: Number(x.correct),
    coverageText: seen > 0 ? 'Bu tarzı gördün, henüz çözmedin' : 'Bu tarzı hiç çözmedin',
  };
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** Tarz kartı (saf). `used`: bu planda başka kartın kazanımları; `practiced`: bugün çalışılan kazanımlar. */
export function styleSuggestion(
  e: EnrollmentSignals & { styleGap?: StyleGap | null },
  ei: number,
  used: ReadonlySet<string>,
  practiced: ReadonlySet<string>,
): Omit<PlannedSuggestion, 'expires_at'> | null {
  const g = e.styleGap;
  if (!g || g.skillIds.length === 0) return null;
  if (g.skillIds.every((s) => used.has(s)) || g.skillIds.some((s) => practiced.has(s))) return null;
  const title = clip(g.name, 60);
  return {
    kind: 'practice',
    enrollment_id: e.enrollmentId,
    rank: RANK_STYLE_GAP + ei,
    payload: { skill_ids: g.skillIds.slice(0, 3), count: STYLE_PRACTICE.count, minutes: STYLE_PRACTICE.minutes, reason: 'style_gap', style_id: g.styleId },
    title,
    subtitle: `${g.coverageText} · ${STYLE_PRACTICE.count} soru · ${STYLE_PRACTICE.minutes} dk`,
    key: `style:${e.enrollmentId}:${g.styleId}`,
    copyInput: { kind: 'practice', topic: title, course: e.courseTitle ?? '', count: STYLE_PRACTICE.count, minutes: STYLE_PRACTICE.minutes, reason: 'style_gap', coverage: g.coverageText },
  };
}
