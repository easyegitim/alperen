/**
 * makeApp({now, random, seed}) → { app, telegram, db, llm, storage, oracle, clock }.
 * Tüm dış servisler sahte; ağ yok. Seed `fixtures/db/dev-seed.json` (M01'in verisi, salt okunur).
 */
import seedJson from '../../../fixtures/db/dev-seed.json';
import getMePrivacyOff from '../../../fixtures/telegram/api/getMe.privacy_off.json';
import chatMemberAdmin from '../../../fixtures/telegram/api/getChatMember.administrator.json';
import { createApp, type App } from '../src/app.ts';
import { FakeDb } from '../src/data/fake.ts';
import { TelegramClient } from '../src/telegram/client.ts';
import type { TgUpdate } from '../src/telegram/types.ts';
import { seededRandom } from '../src/util.ts';
import { fakeEmbedder } from './fakes/embed.ts';
import { SeedAnswerOracle } from './fakes/key-oracle.ts';
import { loadLlmFixtures } from './fakes/llm-fixtures.ts';
import { FakeLlm, fakeProviders, type FakeLlmOptions } from './fakes/providers.ts';
import { FakeStorage } from './fakes/storage.ts';
import { FakeTelegram } from './fakes/telegram.ts';

const fixtureModules = import.meta.glob('../../../fixtures/telegram/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

/** fixtures/telegram/<ad>.json güncellemesinin derin kopyası. */
export function fx(name: string): TgUpdate {
  const key = Object.keys(fixtureModules).find((k) => k.endsWith(`/telegram/${name}.json`));
  if (key === undefined) throw new Error(`fixture yok: ${name}`);
  return structuredClone(fixtureModules[key]) as TgUpdate;
}

export const SEED = seedJson as unknown as Record<string, unknown>;

export const ENV = {
  TELEGRAM_BOT_TOKEN: 'test-token',
  TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret',
  WEBHOOK_SECRET_PATH: 'test-secret-path',
  ADAPTERS: 'fake',
  DB: 'fake',
  ADMIN_CHAT_ID: '999000',
  PROMPT_VERSION_CHAT: 'socratic.v3',
  TELEGRAM_API_BASE: 'http://fake-telegram',
  PUBLIC_ENV: 'test',
  LOG_LEVEL: 'warn',
};

/** Dünya: fixtures README "şimdi" 2026-10-20; sohbet senaryoları 16:00Z (19:00 İstanbul, aktif saat). */
export const DEFAULT_NOW = '2026-10-20T16:00:00Z';

export const IDS = {
  elif: 'c661b28c-81a8-5c11-9a5e-b919b5231034',
  mert: '1da926ea-a047-5403-9644-bb047719707b',
  zeynep: '9d4d557b-6191-5018-b679-baf9dbacc67e',
  elifEnrollment: '8bef16e2-1fb1-56d1-9530-3cd5b1ea7cf3',
  mertEnrollment: '1899cde6-c497-5b14-8051-882f44649013',
  ayse: 'de70e65e-1410-5026-a773-c5e55a3e6368',
  selin: '91c9e333-16a1-55c8-8bcf-1a6c6f3dc529',
  groupA: -1001000000001,
  elifChat: 700000001,
  mertChat: 700000002,
  zeynepChat: 700000003,
  canChat: 700000004,
  admin: 999000,
};

export class MutableClock {
  private t: number;
  constructor(iso: string) {
    this.t = Date.parse(iso);
  }
  now = (): Date => new Date(this.t);
  set(iso: string): void {
    this.t = Date.parse(iso);
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

export interface TestWorld {
  app: App;
  telegram: FakeTelegram;
  db: FakeDb;
  llm: FakeLlm;
  storage: FakeStorage;
  oracle: SeedAnswerOracle;
  clock: MutableClock;
  embedCalls: string[];
  /** Güncellemeyi gerçek webhook yolundan (doğru gizli yol + başlık) gönderir. */
  send(update: TgUpdate): Promise<Response>;
  /** Benzersiz update_id ile özel sohbet metni. */
  privateText(chatId: number, text: string, opts?: { messageId?: number; username?: string; firstName?: string; lastName?: string }): TgUpdate;
  callback(chatId: number, data: string, messageId?: number): TgUpdate;
}

export interface MakeAppOptions {
  now?: string;
  seed?: number;
  llm?: FakeLlmOptions;
  mutateSeed?: (seed: Record<string, unknown>) => void;
  env?: Record<string, string>;
}

let updateSeq = 990_000_000;

export function makeApp(o: MakeAppOptions = {}): TestWorld {
  const seed = structuredClone(SEED);
  o.mutateSeed?.(seed);
  const clock = new MutableClock(o.now ?? DEFAULT_NOW);
  const random = seededRandom(o.seed ?? 7);
  const oracle = new SeedAnswerOracle(seed);
  const db = new FakeDb(seed, { clock, random, oracle });
  const telegram = new FakeTelegram({ me: structuredClone((getMePrivacyOff as { result: Record<string, unknown> }).result), chatMember: structuredClone((chatMemberAdmin as { result: Record<string, unknown> }).result) });
  const llm = new FakeLlm(loadLlmFixtures(), o.llm ?? {});
  const storage = new FakeStorage();
  const embedCalls: string[] = [];
  const env = { ...ENV, ...(o.env ?? {}) };
  const app = createApp(env, {
    telegram: new TelegramClient({ base: env.TELEGRAM_API_BASE, token: env.TELEGRAM_BOT_TOKEN, fetch: telegram.fetch, sleep: async () => undefined }),
    db,
    llm: fakeProviders(llm),
    embed: fakeEmbedder(embedCalls),
    storage,
    clock,
    random,
  });
  let msgSeq = 7000;
  return {
    app,
    telegram,
    db,
    llm,
    storage,
    oracle,
    clock,
    embedCalls,
    send: (update) =>
      app.fetch(
        new Request(`https://bot.example/telegram/${env.WEBHOOK_SECRET_PATH}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': env.TELEGRAM_WEBHOOK_SECRET },
          body: JSON.stringify(update),
        }),
      ),
    privateText: (chatId, text, opts = {}) => ({
      update_id: ++updateSeq,
      message: {
        message_id: opts.messageId ?? ++msgSeq,
        from: { id: chatId, is_bot: false, first_name: opts.firstName ?? 'Elif', last_name: opts.lastName ?? 'Kaya', username: opts.username ?? 'elif_k' },
        chat: { id: chatId, type: 'private' },
        date: Math.floor(clock.now().getTime() / 1000),
        text,
        ...(text.startsWith('/') ? { entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0]?.length ?? 1 }] } : {}),
      },
    }),
    callback: (chatId, data, messageId = 5001) => ({
      update_id: ++updateSeq,
      callback_query: {
        id: `cb-${updateSeq}`,
        from: { id: chatId, is_bot: false },
        data,
        message: { message_id: messageId, chat: { id: chatId, type: 'private' }, date: Math.floor(clock.now().getTime() / 1000) },
      },
    }),
  };
}

/** Yeni update_id ile kopya (dedup'a takılmadan aynı fixture'ı yeniden göndermek için). */
export function fresh(u: TgUpdate): TgUpdate {
  return { ...structuredClone(u), update_id: ++updateSeq };
}

/** Bir öğrencinin gruptaki mesajı (benzersiz kimliklerle). */
export function groupText(chatId: number, from: { id: number; username: string }, text: string, extra: Record<string, unknown> = {}, date = 1792512600): TgUpdate {
  return {
    update_id: ++updateSeq,
    message: {
      message_id: 80_000 + (updateSeq % 10_000),
      from: { id: from.id, is_bot: false, username: from.username },
      chat: { id: chatId, type: 'supergroup', title: 'TYT Matematik · Pilot A' },
      date,
      text,
      ...extra,
    },
  } as TgUpdate;
}

/** Son klavyeli mesajın callback_data değerleri. */
export function lastKeyboard(w: TestWorld, chatId: number): string[] {
  const item = [...w.telegram.outbox].reverse().find((o) => (o.method === 'sendMessage' || o.method === 'sendPhoto') && Number(o.params.chat_id) === chatId && o.params.reply_markup !== undefined);
  const markup = item?.params.reply_markup as { inline_keyboard: Array<Array<{ callback_data?: string }>> } | undefined;
  return (markup?.inline_keyboard ?? []).flat().map((b) => b.callback_data ?? '');
}

/** Konsol çıktısını yakalar (scrub-integration: loglarda ad yok). */
export function captureConsole(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  for (const k of ['log', 'warn', 'error'] as const) console[k] = (...args: unknown[]) => lines.push(args.map(String).join(' '));
  return { lines, restore: () => Object.assign(console, orig) };
}

export type Row = Record<string, unknown>;
export function rows(w: TestWorld, table: string, pred: (r: Row) => boolean = () => true): Row[] {
  return w.db.table(table).filter(pred);
}
