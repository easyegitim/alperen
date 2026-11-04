import { CHAT_COPY, type ChatMode, type DocRef } from '@/lib/chat';
import { readSse } from './sse-client';

export interface SendInput {
  conversationId: string | null;
  text: string;
  uploadIds: string[];
  mode: ChatMode;
  seed: string | null;
}

export type ClientEvent =
  | { type: 'start'; conversationId: string; userMessageId: number; mode: ChatMode }
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string }
  | { type: 'restart' }
  | { type: 'document'; requestId: string; kind: DocRef['kind']; title: string | null }
  | { type: 'done'; messageId: number | null; text: string; refusal: boolean; escalated: boolean; modeSuggestion: ChatMode | null }
  | { type: 'error'; code: string; message: string };

/** Sunucu turu başlamadan reddetti (4xx/5xx): kullanıcı mesajı kaydedilmedi; taslak geri yüklenir. */
export class ChatRejected extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ChatRejected';
  }
}

/** Oturumu kapanmış istek giriş sayfasına yönlenmiş mi (fetch yönlendirmeyi izler, HTML döner). */
function redirectedToLogin(res: Response): boolean {
  if (!res.redirected || !res.url) return false;
  try {
    return new URL(res.url, 'http://x').pathname === '/giris';
  } catch {
    return false;
  }
}

async function errorOf(res: Response): Promise<ChatRejected> {
  if (redirectedToLogin(res)) return new ChatRejected(CHAT_COPY.sessionExpired, 'unauthenticated');
  try {
    const j = (await res.json()) as { error?: { code?: string; message?: string } };
    return new ChatRejected(j.error?.message ?? CHAT_COPY.genericError, j.error?.code ?? `http_${res.status}`);
  } catch {
    return new ChatRejected(res.status === 401 ? CHAT_COPY.sessionExpired : CHAT_COPY.genericError, `http_${res.status}`);
  }
}

/** POST /api/chat → olaylar. Akış başlamadan hata `ChatRejected` fırlatır. */
export async function sendChat(input: SendInput, onEvent: (ev: ClientEvent) => void, fetchImpl: typeof fetch = fetch): Promise<void> {
  let res: Response;
  try {
    res = await fetchImpl('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ conversation_id: input.conversationId, text: input.text, upload_ids: input.uploadIds, mode: input.mode, seed: input.seed }),
    });
  } catch {
    throw new ChatRejected(CHAT_COPY.genericError, 'network');
  }
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !type.includes('text/event-stream') || !res.body) throw await errorOf(res);
  let finished = false;
  for await (const m of readSse(res.body)) {
    const ev = { type: m.event, ...(m.data as object) } as ClientEvent;
    if (ev.type === 'done' || ev.type === 'error') finished = true;
    onEvent(ev);
  }
  if (!finished) onEvent({ type: 'error', code: 'stream_closed', message: CHAT_COPY.genericError });
}

/** Ek yükleme: POST /api/chat/upload (multipart). */
export async function uploadAttachment(
  file: Blob,
  meta: { name: string; width: number | null; height: number | null },
  fetchImpl: typeof fetch = fetch,
): Promise<{ id: string; kind: 'photo' | 'pdf' }> {
  const fd = new FormData();
  fd.append('file', file, meta.name);
  if (meta.width) fd.append('width', String(meta.width));
  if (meta.height) fd.append('height', String(meta.height));
  let res: Response;
  try {
    res = await fetchImpl('/api/chat/upload', { method: 'POST', body: fd });
  } catch {
    throw new ChatRejected(CHAT_COPY.genericError, 'network');
  }
  if (!res.ok || redirectedToLogin(res)) throw await errorOf(res);
  return (await res.json()) as { id: string; kind: 'photo' | 'pdf' };
}
