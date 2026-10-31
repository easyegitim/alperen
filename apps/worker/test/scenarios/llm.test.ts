import { describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../../src/data/fake.ts';
import { texts } from '../../src/texts.ts';
import { IDS, makeApp, rows, type TestWorld } from '../helpers.ts';

const lastBr = (w: TestWorld): Record<string, unknown> => rows(w, 'bot_responses').at(-1) as Record<string, unknown>;
const ask = (w: TestWorld, text = 'Kesirlerde paydaları nasıl eşitlerim?') => w.send(w.privateText(IDS.elifChat, text));

describe('router-fallback', () => {
  it('429 → sonraki sağlayıcı; provider_attempts 2 kayıt; cooldown yazılır', async () => {
    const w = makeApp({ llm: { failWith: { 429: [0] } } });
    await ask(w);
    expect(w.llm.calls.map((c) => [c.provider, c.status])).toEqual([
      ['gemini-paid', 429],
      ['gemini-free', 200],
    ]);
    const br = lastBr(w);
    const attempts = br.provider_attempts as Array<Record<string, unknown>>;
    expect(attempts.length).toBe(2);
    expect(attempts[0]?.status).toBe('rate_limited');
    expect(attempts[1]?.status).toBe('ok');
    expect(br.provider).toBe('gemini-free');
    expect(rows(w, 'llm_calls', (c) => c.ref_id === String(br.id)).length).toBe(2);
    const health = rows(w, 'provider_health', (h) => h.provider === 'gemini-paid')[0];
    expect(Date.parse(String(health?.cooldown_until))).toBeGreaterThan(w.clock.now().getTime());
    // İkinci tur: cooldown'daki sağlayıcı çağrılmadan atlanır (cooldown_skip, maliyet 0).
    w.clock.advance(5_000);
    await ask(w, 'Peki 2/3 + 1/6 için ne yapmalıyım?');
    expect(w.llm.calls.slice(2).map((c) => c.provider)).toEqual(['gemini-free']);
    const second = lastBr(w).provider_attempts as Array<Record<string, unknown>>;
    expect(second[0]).toMatchObject({ provider: 'gemini-paid', status: 'cooldown_skip', cost_usd: 0 });
  });

  it('401 → kurucuya DM + gün sonuna cooldown; zincir devam eder (error_code config_401)', async () => {
    const w = makeApp({ llm: { providerStatus: { 'gemini-paid': 401 } } });
    await ask(w);
    const attempts = lastBr(w).provider_attempts as Array<Record<string, unknown>>;
    expect(attempts[0]).toMatchObject({ provider: 'gemini-paid', status: 'error', error_code: 'config_401' });
    expect(lastBr(w).provider).toBe('gemini-free');
    const dm = w.telegram.textsTo(IDS.admin);
    expect(dm.length).toBe(1);
    expect(dm[0]).toContain('gemini-paid');
    const cd = Date.parse(String(rows(w, 'provider_health', (h) => h.provider === 'gemini-paid')[0]?.cooldown_until));
    // Gün sonu = ertesi gün 00:00 İstanbul = 21:00Z.
    expect(new Date(cd).toISOString()).toBe('2026-10-20T21:00:00.000Z');
    expect(w.telegram.textsTo(IDS.elifChat).length).toBe(1);
  });

  it('şemaya aykırı çıktı → aynı sağlayıcıda 1 onarım', async () => {
    const w = makeApp({ llm: { badOutputEvery: 1 } });
    await ask(w);
    // Her çağrı bad-schema döner: her sağlayıcıda 2 deneme, sonra düşer → degraded.
    const perProvider = new Map<string, number>();
    for (const c of w.llm.calls) perProvider.set(c.provider, (perProvider.get(c.provider) ?? 0) + 1);
    for (const n of perProvider.values()) expect(n).toBe(2);
    expect(lastBr(w).purpose).toBe('degraded');
    expect(lastBr(w).schema_valid).toBe(false);
  });
});

describe('spend-cap', () => {
  it('free_only → yalnız ücretsiz sağlayıcı çağrılır', async () => {
    const w = makeApp({ mutateSeed: (seed) => void ((seed.runtime_flags as Array<Record<string, unknown>>).find((f) => f.key === 'paid_llm_enabled')!.value = false) });
    expect((await w.db.checkSpend('chat')).state).toBe('free_only');
    await ask(w);
    expect(w.llm.calls.length).toBe(1);
    expect(w.llm.calls.every((c) => c.provider !== 'gemini-paid')).toBe(true);
    expect(lastBr(w).provider).toBe('gemini-free');
  });

  it('günlük tavan aşılınca free_only (ledger ile)', async () => {
    const w = makeApp();
    w.db.table('spend_ledger').push({ day: '2026-10-20', purpose: 'chat', provider: 'gemini-paid', calls: 3000, tokens_in: 0, tokens_out: 0, cost_usd: 0.85 });
    expect((await w.db.checkSpend('chat')).state).toBe('free_only');
    await ask(w);
    expect(w.llm.calls.map((c) => c.provider)).toEqual(['gemini-free']);
  });

  it('ders analizi harcaması (2,0 $) sohbeti düşürmez: state normal, ücretli sağlayıcı çağrılır', async () => {
    const w = makeApp();
    const before = await w.db.checkSpend('chat');
    w.db.table('llm_calls').push({ id: 99_999, purpose: 'lesson_analysis', provider: 'gemini-paid', model: 'gemini-2.5-pro', tokens_in: 100_000, tokens_out: 8000, batch: false, status: 'ok', cost_usd: 2.0, created_at: '2026-10-20T15:00:00Z' });
    w.db.table('spend_ledger').push({ day: '2026-10-20', purpose: 'lesson_analysis', provider: 'gemini-paid', calls: 1, tokens_in: 100_000, tokens_out: 8000, cost_usd: 2.0 });
    const after = await w.db.checkSpend('chat');
    expect(after.state).toBe('normal');
    expect(after.day_usd).toBeCloseTo(before.day_usd, 9);
    expect((await w.db.checkSpend('lesson_analysis')).lesson_month_usd).toBeGreaterThanOrEqual(2.0);
    await ask(w);
    expect(w.llm.calls[0]?.provider).toBe('gemini-paid');
    expect(lastBr(w).provider).toBe('gemini-paid');
  });
});

describe('all-down-degraded', () => {
  it('tüm sağlayıcılar düşer → şablon + yükseltme; purpose=degraded, degraded_mode=true', async () => {
    const w = makeApp({ llm: { providerStatus: { 'gemini-paid': 503, 'gemini-free': 503, groq: 429, 'cf-ai': 500, openrouter: 502 } } });
    const esc = rows(w, 'escalations').length;
    await ask(w);
    expect(w.telegram.textsTo(IDS.elifChat).at(-1)).toBe(texts.degraded);
    const br = lastBr(w);
    expect(br.purpose).toBe('degraded');
    expect(br.degraded_mode).toBe(true);
    expect(br.escalated).toBe(true);
    expect(rows(w, 'escalations').length).toBe(esc + 1);
    expect(rows(w, 'escalations').at(-1)?.reason).toBe('degraded');
  });

  it('degraded_mode bayrağı → LLM yok, şablon', async () => {
    const w = makeApp({ mutateSeed: (seed) => void ((seed.runtime_flags as Array<Record<string, unknown>>).find((f) => f.key === 'degraded_mode')!.value = true) });
    await ask(w);
    expect(w.llm.calls.length).toBe(0);
    expect(w.telegram.textsTo(IDS.elifChat).at(-1)).toBe(texts.degraded);
    expect(lastBr(w).provider).toBeNull();
  });

  it('günlük kaydı yazılamazsa ("kayıt yoksa cevap yok") yalnız degraded metni gider', async () => {
    const w = makeApp({ llm: { pick: 'chat/01-socratic-paydalar.json' } });
    const orig = FakeDb.prototype.logBotResponse;
    let failed = 0;
    const spy = vi.spyOn(FakeDb.prototype, 'logBotResponse').mockImplementation(async function (this: FakeDb, p: Record<string, unknown>) {
      if (p.purpose === 'chat' && failed === 0) {
        failed++;
        throw new Error('db down');
      }
      return orig.call(this, p);
    });
    try {
      const esc = rows(w, 'escalations').length;
      const br = rows(w, 'bot_responses').length;
      await ask(w);
      expect(w.telegram.textsTo(IDS.elifChat)).toEqual([texts.degraded]);
      expect(rows(w, 'escalations').length).toBe(esc + 1);
      expect(rows(w, 'escalations').at(-1)?.reason).toBe('degraded');
      expect(rows(w, 'bot_responses').length).toBe(br);
      expect(w.llm.calls.length).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('quota', () => {
  // consume_quota (§3.9) uyarıyı `limit - used = warn_at` iken verir: 25'lik kotada 20. mesajda (5 kala).
  // §5.11 senaryo metni "21.'de uyarı" der; RPC semantiği kazanır (README "Kabul komutu notu" 12).
  it('20. mesajda (5 hak kala) bir kez uyarı, 21.\'de yok, 26. mesaj red (LLM yok, purpose=quota, guards=quota, mesaj yine kaydedilir)', async () => {
    const w = makeApp({ llm: { pick: 'chat/01-socratic-paydalar.json' } });
    const warn = texts.quotaWarn(5);
    const seen: string[][] = [];
    for (let i = 1; i <= 26; i++) {
      w.clock.advance(10_000);
      const before = w.telegram.textsTo(IDS.elifChat).length;
      await ask(w, `Soru ${i}: 3/4 + 1/8 kaç?`);
      seen.push(w.telegram.textsTo(IDS.elifChat).slice(before));
    }
    expect(seen[19]?.includes(warn)).toBe(true);
    expect(seen.filter((s) => s.includes(warn)).length).toBe(1);
    expect(seen[20]?.includes(warn)).toBe(false);
    expect(seen[25]).toEqual([texts.quotaFull(25)]);
    expect(w.llm.calls.length).toBe(25);
    const br = rows(w, 'bot_responses').at(-1) as Record<string, unknown>;
    expect(br.purpose).toBe('quota');
    expect(w.db.botResponsePayloads.at(-1)?.guards).toEqual(['quota']);
    expect(br.cost_usd).toBe(0);
    expect(br.provider).toBeNull();
    const msgs = rows(w, 'messages', (m) => m.chat_id === IDS.elifChat && String(m.text_raw).startsWith('Soru 26'));
    expect(msgs.length).toBe(1);
    const q = rows(w, 'quota_usage', (u) => u.student_id === IDS.elif && u.kind === 'message' && u.day === '2026-10-20')[0];
    expect(q?.used).toBe(25);
  });

  it('/kota: "Bugün X/25 mesaj, Y/5 test kullandın."; komut kota tüketmez', async () => {
    const w = makeApp({ llm: { pick: 'chat/01-socratic-paydalar.json' } });
    await ask(w);
    w.clock.advance(10_000);
    await w.send(w.privateText(IDS.elifChat, '/kota'));
    expect(w.telegram.textsTo(IDS.elifChat).at(-1)).toBe("Bugün 1/25 mesaj, 0/5 test kullandın. Yarın 00:00'da yenilenir.");
  });

  it('kurucu makinesi QUOTA_BYPASS_TELEGRAM_IDS ile kota tüketmez', async () => {
    const w = makeApp({ env: { QUOTA_BYPASS_TELEGRAM_IDS: String(IDS.elifChat) }, llm: { pick: 'chat/01-socratic-paydalar.json' } });
    await ask(w);
    expect(rows(w, 'quota_usage', (u) => u.student_id === IDS.elif && u.day === '2026-10-20').length).toBe(0);
    expect(w.llm.calls.length).toBe(1);
  });
});
