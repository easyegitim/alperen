/**
 * İnce Bot API istemcisi (çerçeve yok): fetch + 2 deneme + 429'da `retry_after` kadar bekleme.
 * 5xx/zaman aşımı iki denemede de düşerse `null` döner (BLUEPRINT §5.12: cevap gönderilemedi,
 * `out_telegram_message_id` boş kalır).
 */
import type { TgChatMember, TgMe, TgReplyMarkup, TgSentMessage } from './types.ts';

export type FetchFn = (input: Request | string | URL, init?: RequestInit) => Promise<Response>;

export interface TelegramClientOptions {
  base: string;
  token: string;
  fetch: FetchFn;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

export class TelegramApiError extends Error {
  readonly status: number;
  readonly description: string;
  constructor(status: number, description: string) {
    super(`Telegram ${status}: ${description}`);
    this.status = status;
    this.description = description;
  }
}

export interface SendOptions {
  reply_markup?: TgReplyMarkup;
  reply_to_message_id?: number;
  parse_mode?: 'MarkdownV2';
  disable_notification?: boolean;
}

interface ApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

const MAX_RETRY_WAIT_MS = 5_000;

/**
 * Hata metni loglanmadan önce: bazı çalışma zamanları fetch hatasına isteğin URL'sini koyar; URL yolunda
 * bot jetonu vardır (`/bot<token>/`). Yalnız hata adı + jetonu maskelenmiş ileti loglanır.
 */
export function redactError(err: unknown): string {
  const name = err instanceof Error ? err.name : 'Error';
  const message = err instanceof Error ? err.message : String(err);
  return `${name}: ${message.replace(/\/bot[^/\s]+/g, '/bot***')}`.slice(0, 200);
}

export class TelegramClient {
  private readonly opts: Required<Omit<TelegramClientOptions, 'sleep'>> & { sleep: (ms: number) => Promise<void> };

  constructor(opts: TelegramClientOptions) {
    this.opts = {
      base: opts.base.replace(/\/+$/, ''),
      token: opts.token,
      fetch: opts.fetch,
      timeoutMs: opts.timeoutMs ?? 10_000,
      sleep: opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    };
  }

  /** Ham çağrı: 2 deneme; 4xx (429 hariç) hemen fırlatır; 5xx/ağ hatası iki denemede düşerse null. */
  async call<T>(method: string, params: Record<string, unknown>): Promise<T | null> {
    const url = `${this.opts.base}/bot${this.opts.token}/${method}`;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try {
        res = await this.opts.fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(params),
          signal: AbortSignal.timeout(this.opts.timeoutMs),
        });
      } catch (err) {
        lastError = err;
        continue;
      }
      let body: ApiResponse<T>;
      try {
        body = (await res.json()) as ApiResponse<T>;
      } catch {
        body = { ok: false, description: 'yanıt JSON değil' };
      }
      if (res.ok && body.ok) return (body.result ?? null) as T | null;
      if (res.status === 429) {
        const wait = Math.min((body.parameters?.retry_after ?? 1) * 1000, MAX_RETRY_WAIT_MS);
        await this.opts.sleep(wait);
        lastError = new TelegramApiError(429, body.description ?? 'Too Many Requests');
        continue;
      }
      if (res.status >= 500) {
        lastError = new TelegramApiError(res.status, body.description ?? 'sunucu hatası');
        continue;
      }
      throw new TelegramApiError(res.status, body.description ?? 'istek reddedildi');
    }
    console.warn(JSON.stringify({ lvl: 'warn', evt: 'telegram_failed', method, err: redactError(lastError) }));
    return null;
  }

  sendMessage(chatId: number, text: string, opts: SendOptions = {}): Promise<TgSentMessage | null> {
    return this.call<TgSentMessage>('sendMessage', { chat_id: chatId, text, ...opts });
  }

  sendPhoto(chatId: number, photo: string, caption: string, opts: SendOptions = {}): Promise<TgSentMessage | null> {
    return this.call<TgSentMessage>('sendPhoto', { chat_id: chatId, photo, caption, ...opts });
  }

  editMessageReplyMarkup(chatId: number, messageId: number, markup: TgReplyMarkup): Promise<unknown> {
    return this.call('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: markup });
  }

  answerCallbackQuery(id: string, text?: string): Promise<unknown> {
    return this.call('answerCallbackQuery', text === undefined ? { callback_query_id: id } : { callback_query_id: id, text });
  }

  pinChatMessage(chatId: number, messageId: number): Promise<unknown> {
    return this.call('pinChatMessage', { chat_id: chatId, message_id: messageId, disable_notification: true });
  }

  unpinChatMessage(chatId: number, messageId: number): Promise<unknown> {
    return this.call('unpinChatMessage', { chat_id: chatId, message_id: messageId });
  }

  getChat(chatId: number): Promise<unknown> {
    return this.call('getChat', { chat_id: chatId });
  }

  getChatMember(chatId: number, userId: number): Promise<TgChatMember | null> {
    return this.call<TgChatMember>('getChatMember', { chat_id: chatId, user_id: userId });
  }

  getMe(): Promise<TgMe | null> {
    return this.call<TgMe>('getMe', {});
  }

  setWebhook(url: string, secretToken: string, allowedUpdates: string[]): Promise<unknown> {
    return this.call('setWebhook', { url, secret_token: secretToken, allowed_updates: allowedUpdates });
  }

  sendChatAction(chatId: number, action: 'typing' = 'typing'): Promise<unknown> {
    return this.call('sendChatAction', { chat_id: chatId, action });
  }
}
