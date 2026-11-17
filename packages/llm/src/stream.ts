/**
 * Akış: `messages.stream()` ham olaylarını uygulama olaylarına çevirir ve `finalMessage()` ile tam iletiyi döndürür
 * (claude-api typescript/claude-api/streaming.md). Thinking metni varsayılan `display: "omitted"` iken boştur;
 * boş thinking deltaları yayımlanmaz. Araç girdisi (eager_input_streaming) parça parça gelir.
 */
import type { BetaMessage, BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { LlmStream } from './client.js';

export type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; id: string; name: string; server: boolean }
  | { type: 'tool_input'; id: string; partial: string }
  | { type: 'tool_result'; id: string; name: string; isError: boolean }
  | { type: 'fallback'; from: string; to: string }
  /** Aynı tur yeniden başlıyor (max_tokens iki kat yeniden denemesi ya da onarım); arayüz taslağı temizler. */
  | { type: 'restart'; reason: 'max_tokens_retry' | 'repair' }
  | { type: 'message_stop'; stopReason: string | null };

export type StreamListener = (ev: StreamEvent) => void;

/** Ham akış olayını uygulama olayına çevirir (blok indeksinden araç kimliği izlenir). */
export function mapStreamEvent(ev: BetaRawMessageStreamEvent, blockIds: Map<number, string>): StreamEvent | null {
  switch (ev.type) {
    case 'content_block_start': {
      const b = ev.content_block;
      if (b.type === 'tool_use' || b.type === 'server_tool_use') {
        blockIds.set(ev.index, b.id);
        return { type: 'tool_use', id: b.id, name: b.name, server: b.type === 'server_tool_use' };
      }
      if (b.type === 'fallback') return { type: 'fallback', from: String(b.from.model), to: String(b.to.model) };
      return null;
    }
    case 'content_block_delta': {
      const d = ev.delta;
      if (d.type === 'text_delta') return d.text ? { type: 'text', text: d.text } : null;
      if (d.type === 'thinking_delta') return d.thinking ? { type: 'thinking', text: d.thinking } : null;
      if (d.type === 'input_json_delta') {
        const id = blockIds.get(ev.index);
        return id && d.partial_json ? { type: 'tool_input', id, partial: d.partial_json } : null;
      }
      return null;
    }
    case 'message_delta':
      return { type: 'message_stop', stopReason: ev.delta.stop_reason ?? null };
    default:
      return null;
  }
}

/**
 * Akışı sonuna kadar tüketir; olayları dinleyiciye iletir ve tam iletiyi döndürür.
 * Hem yineleme hem `finalMessage()` aynı try içinde: araç girdisi JSON'u çözülemezse hata buradan yükselir.
 */
export async function consumeStream(stream: LlmStream, onEvent?: StreamListener): Promise<BetaMessage> {
  const ids = new Map<number, string>();
  for await (const ev of stream) {
    if (!onEvent) continue;
    const mapped = mapStreamEvent(ev, ids);
    if (mapped) onEvent(mapped);
  }
  return stream.finalMessage();
}
