/**
 * Sunucu gönderimli olaylar (text/event-stream): `event: <tür>\ndata: <json>\n\n`. İstemci ayrıştırıcısı
 * `src/components/chat/sse-client.ts`'tedir (aynı biçim).
 */
import type { ChatEvent } from './turn';

export function encodeEvent(ev: ChatEvent): string {
  const { type, ...data } = ev;
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Turu akışa çevirir: `run(emit)` bitince akış kapanır. */
export function eventStream(run: (emit: (ev: ChatEvent) => void) => Promise<void>): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const emit = (ev: ChatEvent) => {
        if (!open) return;
        try {
          controller.enqueue(enc.encode(encodeEvent(ev)));
        } catch {
          open = false; // istemci ayrıldı
        }
      };
      try {
        await run(emit);
      } finally {
        if (open) {
          open = false;
          try {
            controller.close();
          } catch {
            /* zaten kapalı */
          }
        }
      }
    },
  });
}

export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-store, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;
