/**
 * `dev:fake` Worker girişi (wrangler dev --local, test/fakes/wrangler.dev.toml): tüm bağımlılıklar sahte.
 * FakeDb fixtures/db/dev-seed.json'dan, sahte LLM yanıtları sahte Bot API sunucusunun
 * `/__fixtures/llm` ucundan (fixtures/llm; esbuild dizin taraması yapamadığı için) bir kez yüklenir.
 * Üretim paketi (src/index.ts) bu dosyayı ve FakeDb'yi hiç içe almaz.
 *
 * Deterministik: saat gerçek saat değildir — `DEV_NOW` (varsayılan fixtures "şimdi" 2026-10-20T16:00:00Z)
 * ile başlar, her webhook isteğinde 5 sn, her cron olayında 15 dk ilerler; rastgelelik `seededRandom(7)`.
 * Aynı istek dizisi → aynı çıktı.
 */
import seedJson from '../../../../fixtures/db/dev-seed.json';
import { createApp, type App } from '../../src/app.ts';
import { FakeDb } from '../../src/data/fake.ts';
import type { Env } from '../../src/env.ts';
import { TelegramClient } from '../../src/telegram/client.ts';
import { seededRandom } from '../../src/util.ts';
import { fakeEmbedder } from './embed.ts';
import { SeedAnswerOracle } from './key-oracle.ts';
import { FakeLlm, fakeProviders, type LlmFixtures } from './providers.ts';
import { FakeStorage } from './storage.ts';

let app: App | null = null;

export const DEV_NOW = '2026-10-20T16:00:00Z';
const STEP_PER_UPDATE_MS = 5_000;
const STEP_PER_CRON_MS = 15 * 60_000;

/** Elle ilerleyen saat (gerçek saate bağlı değil). */
export class DevClock {
  private t: number;
  constructor(iso: string) {
    this.t = Date.parse(iso);
  }
  now = (): Date => new Date(this.t);
  advance(ms: number): void {
    this.t += ms;
  }
}

let clock: DevClock | null = null;

async function boot(env: Env): Promise<App> {
  if (app !== null) return app;
  const base = String(env.TELEGRAM_API_BASE ?? 'http://localhost:8788');
  const fixtures = (await (await fetch(`${base}/__fixtures/llm`)).json()) as LlmFixtures;
  const seed = structuredClone(seedJson) as unknown as Record<string, unknown>;
  const start = typeof env.DEV_NOW === 'string' && Number.isFinite(Date.parse(env.DEV_NOW)) ? env.DEV_NOW : DEV_NOW;
  const devClock = new DevClock(start);
  clock = devClock;
  const random = seededRandom(7);
  const f = (input: Request | string | URL, init?: RequestInit): Promise<Response> => fetch(input, init);
  app = createApp(env, {
    telegram: new TelegramClient({ base, token: String(env.TELEGRAM_BOT_TOKEN ?? ''), fetch: f }),
    db: new FakeDb(seed, { clock: devClock, random, oracle: new SeedAnswerOracle(seed) }),
    llm: fakeProviders(new FakeLlm(fixtures)),
    embed: fakeEmbedder(),
    storage: new FakeStorage(),
    clock: devClock,
    random,
  });
  return app;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const a = await boot(env);
    if (request.method === 'POST') clock?.advance(STEP_PER_UPDATE_MS);
    return a.fetch(request);
  },
  async scheduled(event: { cron: string }, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
    const a = await boot(env);
    clock?.advance(STEP_PER_CRON_MS);
    ctx.waitUntil(a.runCron(event.cron));
  },
};
