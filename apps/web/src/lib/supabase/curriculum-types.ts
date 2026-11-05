// Müfredat editörünün okuduğu tablolar ve RPC'ler: supabase/migrations/0004 ve 0025'ten ELLE türetilmiştir.
// Ana tipler (types.ts) başka ekranlarla paylaşıldığından müfredat tipleri burada ayrı durur; sunucu sorgusu
// (src/server/curricula.ts) istemciyi bu şemayla tipler. test/curriculum.test.ts sütunları göç dosyalarıyla karşılaştırır.
import type { CourseRow, Json } from './types';

type Tbl<Row> = { Row: Row; Insert: Partial<Row>; Update: Partial<Row>; Relationships: [] };

export type CurriculumRow = {
  id: string;
  code: string;
  authority: string;
  year: number;
  version: string;
  label: string;
  status: 'draft' | 'active' | 'retired';
  origin: 'seed' | 'ai_draft' | 'instructor';
  source_refs: Json;
  created_by: string | null;
  created_at: string;
  draft_status: 'queued' | 'researching' | 'drafting' | 'saving' | 'ready' | 'failed' | 'skipped' | null;
  draft_progress: number;
  draft_error: string | null;
  draft_updated_at: string | null;
  draft_meta: Json;
  autopilot: boolean | null;
  previous_id: string | null;
  published_at: string | null;
  edited_at: string | null;
};

export type SkillDbRow = {
  curriculum_id: string;
  id: string;
  parent_id: string | null;
  name: string;
  description: string | null;
  kind: 'unit' | 'outcome' | 'sub_outcome' | null;
  is_leaf: boolean;
  order_no: number;
  exam_weight_hint: number | null;
  source_refs: Json;
  p_init: number;
  p_learn: number;
  p_guess: number;
  p_slip: number;
  created_at: string;
};

export type CurriculumProposalRow = {
  id: string;
  curriculum_id: string;
  kind: 'add_subskill' | 'rename' | 'merge' | 'add_prereq' | 'add_tag';
  payload: Json;
  evidence_ids: string[];
  status: 'open' | 'accepted' | 'rejected';
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
};

export interface AutopilotState {
  curriculum_id: string;
  eligible: boolean;
  effective: boolean;
  override: boolean | null;
  flag: boolean;
  course_kind: string;
  reason: 'origin' | 'not_exam_track' | 'instructor' | 'flag';
}

export interface EditorDraftInfo {
  status: CurriculumRow['draft_status'];
  /** Taslak işi düştüyse nedeni (personele özel; tablodan okunmaz). */
  error: string | null;
  notes_for_instructor: string | null;
  tags_dropped: string[];
  /** Düşen ve kazanımsız taslak yeniden kurulabilir (curriculum_draft_retry). */
  can_retry: boolean;
}

export interface EditorState {
  curriculum_id: string;
  can_edit: boolean;
  /** Yayın / yeni sürüm / otopilot (app.can_publish_curriculum). */
  can_publish: boolean;
  autopilot: AutopilotState;
  draft: EditorDraftInfo;
  counts: { skills: number; leaves: number; units: number; outcomes: number; sub_outcomes: number };
  open_proposals: number;
  enrollments: number;
  live_version: { id: string; version: string; published_at: string | null } | null;
  draft_child_id: string | null;
  /** Kabul edilmiş ama curriculum.merge işi kalıcı hatayla düşmüş birleştirmeler. */
  merge_errors?: { proposal_id: string; error: string }[];
}

export interface CurriculumDatabase {
  public: {
    Tables: {
      curricula: Tbl<CurriculumRow>;
      skills: Tbl<SkillDbRow>;
      curriculum_proposals: Tbl<CurriculumProposalRow>;
      courses: Tbl<CourseRow>;
    };
    Views: Record<string, never>;
    Functions: {
      curriculum_editor_state: { Args: { p_curriculum: string }; Returns: Json };
      curriculum_edit: { Args: { p_curriculum: string; p_op: string; p_args: Json }; Returns: Json };
      curriculum_publish: { Args: { p_curriculum: string; p_code_map?: Json }; Returns: Json };
      curriculum_new_version: { Args: { p_curriculum: string }; Returns: string };
      curriculum_set_autopilot: { Args: { p_curriculum: string; p_on: boolean | null }; Returns: Json };
      curriculum_autopilot_state: { Args: { p_curriculum: string }; Returns: Json };
      curriculum_draft_retry: { Args: { p_curriculum: string; p_upload_ids?: string[] }; Returns: Json };
      decide_proposal: { Args: { p_id: string; p_accept: boolean; p_note?: string | null }; Returns: Json };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
