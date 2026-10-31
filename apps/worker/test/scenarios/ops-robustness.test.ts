/**
 * İşletim dayanıklılığı: yan yazımlar (sağlayıcı sağlığı, düzenlenen mesaj, ops alarmı) ve cron satırları
 * hata verse de ana akış sürer; keepalive sağlığı denetler; webhook bütçesi aşılırsa iş waitUntil ile sürer.
 */
import { describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../../src/data/fake.ts';
import { DbError } from '../../src/data/repo.ts';
import { texts } from '../../src/texts.ts';
import { IDS, makeApp, rows } from '../helpers.ts';

/** İmzasız, yalnız `exp` taşıyan test JWT'si (gerçek anahtar değil). */
function unsignedJwt(expSec: number): string {
  const b64 = (o: unknown): string => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ role: 'bot_runtime', exp: expSec })}.imzasiz`;
}

describe('provider-health-write-failure', () => {
  it('provider_health yazımı düşse de 429 → sonraki sağlayıcı; öğrenci cevap alır', async () => {
    const w = makeApp({ llm: { failWith: { 429: [0] }, pick: 'chat/01-socratic-paydalar.json' } });
    const spy = vi.spyOn(FakeDb.prototype, 'updateProviderHealth').mockImplementation(async () => {
      throw new DbError('42501', 'permission denied for table provider_health', 403);
    });
    try {
      await w.send(w.privateText(IDS.elifChat, 'Kesirlerde paydaları nasıl eşitlerim?'));
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    expect(w.llm.calls.map((c) => [c.provider, c.status])).toEqual([
      ['gemini-paid', 429],
      ['gemini-free', 200],
    ]);
    expect(w.telegram.textsTo(IDS.elifChat).at(-1)).not.toBe(texts.degraded);
    expect((rows(w, 'bot_responses').at(-1) as Record<string, unknown>).provider).toBe('gemini-free');
  });
});

describe('edited-message-grant-failure', () => {
  it('düzenlenen mesajın metin yazımı yetkiyle düşerse öğrenciye "yanıt veremiyorum" gitmez', async () => {
    const w = makeApp();
    const msg = w.privateText(IDS.elifChat, 'teşekkürler', { messageId: 4242 });
    await w.send(msg);
    const sentBefore = w.telegram.textsTo(IDS.elifChat).length;
    const spy = vi.spyOn(FakeDb.prototype, 'updateMessageText').mockImplementation(async () => {
      throw new DbError('42501', 'permission denied for column text_raw', 403);
    });
    try {
      await w.send({ update_id: 991_999_001, edited_message: { ...msg.message!, text: 'teşekkürler, anladım', edit_date: 1 } as never });
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    expect(w.telegram.textsTo(IDS.elifChat).length).toBe(sentBefore);
  });
});

describe('proactive-row-isolation', () => {
  it('bir satır düşerse failed olur, sonraki satırlar aynı turda gönderilir', async () => {
    const w = makeApp();
    const base = { recipient: 'student', scheduled_for: '2026-10-20T15:30:00Z', sent_at: null, telegram_message_id: null, status: 'scheduled' };
    w.db.table('proactive_messages').push(
      { ...base, id: 'f0f0f0f0-0000-4000-8000-0000000000a1', student_id: IDS.mert, chat_id: IDS.mertChat, template_id: 'research_ready', params: { output_id: '00000000-0000-4000-8000-0000000000ff' } },
      { ...base, id: 'f0f0f0f0-0000-4000-8000-0000000000a2', student_id: IDS.mert, chat_id: IDS.mertChat, template_id: 'priority_plan_ready', params: {} },
    );
    const spy = vi.spyOn(FakeDb.prototype, 'researchRelease').mockImplementation(async () => {
      throw new DbError('PGRST000', 'bağlantı koptu', 503);
    });
    try {
      await w.app.runCron('*/15 * * * *');
    } finally {
      spy.mockRestore();
    }
    const pm = rows(w, 'proactive_messages', (p) => String(p.id).startsWith('f0f0f0f0-0000-4000-8000-0000000000a'));
    expect(pm.map((p) => p.status)).toEqual(['failed', 'sent']);
    expect(w.telegram.textsTo(IDS.mertChat)).toContain(texts.proactive.priority_plan_ready);
  });
});

describe('keepalive-health', () => {
  it('bot JWT 10 gün içinde bitiyorsa 06:00 keepalive kurucuya DM atar; 60 gün kala DM yok', async () => {
    const now = Date.parse('2026-10-20T06:00:00Z') / 1000;
    const w = makeApp({ now: '2026-10-20T06:00:00Z', env: { SUPABASE_BOT_JWT: unsignedJwt(now + 10 * 86_400 + 3600) } });
    await w.app.runCron('0 6 * * *');
    expect(w.db.rpcCalls).toContain('ping');
    const dm = w.telegram.textsTo(IDS.admin);
    expect(dm.length).toBe(1);
    expect(dm[0]).toContain('bot JWT 10 gün içinde bitiyor');
    const health = (await w.app.health()) as { ok: boolean; bot_jwt_days_left: number };
    expect(health.ok).toBe(false);
    expect(health.bot_jwt_days_left).toBe(10);

    const ok = makeApp({ now: '2026-10-20T06:00:00Z', env: { SUPABASE_BOT_JWT: unsignedJwt(now + 60 * 86_400) } });
    await ok.app.runCron('0 6 * * *');
    expect(ok.telegram.textsTo(IDS.admin).length).toBe(0);
  });
});

describe('webhook-wait-until', () => {
  it('güncelleme işi ExecutionContext.waitUntil ile kaydedilir (25 sn bütçesi aşılırsa yanıt sonrası sürer)', async () => {
    const w = makeApp({ llm: { pick: 'chat/01-socratic-paydalar.json' } });
    const waits: Array<Promise<unknown>> = [];
    const res = await w.app.fetch(
      new Request('https://bot.example/telegram/test-secret-path', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'test-webhook-secret' },
        body: JSON.stringify(w.privateText(IDS.elifChat, 'Kesirlerde paydaları nasıl eşitlerim?')),
      }),
      { waitUntil: (p) => waits.push(p) },
    );
    expect(res.status).toBe(200);
    expect(waits.length).toBe(1);
    await Promise.all(waits);
    expect(w.telegram.textsTo(IDS.elifChat).length).toBe(1);
  });
});
