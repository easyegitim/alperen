/**
 * Uygulama servisleri: bağımlılıklar + istek ötesi önbellekler (ayarlar 5 dk, ad hash'leri 10 dk,
 * harcama 60 sn) + tek "cevap gönder" kapısı. Kural "kayıt yoksa cevap yok": her bot cevabı önce
 * `log_bot_response` ile yazılır (bot-response-log sözleşmesine karşı önceden derlenmiş doğrulayıcı),
 * sonra gönderilir, sonra `set_out_message`. Günlük yazılamazsa yalnız `texts.degraded` gider ve
 * `escalations(degraded)` denenir.
 */
import { isValid as contractValid, errors as contractErrors } from '@ogrenmen/contracts/validators';
import { scrub, totalReplacements, type RoleLabel } from '@ogrenmen/pii';
import type { AppConfig } from './env.ts';
import type { Db, BotPurpose, Mode, TgChatRow } from './data/repo.ts';
import type { StorageApi } from './data/storage.ts';
import type { Embedder } from './data/embeddings.ts';
import type { TelegramClient } from './telegram/client.ts';
import type { TgMe, TgReplyMarkup, TgSentMessage } from './telegram/types.ts';
import { toMarkdownV2 } from './telegram/format.ts';
import type { Provider } from './llm/providers/types.ts';
import type { ProviderAttempt } from './llm/router.ts';
import { SpendGate } from './ops/spend.ts';
import { log } from './ops/log.ts';
import { texts } from './texts.ts';

export interface Clock {
  now(): Date;
}

export interface Deps {
  telegram: TelegramClient;
  db: Db;
  /** Sağlayıcı kimliği → sağlayıcı (anahtarı olmayan sağlayıcı burada yoktur). */
  llm: ReadonlyMap<string, Provider>;
  embed: Embedder;
  storage: StorageApi;
  clock: Clock;
  random: () => number;
}

export interface LlmLogMeta {
  promptVersion: string;
  promptHash: string;
  promptText: string;
  provider: string | null;
  model: string | null;
  attempts: ProviderAttempt[];
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number;
  latencyMs: number;
  confidence: number | null;
  schemaValid: boolean | null;
  memoryFactIds: number[];
  recentMessageIds: number[];
  guards: string[];
}

export interface ReplyOptions {
  chatId: number;
  db: Db;
  purpose: BotPurpose;
  texts: string[];
  keyboard?: TgReplyMarkup;
  replyTo?: number | null;
  inMessageId?: number | null;
  mode?: Mode | null;
  llm?: LlmLogMeta;
  poolId?: string | null;
  cacheHit?: boolean;
  degraded?: boolean;
  escalated?: boolean;
  piiReplacements?: number;
  quota?: { used: number; limit: number } | null;
  /** Şekil: `part` hangi metin parçasının fotoğraf altyazısı olacağı (varsayılan 0). */
  photo?: { url: string; part?: number } | null;
  /** Bot cevabını `messages`'a da yaz (sohbet bağlamı ve "cevaplandı" işareti için); `attachments` yalnız meta (ör. pratik set kimliği). */
  store?: { studentId: string | null; attachments?: Array<Record<string, unknown>> } | null;
  /**
   * LLM'siz yolların kural etiketleri (`forbidden_topic`, `consent_missing`, `quota` …); LLM
   * meta verisindeki `guards` ile birleştirilip `bot_responses.guards`'a yazılır.
   */
  guards?: readonly string[];
}

export interface ReplyResult {
  responseId: number | null;
  sent: TgSentMessage[];
  logged: boolean;
}

const SETTINGS_TTL_MS = 5 * 60_000;
const FLAGS_TTL_MS = 60_000;
const HASHES_TTL_MS = 10 * 60_000;

export class Services {
  readonly spend: SpendGate;
  private settingsCache: { at: number; v: Record<string, unknown> } | null = null;
  private flagsCache: { at: number; v: Record<string, unknown> } | null = null;
  private hashCache = new Map<number, { at: number; v: string[] }>();
  private skillCache = new Map<string, { ids: Set<string>; names: Map<string, string> }>();
  private me: TgMe | null = null;

  constructor(
    readonly cfg: AppConfig,
    readonly deps: Deps,
  ) {
    this.spend = new SpendGate(() => deps.clock.now());
  }

