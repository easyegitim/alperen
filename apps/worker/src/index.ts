/**
 * Worker girişi: yalnız GERÇEK bağımlılıkları bağlar (PostgREST, Bot API, sağlayıcılar, Storage).
 * Sahte mod (`ADAPTERS=fake`, `DB=fake`) yalnız `test/fakes/dev-worker.ts` girişindedir: fixtures ve
 * sahte cevap anahtarı kapısı üretim paketine girmez.
 */
import { createApp, type App, type ExecCtx } from './app.ts';
import { ConfigError, loadConfig, type Env } from './env.ts';
import type { Deps } from './services.ts';
import { TelegramClient } from './telegram/client.ts';
import { PostgrestDb } from './data/postgrest.ts';
import { SupabaseStorage } from './data/storage.ts';
import { embedderFromChain } from './data/embeddings.ts';
import { buildProviders } from './llm/providers/registry.ts';
import { log } from './ops/log.ts';

export function realDeps(env: Env): Deps {
  const cfg = loadConfig(env);
  if (cfg.adaptersFake || cfg.dbFake) throw new ConfigError('OGR-ENV-003', 'sahte mod yalnız test/fakes/dev-worker.ts girişinde (bun run dev:fake)');
  const f = (input: Request | string | URL, init?: RequestInit): Promise<Response> => fetch(input, init);
  const clock = { now: () => new Date() };
  return {
    telegram: new TelegramClient({ base: cfg.telegramApiBase, token: cfg.telegramToken, fetch: f }),
    db: new PostgrestDb({ url: cfg.supabaseUrl, anonKey: cfg.supabaseAnonKey, botJwt: cfg.botJwt, fetch: f, clock }),
    llm: buildProviders(env, f),
    embed: embedderFromChain(env, f),
    storage: new SupabaseStorage({ url: cfg.supabaseUrl, anonKey: cfg.supabaseAnonKey, botJwt: cfg.botJwt, fetch: f }),
    clock,
    random: Math.random,
  };
}

let cached: { env: Env; app: App } | null = null;

function appFor(env: Env): App {
  if (cached !== null && cached.env === env) return cached.app;
  const app = createApp(env, realDeps(env));
  cached = { env, app };
  return app;
}

let bootErrorLogged = false;

/**
 * Yapılandırma hatasında bile Telegram webhook'u 200 alır (§5.1: yeniden teslimat fırtınası olmaz);
 * `/health` 503 döner ki izleme sorunu görsün. Hata bir kez loglanır.
 */
export function bootFailureResponse(request: Request, err: unknown): Response {
  if (bootErrorLogged === false) {
    log.error('boot_failed', { err: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
    bootErrorLogged = true;
  }
  const path = new URL(request.url).pathname;
  if (request.method === 'POST' && path.startsWith('/telegram/')) return new Response('ok', { status: 200 });
  if (path === '/health') return new Response(JSON.stringify({ ok: false, error: 'config' }), { status: 503, headers: { 'content-type': 'application/json' } });
  return new Response('Yapılandırma hatası', { status: 500 });
}

export default {
  async fetch(request: Request, env: Env, ctx?: ExecCtx): Promise<Response> {
    let app: App;
    try {
      app = appFor(env);
    } catch (err) {
      return bootFailureResponse(request, err);
    }
    return app.fetch(request, ctx);
  },
  async scheduled(event: { cron: string; scheduledTime: number }, env: Env, ctx: ExecCtx): Promise<void> {
    ctx.waitUntil(appFor(env).runCron(event.cron, new Date(event.scheduledTime)));
  },
};
