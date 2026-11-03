// Supabase tipleri: supabase/migrations/0003-0018'den ELLE türetilmiştir (yalnız web'in kullandığı ana tablolar ve RPC'ler).
// Şema değişince bu dosya güncellenir; test/types-drift.test.ts sütun adlarını göç dosyalarıyla karşılaştırır.
// Yerel Supabase kurulunca `supabase gen types typescript --local` çıktısı bunun yerine geçebilir (arayüz aynı).

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Role = 'student' | 'parent' | 'instructor' | 'admin';
type TutorMode = 'hint' | 'explain' | 'solve';

/** Tablo kısaltması: Insert = zorunlu alanlar + diğerleri isteğe bağlı; Update = hepsi isteğe bağlı. */
type Tbl<Row, Required extends keyof Row = never> = {
  Row: Row;
  Insert: Pick<Row, Required> & Partial<Omit<Row, Required>>;
  Update: Partial<Row>;
  Relationships: [];
};

export type ProfileRow = {
  id: string;
  role: Role;
  display_name: string | null;
  locale: string;
  tz: string;
  avatar_path: string | null;
  onboarded_at: string | null;
  created_at: string;
  updated_at: string;
};

export type StudentRow = {
  id: string;
  public_ref: string;
  profile_id: string | null;
  grade: string | null;
  school: string | null;
  status: 'active' | 'paused' | 'archived';
  created_at: string;
};

export type GuardianLinkRow = {
  id: string;
  parent_id: string | null;
  student_id: string;
  relation: string | null;
  status: 'invited' | 'active' | 'revoked';
  invite_token_hash: string | null;
  invite_expires_at: string | null;
  created_by: string | null;
  accepted_at: string | null;
  created_at: string;
};

export type InstructorLinkRow = {
  id: string;
  instructor_id: string;
  student_id: string;
  course_id: string | null;
  role: 'owner' | 'viewer';
  created_at: string;
};

export type CourseRow = {
  id: string;
  code: string;
  title: string;
  kind: 'exam_track' | 'school' | 'university' | 'other';
  curriculum_id: string | null;
  description: string | null;
  visibility: 'private' | 'shared' | 'public';
  created_by: string | null;
  created_at: string;
};

export type EnrollmentRow = {
  id: string;
  student_id: string;
  curriculum_id: string;
  course_id: string | null;
  period_label: string;
  status: 'active' | 'paused' | 'closed';
  target_exam: string | null;
  exam_date: string | null;
  goal: string | null;
  started_at: string;
  ended_at: string | null;
  created_at: string;
};

export type PreferenceRow = {
  student_id: string;
  active_hours: number[];
  modality: 'visual' | 'verbal' | 'mixed' | null;
  default_mode: TutorMode;
  explanation_notes: string | null;
  proactive_enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type ConversationRow = {
  id: string;
  student_id: string;
  kind: 'coach' | 'parent' | 'instructor';
  participant_id: string;
  course_id: string | null;
  title: string | null;
  mode: TutorMode;
  summary: string | null;
  summary_upto_message_id: number | null;
  last_message_at: string | null;
  created_at: string;
};

export type MemoryFileRow = {
  student_id: string;
  path: string;
  content: string;
  bytes: number;
  created_at: string;
  updated_at: string;
};

export type NotificationRow = {
  id: string;
  recipient_id: string;
  kind: string;
  title: string;
  body: string | null;
  payload: Json;
  channels: Array<'in_app' | 'push' | 'email'>;
  read_at: string | null;
  sent_at: string | null;
  created_at: string;
};

export type NotificationRuleRow = {
  recipient_id: string;
  kind: string;
  enabled: boolean;
  params: Json;
  created_at: string;
};

export type PushSubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  ua: string | null;
  created_at: string;
};

export interface Database {
  public: {
    Tables: {
      profiles: Tbl<ProfileRow, 'id' | 'role'>;
      students: Tbl<StudentRow>;
      guardian_links: Tbl<GuardianLinkRow, 'student_id'>;
      instructor_links: Tbl<InstructorLinkRow, 'instructor_id' | 'student_id'>;
      courses: Tbl<CourseRow, 'code' | 'title'>;
      enrollments: Tbl<EnrollmentRow, 'student_id' | 'curriculum_id' | 'period_label'>;
      preferences: Tbl<PreferenceRow, 'student_id'>;
      conversations: Tbl<ConversationRow, 'student_id' | 'kind' | 'participant_id'>;
      memory_files: Tbl<MemoryFileRow, 'student_id' | 'path'>;
      notifications: Tbl<NotificationRow, 'recipient_id' | 'kind' | 'title'>;
      notification_rules: Tbl<NotificationRuleRow, 'recipient_id' | 'kind'>;
      push_subscriptions: Tbl<PushSubscriptionRow, 'user_id' | 'endpoint' | 'p256dh' | 'auth'>;
    };
    Views: Record<string, never>;
    Functions: {
      accept_guardian_invite: { Args: { p_token: string }; Returns: Json };
      create_guardian_invite: { Args: { p_student: string; p_relation?: string }; Returns: Json };
      revoke_guardian_link: { Args: { p_link: string }; Returns: undefined };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

/** Yardımcı: tablo satırı tipi. */
export type Row<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
export type AppRoleValue = Role;
