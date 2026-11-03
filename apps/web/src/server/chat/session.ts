/** Rota işleyicileri için oturum → öğrenci çözümü (JSON hata yanıtlarıyla). */
import 'server-only';
import { getCurrentProfile } from '@/server/auth';
import { createSupabaseServerClient } from '@/server/supabase';
import { chatDeps } from './deps';
import type { UserStorageClient } from './pg-store';
import { ChatError, type TurnDeps } from './turn';
import type { ChatStudent } from './types';

export interface ChatSession {
  deps: TurnDeps;
  student: ChatStudent;
}

export async function chatSession(): Promise<ChatSession> {
  const current = await getCurrentProfile();
  if (!current) throw new ChatError('unauthenticated', 401, 'Oturumun kapanmış. Yeniden giriş yap.');
  if (current.profile?.role !== 'student') throw new ChatError('forbidden', 403, 'Koç yalnız öğrenci hesabında açılır.');
  const supabase = await createSupabaseServerClient();
  const deps = await chatDeps(supabase as unknown as UserStorageClient);
  const student = await deps.store.resolveStudent(current.user.id);
  if (!student) throw new ChatError('no_student', 403, 'Öğrenci kaydın bulunamadı.');
  return { deps, student };
}

export function errorResponse(err: unknown): Response {
  if (err instanceof ChatError) {
    return Response.json({ error: { code: err.code, message: err.message } }, { status: err.status, headers: { 'Cache-Control': 'no-store' } });
  }
  console.error('OGR-CHAT-002 beklenmeyen hata', err);
  return Response.json(
    { error: { code: 'internal', message: 'Bir sorun oldu. Biraz sonra yeniden dene.' } },
    { status: 500, headers: { 'Cache-Control': 'no-store' } },
  );
}
