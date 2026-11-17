'use server';

import { requireRole } from '@/server/auth';
import { getMyStudent } from '@/server/queries';
import { createSupabaseServerClient } from '@/server/supabase';

export interface InviteCreateState {
  /** Üretilen davet kodu (yalnız bu yanıtta görünür; veritabanında sha256 özeti saklanır). */
  token?: string;
  expiresAt?: string;
  error?: string;
}

const RELATIONS = ['anne', 'baba', 'vasi', 'diğer'] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Veli daveti üretir (create_guardian_invite RPC). Öğrenci kendi kaydı için, eğitmen (owner) ve yönetici formdaki
 * `studentId` için üretir; yetki kararını RPC verir (app.assert_student_access). Kod bir kez döner.
 */
export async function createGuardianInvite(_prev: InviteCreateState, formData: FormData): Promise<InviteCreateState> {
  const { user, role } = await requireRole('student', 'instructor', 'admin');
  let studentId: string | null = null;
  if (role === 'student') {
    // Öğrenci yalnız kendi kaydı için üretebilir; forma güvenilmez.
    studentId = (await getMyStudent(user.id))?.id ?? null;
  } else {
    const raw = String(formData.get('studentId') ?? '');
    studentId = UUID_RE.test(raw) ? raw : null;
  }
  if (!studentId) return { error: 'Öğrenci kaydı bulunamadı.' };

  const relationRaw = String(formData.get('relation') ?? '');
  const relation = (RELATIONS as readonly string[]).includes(relationRaw) ? relationRaw : undefined;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('create_guardian_invite', { p_student: studentId, p_relation: relation });
  if (error) return { error: 'Davet kodu üretilemedi. Biraz sonra yeniden dene.' };
  const result = data as { token?: unknown; expires_at?: unknown } | null;
  if (!result || typeof result.token !== 'string' || typeof result.expires_at !== 'string') return { error: 'Davet kodu üretilemedi. Biraz sonra yeniden dene.' };
  return { token: result.token, expiresAt: result.expires_at };
}
