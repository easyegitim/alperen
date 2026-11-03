'use server';

import { chatSession } from '@/server/chat/session';
import { isCoachMode } from '@/server/chat/types';

/** Öğrenci modu değiştirir (conversations.mode). Model modu değiştiremez; yalnız önerir. */
export async function saveCoachMode(conversationId: string, mode: string): Promise<{ ok: boolean }> {
  if (!isCoachMode(mode) || !/^[0-9a-f-]{36}$/i.test(conversationId)) return { ok: false };
  try {
    const { deps, student } = await chatSession();
    return { ok: await deps.store.setMode(student, conversationId, mode) };
  } catch {
    return { ok: false };
  }
}
