/** Koç sayfasının başlangıç durumu (sunucu bileşeni çağırır). Hata durumunda koç "kullanılamıyor" çizilir. */
import 'server-only';
import type { ChatBootstrap } from '@/lib/chat';
import { toDisplay } from './history';
import { chatSession } from './session';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Ekranda gösterilen en çok mesaj (geçmiş penceresinden bağımsız). */
export const DISPLAY_LIMIT = 80;

export async function loadBootstrap(seedId: string | null): Promise<ChatBootstrap> {
  const empty: ChatBootstrap = { available: false, conversationId: null, mode: 'hint', messages: [], seed: null, pending: false };
  let session;
  try {
    session = await chatSession();
  } catch {
    return empty;
  }
  const { deps, student } = session;
  try {
    const conv = await deps.store.latestConversation(student);
    const messages = conv ? toDisplay(await deps.store.listMessages(conv.id, { limit: DISPLAY_LIMIT })) : [];
    // Önceki bir tur sürüyorsa (başka sekme ya da sayfadan ayrılıp dönme) arayüz "yazıyor" gösterir, gönderim kapalı kalır.
    const pending = conv ? await deps.store.turnInProgress(conv.id) : false;
    let seed: ChatBootstrap['seed'] = null;
    if (seedId && UUID.test(seedId)) {
      const s = await deps.store.getSeed(student, seedId);
      if (s) {
        const ups = s.uploadIds.length > 0 ? await deps.store.getUploads(student, s.uploadIds) : [];
        seed = { id: s.id, summary: s.summary, attachments: ups.map((u) => ({ id: u.id, kind: u.kind })) };
      }
    }
    return { available: true, conversationId: conv?.id ?? null, mode: conv?.mode ?? 'hint', messages, seed, pending };
  } catch (err) {
    console.error('OGR-CHAT-008 koç sayfası yüklenemedi', err);
    return empty;
  }
}
