/**
 * createApp(env, deps): tüm iş mantığı bu saf fonksiyondadır; `index.ts` yalnız gerçek bağımlılıkları
 * bağlar. Böylece testler Workers çalışma zamanında (miniflare) ve düz Node'da aynı kodu koşar.
 *
 * - `POST /telegram/<WEBHOOK_SECRET_PATH>` + `X-Telegram-Bot-Api-Secret-Token`: yanlışsa 404, gövde okunmaz.
 * - Gövde > 64 KB → 200 + log (işlenmez). Her durumda Telegram'a 200 (yeniden teslimat fırtınası olmaz).
 * - `GET /health` → {ok, version, prompt_version, bot_jwt_days_left, db}.
 */
import { loadConfig, type Env } from './env.ts';
import { checkHealth } from './ops/health.ts';
import { Services, type Deps } from './services.ts';
import { dispatch } from './router/dispatch.ts';
import { verifyWebhook } from './telegram/verify.ts';
import type { TgUpdate } from './telegram/types.ts';
import { runCron } from './cron/index.ts';
import { log, setLogLevel } from './ops/log.ts';
import { texts } from './texts.ts';
import { toMarkdownV2 } from './telegram/format.ts';

export const MAX_BODY_BYTES = 64 * 1024;
export const UPDATE_BUDGET_MS = 25_000;

/** Workers `ExecutionContext` alt kümesi: yanıt döndükten sonra sürecek iş. */
export interface ExecCtx {
  waitUntil(p: Promise<unknown>): void;
}

export interface App {
  services: Services;
  fetch(request: Request, exec?: ExecCtx): Promise<Response>;
  handleUpdate(update: TgUpdate): Promise<void>;
  runCron(cron: string, now?: Date): Promise<void>;
  health(): Promise<Record<string, unknown>>;
}

const OK = (): Response => new Response('ok', { status: 200 });
const NOT_FOUND = (): Response => new Response('Not Found', { status: 404 });

export function createApp(env: Env, deps: Deps): App {
  const cfg = loadConfig(env);
  setLogLevel(typeof env.LOG_LEVEL === 'string' ? env.LOG_LEVEL : 'info');
  const s = new Services(cfg, deps);

  async function handleUpdate(update: TgUpdate): Promise<void> {
    const started = Date.now();
    const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id ?? null;
    try {
      await dispatch(s, update);
    } catch (err) {
      log.error('update_failed', { chat: chatId ?? undefined, err: String(err) });
      if (chatId !== null && update.message?.chat.type === 'private') {
        await s.tg.sendMessage(chatId, toMarkdownV2(texts.degraded), { parse_mode: 'MarkdownV2' }).catch(() => null);
        await s.db.openEscalation(chatId, null, 'degraded', null).catch(() => undefined);
      }
    } finally {
      log.info('update', { chat: chatId ?? undefined, ms: Date.now() - started });
    }
  }

  async function health(): Promise<Record<string, unknown>> {
    // Yanıt biçimi §5.1: {ok, version, prompt_version, bot_jwt_days_left, db}; zincir durumu yalnız `ok`'a girer.
    const { chain: _chain, ...h } = await checkHealth(s);
    return h;
  }

  async function fetchHandler(request: Request, exec?: ExecCtx): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      const h = await health();
      return new Response(JSON.stringify(h), { status: h.ok === true ? 200 : 503, headers: { 'content-type': 'application/json' } });
    }
    if (url.pathname.startsWith('/telegram/') === false) return NOT_FOUND();
    if (verifyWebhook(request, cfg.webhookPath, cfg.webhookSecret) === false) return NOT_FOUND();
    const declared = Number(request.headers.get('content-length') ?? '0');
    if (declared > MAX_BODY_BYTES) {
      log.warn('body_too_large', { bytes: declared });
      return OK();
    }
    const body = await request.text();
    if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) {
      log.warn('body_too_large', { bytes: body.length });
      return OK();
    }
    let update: TgUpdate;
    try {
      update = JSON.parse(body) as TgUpdate;
    } catch {
      log.warn('body_not_json', {});
      return OK();
    }
    // 25 sn bütçesi dolarsa Telegram'a yine 200 döner; kalan iş (cevap, log_bot_response) waitUntil ile
    // yanıt sonrasında da sürer, çalışma zamanı onu iptal etmez.
    const work = handleUpdate(update);
    exec?.waitUntil(work);
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      work,
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          log.warn('update_budget_exceeded', { ms: UPDATE_BUDGET_MS });
          resolve();
        }, UPDATE_BUDGET_MS);
      }),
    ]);
    if (timer !== undefined) clearTimeout(timer);
    return OK();
  }

  return {
    services: s,
    fetch: fetchHandler,
    handleUpdate,
    health,
    runCron: (cron: string) => runCron(s, cron),
  };
}
