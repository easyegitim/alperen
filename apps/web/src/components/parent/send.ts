import { PARENT_COPY } from '@/lib/parent';
import { readSse } from '@/components/chat/sse-client';

export interface ParentSendInput {
  studentId: string;
  conversationId: string | null;
  text: string;
}

export type ParentClientEvent =
  | { type: 'start'; conversationId: string; userMessageId: number }
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string }
  | { type: 'restart' }
  | { type: 'report'; documentId: string; title: string; kind: string }
  | { type: 'done'; messageId: number | null; text: string; refusal: boolean }
  | { type: 'error'; code: string; message: string };

/** Sunucu turu başlamadan reddetti (4xx/5xx): mesaj kaydedilmedi; taslak geri yüklenir. */
export class ParentRejected extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ParentRejected';
  }
}

async function errorOf(res: Response): Promise<ParentRejected> {
  if (res.redirected && res.url && new URL(res.url, 'http://x').pathname === '/giris') return new ParentRejected(PARENT_COPY.chatSession, 'unauthenticated');
  try {
    const j = (await res.json()) as { error?: { code?: string; message?: string } };
    return new ParentRejected(j.error?.message ?? PARENT_COPY.chatError, j.error?.code ?? `http_${res.status}`);
  } catch {
    return new ParentRejected(res.status === 401 ? PARENT_COPY.chatSession : PARENT_COPY.chatError, `http_${res.status}`);
  }
}

/** POST /api/parent-chat (veli ajanı, P6-B) → olaylar. Akış başlamadan hata `ParentRejected` fırlatır. */
export async function sendParentChat(input: ParentSendInput, onEvent: (ev: ParentClientEvent) => void, fetchImpl: typeof fetch = fetch): Promise<void> {
  let res: Response;
  try {
    res = await fetchImpl('/api/parent-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ student_id: input.studentId, conversation_id: input.conversationId, text: input.text }),
    });
  } catch {
    throw new ParentRejected(PARENT_COPY.chatError, 'network');
  }
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !type.includes('text/event-stream') || !res.body) throw await errorOf(res);
  let finished = false;
  for await (const m of readSse(res.body)) {
    const ev = { type: m.event, ...(m.data as object) } as ParentClientEvent;
    if (ev.type === 'done' || ev.type === 'error') finished = true;
    onEvent(ev);
  }
  if (!finished) onEvent({ type: 'error', code: 'stream_closed', message: PARENT_COPY.chatError });
}
