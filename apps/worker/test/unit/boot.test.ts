import { describe, expect, it } from 'vitest';
import worker from '../../src/index.ts';

describe('boot-failure (§5.1)', () => {
  it('yapılandırma hatasında Telegram webhook 200 alır (yeniden teslimat fırtınası yok); /health 503', async () => {
    const env = { TELEGRAM_BOT_TOKEN: '', WEBHOOK_SECRET_PATH: '' };
    const hook = await worker.fetch(new Request('https://bot.example/telegram/x', { method: 'POST', body: '{}' }), env);
    expect(hook.status).toBe(200);
    const health = await worker.fetch(new Request('https://bot.example/health'), env);
    expect(health.status).toBe(503);
    expect(await health.json()).toEqual({ ok: false, error: 'config' });
    const other = await worker.fetch(new Request('https://bot.example/'), env);
    expect(other.status).toBe(500);
  });

  it('yasak ortam adı (hizmet rolü) da aynı yanıtı verir', async () => {
    const env = { TELEGRAM_BOT_TOKEN: 't', TELEGRAM_WEBHOOK_SECRET: 's', WEBHOOK_SECRET_PATH: 'p', SUPABASE_SERVICE_ROLE_KEY: 'x' }; // anahtar yok
    const hook = await worker.fetch(new Request('https://bot.example/telegram/p', { method: 'POST', body: '{}' }), env);
    expect(hook.status).toBe(200);
  });
});
