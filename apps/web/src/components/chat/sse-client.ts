/** text/event-stream ayrıştırıcısı (sunucu biçimi: src/server/chat/sse.ts). */

export interface SseMessage {
  event: string;
  data: unknown;
}

/** Bir metin parçası kuyruğundan tam olayları ayırır; kalan yarım parça `rest` olarak döner. */
export function parseSseChunk(buffer: string): { events: SseMessage[]; rest: string } {
  const events: SseMessage[] = [];
  const normalized = buffer.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n\n');
  const rest = parts.pop() ?? '';
  for (const part of parts) {
    let event = 'message';
    const data: string[] = [];
    for (const line of part.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (data.length === 0) continue;
    try {
      events.push({ event, data: JSON.parse(data.join('\n')) });
    } catch {
      events.push({ event, data: data.join('\n') });
    }
  }
  return { events, rest };
}

/** Yanıt gövdesini olay olay okur. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const { events, rest } = parseSseChunk(buf);
      buf = rest;
      for (const e of events) yield e;
    }
    buf += dec.decode();
    const { events } = parseSseChunk(`${buf}\n\n`);
    for (const e of events) yield e;
  } finally {
    reader.releaseLock();
  }
}
