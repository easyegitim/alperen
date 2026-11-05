/** Veli Sohbet sayfasının başlangıç durumu (sunucu bileşeni çağırır). Hata durumunda sohbet "kullanılamıyor" çizilir. */
import 'server-only';
import type { ParentItem } from '@/lib/parent';
import { toParentDisplay } from './agent';
import { parentSession } from './session';

export const PARENT_DISPLAY_LIMIT = 80;

export interface ParentBootstrap {
  available: boolean;
  conversationId: string | null;
  messages: ParentItem[];
  /** Önceki bir tur sürüyor (başka sekme ya da sayfadan ayrılıp dönme). */
  pending: boolean;
}

export async function loadParentBootstrap(studentId: string): Promise<ParentBootstrap> {
  try {
    const { deps } = await parentSession();
    const h = await deps.store.history({ conversationId: null, studentId, limit: PARENT_DISPLAY_LIMIT });
    if (!h) return { available: false, conversationId: null, messages: [], pending: false };
    return { available: true, conversationId: h.conversation?.id ?? null, messages: toParentDisplay(h.messages), pending: h.conversation?.turnInProgress ?? false };
  } catch (err) {
    console.error('OGR-PARENT-008 veli sohbeti yüklenemedi', err);
    return { available: false, conversationId: null, messages: [], pending: false };
  }
}
