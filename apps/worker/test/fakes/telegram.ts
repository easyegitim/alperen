/**
 * Sahte Bot API: `fetch` uyumlu işleyici (`/bot<token>/<method>`). Giden her çağrı `outbox`'a yazılır;
 * mesaj kimlikleri sohbet başına artar. getMe / getChatMember yanıtları fixtures/telegram/api'den.
 * Testler gerçek `TelegramClient`'ı bu `fetch` ile kullanır (istemcinin kendisi de sınanır).
 */
export interface OutboxItem {
  method: string;
  params: Record<string, unknown>;
  message_id: number | null;
}

/** MarkdownV2 kaçışlarını geri alır ve iç işaretlemeyi (*kalın*, `kod`) atar. */
export function unescapeV2(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? '';
    if (c === '\\' && i + 1 < text.length) {
      out += text[i + 1];
      i++;
      continue;
    }
    if (c === '*' || c === '`') continue;
    out += c;
  }
  return out;
}

export class FakeTelegram {
  readonly outbox: OutboxItem[] = [];
  me: Record<string, unknown>;
  chatMember: Record<string, unknown>;
  /** Sonraki N çağrı bu durumla düşer (ör. [500, 500]). */
  failNext: number[] = [];
  private nextId = new Map<number, number>();

  constructor(opts: { me: Record<string, unknown>; chatMember: Record<string, unknown> }) {
    this.me = opts.me;
    this.chatMember = opts.chatMember;
  }

  readonly fetch = async (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = /\/bot[^/]+\/(\w+)$/.exec(new URL(url).pathname)?.[1] ?? 'unknown';
    const raw = init?.body ?? (input instanceof Request ? await input.text() : '{}');
    const params = JSON.parse(typeof raw === 'string' ? raw : '{}') as Record<string, unknown>;
    const fail = this.failNext.shift();
    if (fail !== undefined) {
      this.outbox.push({ method, params, message_id: null });
      return Response.json({ ok: false, error_code: fail, description: 'sahte hata', parameters: fail === 429 ? { retry_after: 0 } : undefined }, { status: fail });
    }
    const result = this.handle(method, params);
    return Response.json({ ok: true, result });
  };

  private handle(method: string, params: Record<string, unknown>): unknown {
    const chatId = Number(params.chat_id ?? 0);
    switch (method) {
      case 'sendMessage':
      case 'sendPhoto': {
        const id = (this.nextId.get(chatId) ?? 5000) + 1;
        this.nextId.set(chatId, id);
        this.outbox.push({ method, params, message_id: id });
        return { message_id: id, chat: { id: chatId, type: chatId > 0 ? 'private' : 'supergroup' }, date: 1792512000 };
      }
      case 'getMe':
        this.outbox.push({ method, params, message_id: null });
        return this.me;
      case 'getChatMember':
        this.outbox.push({ method, params, message_id: null });
        return this.chatMember;
      default:
        this.outbox.push({ method, params, message_id: null });
        return true;
    }
  }

  calls(method: string): OutboxItem[] {
    return this.outbox.filter((o) => o.method === method);
  }

  /** Bir sohbete giden metinler (sendMessage metni / sendPhoto altyazısı), kaçışsız. */
  textsTo(chatId: number): string[] {
    return this.outbox
      .filter((o) => (o.method === 'sendMessage' || o.method === 'sendPhoto') && Number(o.params.chat_id) === chatId)
      .map((o) => unescapeV2(String(o.method === 'sendPhoto' ? o.params.caption : o.params.text)));
  }

  lastTo(chatId: number): OutboxItem | undefined {
    return this.outbox.filter((o) => (o.method === 'sendMessage' || o.method === 'sendPhoto') && Number(o.params.chat_id) === chatId).at(-1);
  }

  clear(): void {
    this.outbox.length = 0;
  }
}
