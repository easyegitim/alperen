/**
 * Sahte Bot API sunucusu (bun, `dev:fake`; BLUEPRINT §5.11). Ağ hesabı gerekmez.
 *
 *   POST /bot<token>/<method>   Worker'ın Bot API çağrıları → outbox (sendMessage, pinChatMessage …)
 *   POST /sendUpdate            gövdedeki Update'i Worker webhook'una iletir (gizli yol + başlıkla)
 *   GET  /outbox                giden çağrılar (JSON); DELETE /outbox temizler
 *   GET  /webhook               setWebhook ile kaydedilen adres (yoksa null)
 *   GET  /__fixtures/llm        fixtures/llm/<amaç>/*.json (dev-worker sahte LLM'i buradan yükler)
 *
 * Kullanım: bun test/fakes/telegram-server.ts --port 8788 [--worker http://localhost:8787]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeTelegram } from './telegram.ts';
import { DEV_SECRETS } from './dev-secrets.ts';

const FIXTURES = fileURLToPath(new URL('../../../../fixtures', import.meta.url));

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

/** fixtures/llm → { amaç: [{name, data}] } (ada göre sıralı; seçim kuralı dev-worker'da). */
export function llmFixtures(root = join(FIXTURES, 'llm')): Record<string, Array<{ name: string; data: unknown }>> {
  const out: Record<string, Array<{ name: string; data: unknown }>> = {};
  for (const purpose of readdirSync(root).sort()) {
    const dir = join(root, purpose);
    let names: string[];
    try {
      names = readdirSync(dir).filter((n) => n.endsWith('.json'));
    } catch {
      continue;
    }
    out[purpose] = names.sort().map((name) => ({ name, data: readJson(join(dir, name)) }));
  }
  return out;
}

export function makeServer(opts: { worker: string }): { handle: (req: Request) => Promise<Response>; telegram: FakeTelegram } {
  const telegram = new FakeTelegram({
    me: (readJson(join(FIXTURES, 'telegram/api/getMe.privacy_off.json')) as { result: Record<string, unknown> }).result,
    chatMember: (readJson(join(FIXTURES, 'telegram/api/getChatMember.administrator.json')) as { result: Record<string, unknown> }).result,
  });
  let webhook: string | null = null;
  const handle = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/bot')) {
      const res = await telegram.fetch(req.url, { method: 'POST', body: await req.text() });
      const last = telegram.outbox.at(-1);
      if (last?.method === 'setWebhook') webhook = String(last.params.url ?? '');
      return res;
    }
    if (url.pathname === '/sendUpdate' && req.method === 'POST') {
      const body = await req.text();
      const res = await fetch(`${opts.worker}/telegram/${DEV_SECRETS.WEBHOOK_SECRET_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': DEV_SECRETS.TELEGRAM_WEBHOOK_SECRET },
        body,
      });
      return Response.json({ worker_status: res.status });
    }
    if (url.pathname === '/outbox') {
      if (req.method === 'DELETE') {
        telegram.clear();
        return Response.json({ ok: true });
      }
      return Response.json(telegram.outbox);
    }
    if (url.pathname === '/webhook') return Response.json({ url: webhook });
    if (url.pathname === '/__fixtures/llm') return Response.json(llmFixtures());
    return new Response('Not Found', { status: 404 });
  };
  return { handle, telegram };
}

/** node:http köprüsü (bun ve Node'da aynı çalışır; Bun'a özgü API yok). */
async function bridge(handle: (req: Request) => Promise<Response>, req: IncomingMessage, res: ServerResponse, port: number): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const method = req.method ?? 'GET';
  const request = new Request(`http://localhost:${port}${req.url ?? '/'}`, { method, headers: { 'content-type': 'application/json' }, ...(method === 'GET' || method === 'HEAD' ? {} : { body: Buffer.concat(chunks).toString('utf8') }) });
  const out = await handle(request);
  res.writeHead(out.status, { 'content-type': out.headers.get('content-type') ?? 'application/json' });
  res.end(await out.text());
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const port = Number(arg('port', '8788'));
  const { handle } = makeServer({ worker: arg('worker', 'http://localhost:8787') });
  createServer((req, res) => void bridge(handle, req, res, port)).listen(port);
  console.warn(JSON.stringify({ lvl: 'warn', evt: 'fake_telegram_listening', port }));
}
