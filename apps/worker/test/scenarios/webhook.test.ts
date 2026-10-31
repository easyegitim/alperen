import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { ConfigError, loadConfig } from '../../src/env.ts';
import { ENV, fx, IDS, makeApp, rows } from '../helpers.ts';

function post(path: string, secret: string | null, body: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret !== null) headers['X-Telegram-Bot-Api-Secret-Token'] = secret;
  return new Request(`https://bot.example${path}`, { method: 'POST', headers, body });
}

describe('webhook-auth', () => {
  it('yanlış gizli yol ya da başlık → 404, gövde işlenmez', async () => {
    const w = makeApp();
    const body = JSON.stringify(fx('private_text'));
    const before = rows(w, 'tg_updates').length;
    for (const req of [
      post('/telegram/yanlis-yol', ENV.TELEGRAM_WEBHOOK_SECRET, body),
      post(`/telegram/${ENV.WEBHOOK_SECRET_PATH}`, 'yanlis-gizli', body),
      post(`/telegram/${ENV.WEBHOOK_SECRET_PATH}`, null, body),
      post('/baska', ENV.TELEGRAM_WEBHOOK_SECRET, body),
    ]) {
      const res = await w.app.fetch(req);
      expect(res.status).toBe(404);
      expect(req.bodyUsed).toBe(false);
    }
    expect(rows(w, 'tg_updates').length).toBe(before);
    expect(w.telegram.outbox.length).toBe(0);
    expect(w.db.rpcCalls.length).toBe(0);
  });

  it('64 KB üstü gövde → 200 ve işlenmez; bozuk JSON → 200', async () => {
    const w = makeApp();
    const big = fx('oversized');
    const res = await w.send(big);
    expect(res.status).toBe(200);
    expect(rows(w, 'tg_updates', (r) => r.update_id === big.update_id).length).toBe(0);
    const bad = await w.app.fetch(post(`/telegram/${ENV.WEBHOOK_SECRET_PATH}`, ENV.TELEGRAM_WEBHOOK_SECRET, '{bozuk'));
    expect(bad.status).toBe(200);
    expect(w.telegram.outbox.length).toBe(0);
  });

  it('4.000 karakter üstü metin kırpılır ve "Mesajını kısaltarak okudum." denir', async () => {
    const w = makeApp({ llm: { pick: 'chat/01-socratic-paydalar.json' } });
    const u = w.privateText(IDS.elifChat, 'x'.repeat(4100) + ' kaç?');
    await w.send(u);
    const msg = rows(w, 'messages', (m) => m.chat_id === IDS.elifChat && m.telegram_message_id === u.message?.message_id)[0];
    expect(Array.from(String(msg?.text_raw)).length).toBe(4000);
    expect(w.telegram.textsTo(IDS.elifChat)[0]).toBe('Mesajını kısaltarak okudum.');
  });

  it('/health: {ok, version, prompt_version, bot_jwt_days_left, db}', async () => {
    const w = makeApp();
    const res = await w.app.fetch(new Request('https://bot.example/health'));
    expect(res.status).toBe(200);
    const h = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(h).sort()).toEqual(['bot_jwt_days_left', 'db', 'ok', 'prompt_version', 'version']);
    expect(h.ok).toBe(true);
    expect(h.db).toBe('ok');
    expect(h.prompt_version).toBe('socratic.v3');
  });

  it('/health: bot JWT 14 günden az kaldıysa ok:false', async () => {
    const w = makeApp();
    const exp = Math.floor(w.clock.now().getTime() / 1000) + 10 * 86_400;
    const payload = btoa(JSON.stringify({ role: 'bot_runtime', exp })).replace(/=+$/, '');
    const jwt = `eyJhbGciOiJIUzI1NiJ9.${payload}.imza`;
    const app = createApp({ ...ENV, DB: 'supabase', SUPABASE_URL: 'http://fake-supabase', SUPABASE_ANON_KEY: 'anon', SUPABASE_BOT_JWT: jwt }, { ...w.app.services.deps });
    const h = await app.health();
    expect(h.bot_jwt_days_left).toBe(10);
    expect(h.ok).toBe(false);
  });

  it('env.ts: hizmet rolü ya da JWT gizi adı görülürse boot bilerek düşer', () => {
    expect(() => loadConfig({ ...ENV, ['SUPABASE_SERVICE_ROLE' + '_KEY']: 'x' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...ENV, ['SUPABASE_JWT' + '_SECRET']: 'x' })).toThrow(/OGR-ENV-001/);
    expect(() => loadConfig({ ...ENV, TELEGRAM_BOT_TOKEN: '' })).toThrow(/OGR-ENV-002/);
  });
});
