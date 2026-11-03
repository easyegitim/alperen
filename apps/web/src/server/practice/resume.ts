import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/server/supabase';
import type { RpcClient } from './rpc';
import { getPracticeSet } from './service';

/** Yarım kalan set bu süreden eskiyse Bugün'de öne çıkarılmaz (terk edilmiş sayılır). */
export const RESUME_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

export interface ResumableSet {
  id: string;
  answered: number;
  total: number;
  /** Sorular henüz üretiliyor (needs_generation). */
  preparing: boolean;
}

/**
 * Etkin kaydın en yeni "in_progress" seti (RLS: practice_sets_select). Öneri başlatılınca tüketildiğinden Bugün'de
 * görünmez; bu yüzden yarım kalan test "Devam et" kartıyla geri döner. Soru yoksa ya da set eskiyse null.
 */
export async function findResumableSet(db: RpcClient, enrollmentId: string, now: Date = new Date()): Promise<ResumableSet | null> {
  // practice_sets henüz src/lib/supabase/types.ts'te tiplenmedi; yanıt yalnız id okunur.
  const supabase = (await createSupabaseServerClient()) as unknown as SupabaseClient;
  const since = new Date(now.getTime() - RESUME_WINDOW_MS).toISOString();
  const { data } = await supabase
    .from('practice_sets')
    .select('id')
    .eq('enrollment_id', enrollmentId)
    .in('status', ['in_progress', 'needs_generation'])
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(1);
  const id = data?.[0]?.id;
  if (!id) return null;
  const res = await getPracticeSet(db, id);
  if (!res.ok) return null;
  if (res.data.status === 'needs_generation') return { id, answered: 0, total: 0, preparing: true };
  if (res.data.status !== 'in_progress' || res.data.total === 0 || res.data.answered >= res.data.total) return null;
  return { id, answered: res.data.answered, total: res.data.total, preparing: false };
}
