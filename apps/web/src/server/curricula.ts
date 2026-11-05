import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CurriculumDatabase, CurriculumProposalRow, CurriculumRow, EditorState, SkillDbRow } from '@/lib/supabase/curriculum-types';
import { createSupabaseServerClient } from './supabase';

// Eğitmen müfredat sayfalarının sorguları (kullanıcının JWT'si; RLS: personel tüm müfredatları ve önerileri okur,
// supabase/migrations/0018_rls.sql). Yazım yalnız RPC'lerle (0025_curriculum_builder.sql) ve sunucu eylemlerinden.
// curricula.draft_meta ve draft_error authenticated'a kapalıdır (sütun yetkisi, 0025): sütunlar açıkça seçilir
// (select=* izin hatası verir); taslak notu ve hatası curriculum_editor_state.draft'tan gelir.

export type CurriculumClient = SupabaseClient<CurriculumDatabase>;

/** Müfredat tipleriyle aynı oturumlu istemci (types.ts'teki ana şemaya dokunmadan). */
export async function curriculumClient(): Promise<CurriculumClient> {
  return (await createSupabaseServerClient()) as unknown as CurriculumClient;
}

export type CurriculumListItem = Pick<
  CurriculumRow,
  'id' | 'code' | 'version' | 'label' | 'status' | 'origin' | 'draft_status' | 'draft_progress' | 'created_at' | 'published_at'
> & { courses: string[]; openProposals: number };

const STATUS_ORDER: Record<string, number> = { draft: 0, active: 1, retired: 2 };

/** Liste: ders adları, sürüm, durum, açık öneri sayısı; taslaklar önce, sonra yayındakiler, emekliler en sonda. */
export async function listCurricula(): Promise<CurriculumListItem[]> {
  const supabase = await curriculumClient();
  const [cur, courses, props] = await Promise.all([
    supabase
      .from('curricula')
      .select('id, code, version, label, status, origin, draft_status, draft_progress, created_at, published_at')
      .order('created_at', { ascending: false })
      .limit(300),
    supabase.from('courses').select('id, title, curriculum_id'),
    supabase.from('curriculum_proposals').select('curriculum_id').eq('status', 'open'),
  ]);
  const byCur = new Map<string, string[]>();
  for (const c of courses.data ?? []) if (c.curriculum_id) byCur.set(c.curriculum_id, [...(byCur.get(c.curriculum_id) ?? []), c.title]);
  const open = new Map<string, number>();
  for (const p of props.data ?? []) open.set(p.curriculum_id, (open.get(p.curriculum_id) ?? 0) + 1);
  return (cur.data ?? [])
    .map((c) => ({ ...c, courses: byCur.get(c.id) ?? [], openProposals: open.get(c.id) ?? 0 }))
    .sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || b.created_at.localeCompare(a.created_at));
}

/** authenticated'ın okuyabildiği curricula sütunları (draft_meta ve draft_error hariç). */
export const CURRICULUM_PUBLIC_COLUMNS =
  'id, code, authority, year, version, label, status, origin, source_refs, created_by, created_at, draft_status, draft_progress, draft_updated_at, autopilot, previous_id, published_at, edited_at';

export type CurriculumPublicRow = Omit<CurriculumRow, 'draft_meta' | 'draft_error'>;

export interface CurriculumEditorData {
  curriculum: CurriculumPublicRow;
  skills: Pick<SkillDbRow, 'id' | 'parent_id' | 'name' | 'kind' | 'is_leaf' | 'order_no' | 'description'>[];
  proposals: Pick<CurriculumProposalRow, 'id' | 'kind' | 'payload' | 'evidence_ids' | 'status' | 'created_at'>[];
  courses: string[];
  state: EditorState | null;
}

/** Editör: müfredat satırı, kazanımlar, açık öneriler ve başlık durumu (curriculum_editor_state). */
export async function getCurriculumEditor(id: string): Promise<CurriculumEditorData | null> {
  const supabase = await curriculumClient();
  const { data: curriculum } = await supabase.from('curricula').select(CURRICULUM_PUBLIC_COLUMNS).eq('id', id).maybeSingle<CurriculumPublicRow>();
  if (!curriculum) return null;
  const [skills, proposals, courses, state] = await Promise.all([
    supabase.from('skills').select('id, parent_id, name, kind, is_leaf, order_no, description').eq('curriculum_id', id).order('order_no'),
    supabase.from('curriculum_proposals').select('id, kind, payload, evidence_ids, status, created_at').eq('curriculum_id', id).eq('status', 'open').order('created_at'),
    supabase.from('courses').select('title').eq('curriculum_id', id),
    supabase.rpc('curriculum_editor_state', { p_curriculum: id }),
  ]);
  return {
    curriculum,
    skills: skills.data ?? [],
    proposals: proposals.data ?? [],
    courses: (courses.data ?? []).map((c) => c.title),
    state: (state.data as unknown as EditorState | null) ?? null,
  };
}