  get db(): Db {
    return this.deps.db;
  }
  get tg(): TelegramClient {
    return this.deps.telegram;
  }
  now(): Date {
    return this.deps.clock.now();
  }

  async settings(): Promise<Record<string, unknown>> {
    const t = this.now().getTime();
    if (this.settingsCache && t - this.settingsCache.at < SETTINGS_TTL_MS) return this.settingsCache.v;
    const v = await this.db.settings();
    this.settingsCache = { at: t, v };
    return v;
  }

  async setting(key: string, fallback: number): Promise<number> {
    const v = (await this.settings())[key];
    return typeof v === 'number' ? v : fallback;
  }

  async flags(): Promise<Record<string, unknown>> {
    const t = this.now().getTime();
    if (this.flagsCache && t - this.flagsCache.at < FLAGS_TTL_MS) return this.flagsCache.v;
    const v = await this.db.runtimeFlags();
    this.flagsCache = { at: t, v };
    return v;
  }

  invalidateFlags(): void {
    this.flagsCache = null;
  }

  /** Sohbet üyelerinin ad-token hash'leri (öğrenci + personel; düz ad hiç gelmez). */
  async nameHashes(chatId: number): Promise<string[]> {
    const t = this.now().getTime();
    const hit = this.hashCache.get(chatId);
    if (hit && t - hit.at < HASHES_TTL_MS) return hit.v;
    const v = await this.db.nameTokenHashes(chatId);
    this.hashCache.set(chatId, { at: t, v });
    return v;
  }

  invalidateHashes(chatId: number): void {
    this.hashCache.delete(chatId);
  }

  /** PII temizliği: LLM'e, `text_llm`'e ve prompt kaydına giden tek yol. */
  async scrubFor(chatId: number, text: string, roleHashes: Readonly<Record<string, RoleLabel>> = {}): Promise<{ text: string; replacements: number }> {
    const r = scrub(text, { nameHashes: await this.nameHashes(chatId), roleHashes });
    return { text: r.text, replacements: totalReplacements(r) };
  }

  async skills(curriculumId: string): Promise<{ ids: Set<string>; names: Map<string, string> }> {
    const hit = this.skillCache.get(curriculumId);
    if (hit) return hit;
    const rows = await this.db.curriculumSkills(curriculumId);
    const v = { ids: new Set(rows.map((r) => r.id)), names: new Map(rows.map((r) => [r.id, r.name])) };
    this.skillCache.set(curriculumId, v);
    return v;
  }

  async bot(): Promise<TgMe> {
    if (this.me) return this.me;
    const me = await this.tg.getMe();
    this.me = me ?? { id: 0, is_bot: true, username: 'ogrenmen_bot' };
    return this.me;
  }

  async chat(chatId: number): Promise<TgChatRow | null> {
    return this.db.getChat(chatId);
  }

  /** Tek cevap kapısı: günlük → gönderim → out_message (→ messages). */
  async reply(o: ReplyOptions): Promise<ReplyResult> {
    // Günlüğe giden metin de temizlenir (grupta @kullanıcı adı geçebilir; kullanıcı adı PII sayılır).
    const hashes = await this.nameHashes(o.chatId).catch(() => [] as string[]);
    const responseText = scrub(o.texts.join('\n\n'), { nameHashes: hashes }).text;
    const guards = [...new Set([...(o.guards ?? []), ...(o.llm?.guards ?? [])])];
    const payload: Record<string, unknown> = {
      schema_version: '1.0',
      in_message_id: o.inMessageId ?? null,
      chat_id: o.chatId,
      out_telegram_message_id: null,
      purpose: o.purpose,
      mode: o.mode ?? null,
      prompt_version: o.llm?.promptVersion ?? null,
      prompt_hash: o.llm?.promptHash ?? null,
      prompt_text: o.llm?.promptText ?? null,
      response_text: responseText,
      memory_fact_ids: o.llm?.memoryFactIds ?? [],
      recent_message_ids: o.llm?.recentMessageIds ?? [],
      pool_id: o.poolId ?? null,
      cache_hit: o.cacheHit === true,
      provider: o.llm?.provider ?? null,
      model: o.llm?.model ?? null,
      provider_attempts: o.llm?.attempts ?? [],
      tokens_in: o.llm?.tokensIn ?? null,
      tokens_out: o.llm?.tokensOut ?? null,
      cost_usd: o.llm?.costUsd ?? 0,
      latency_ms: Math.max(0, Math.round(o.llm?.latencyMs ?? 0)),
      confidence: o.llm?.confidence ?? null,
      escalated: o.escalated === true,
      schema_valid: o.llm?.schemaValid ?? null,
      degraded_mode: o.degraded === true,
      pii_replacements: o.piiReplacements ?? 0,
      ...(o.quota ? { quota_state: { used: o.quota.used, limit: o.quota.limit } } : {}),
      ...(guards.length > 0 ? { guards } : {}),
    };
    let responseId: number | null = null;
    try {
      if (contractValid('bot-response-log', payload) === false) {
        const issues = contractErrors('bot-response-log', payload).map((i) => `${i.path} ${i.message}`);
        throw new Error(`OGR-LOG-002 bot-response-log şemasına uymuyor: ${issues.join('; ')}`);
      }
      responseId = await o.db.logBotResponse(payload);
    } catch (err) {
      log.error('log_failed', { chat: o.chatId, err: String(err) });
      await this.sendRaw(o.chatId, [texts.degraded], undefined, o.replyTo ?? null, null);
      await this.db.openEscalation(o.chatId, o.inMessageId ?? null, 'degraded', null).catch(() => undefined);
      return { responseId: null, sent: [], logged: false };
    }
    const sent = await this.sendRaw(o.chatId, o.texts, o.keyboard, o.replyTo ?? null, o.photo ?? null);
    const first = sent[0];
    if (first && responseId !== null) await o.db.setOutMessage(responseId, first.message_id).catch(() => undefined);
    if (o.store && sent.length > 0) {
      for (let i = 0; i < sent.length; i++) {
        const msg = sent[i];
        const text = o.texts[i] ?? '';
        if (!msg) continue;
        const clean = scrub(text, { nameHashes: hashes }).text;
        await o.db
          .insertMessage(
            {
              chat_id: o.chatId,
              telegram_message_id: msg.message_id,
              sender_role: 'bot',
              student_id: o.store.studentId,
              staff_id: null,
              reply_to_telegram_message_id: o.replyTo ?? null,
              text_raw: text,
              text_llm: clean,
              attachments: o.store.attachments ?? [],
              mentions_bot: false,
              is_question: null,
              sent_at: this.now().toISOString(),
            },
            { returnId: false },
          )
          .catch((err: unknown) => log.warn('bot_message_store_failed', { chat: o.chatId, err: String(err) }));
      }
    }
    return { responseId, sent, logged: true };
  }

  /** Günlüksüz gönderim (yalnız `reply()` ve günlük yazılamadığında degraded metni için). */
  private async sendRaw(chatId: number, parts: string[], keyboard: TgReplyMarkup | undefined, replyTo: number | null, photo: { url: string; part?: number } | null): Promise<TgSentMessage[]> {
    const photoPart = Math.min(Math.max(0, photo?.part ?? 0), Math.max(0, parts.length - 1));
    const out: TgSentMessage[] = [];
    for (let i = 0; i < parts.length; i++) {
      const text = parts[i] ?? '';
      const last = i === parts.length - 1;
      const opts = {
        parse_mode: 'MarkdownV2' as const,
        ...(last && keyboard ? { reply_markup: keyboard } : {}),
        ...(i === 0 && replyTo !== null ? { reply_to_message_id: replyTo } : {}),
      };
      try {
        const msg = i === photoPart && photo ? await this.tg.sendPhoto(chatId, photo.url, toMarkdownV2(text), opts) : await this.tg.sendMessage(chatId, toMarkdownV2(text), opts);
        if (msg) out.push(msg);
      } catch (err) {
        log.warn('telegram_send_rejected', { chat: chatId, err: String(err) });
      }
    }
    return out;
  }

  /** Kurucuya DM (ADMIN_CHAT_ID); günlüksüz operasyon bildirimi, öğrenci verisi taşımaz. */
  async notifyAdmin(text: string): Promise<void> {
    if (this.cfg.adminChatId === null) return;
    await this.tg.sendMessage(this.cfg.adminChatId, toMarkdownV2(text), { parse_mode: 'MarkdownV2' }).catch(() => null);
  }
}
