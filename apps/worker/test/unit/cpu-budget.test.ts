/**
 * cpu-budget (§5.11, §5.12): createApp sahte bağımlılıklarla `chat-socratic` güncellemesini 20 kez işler;
 * `performance.now()` medyanı < 8 ms olmalı (Node'da yaklaşık ölçüm; CI'da uyarı değil hata).
 * Ölçüm Worker kodunun kendisidir: sahte Telegram/DB/LLM çağrıları da süreye dahildir (üst sınır).
 */
import { describe, expect, it } from 'vitest';
import { fresh, fx, makeApp } from '../helpers.ts';

describe('cpu-budget', () => {
  it('chat-socratic × 20: medyan < 8 ms', async () => {
    const w = makeApp({ llm: { pick: 'chat/01-socratic-paydalar.json' } });
    const base = fx('private_text');
    // Isınma (modül yüklemesi, JIT) ölçüme girmez.
    for (let i = 0; i < 3; i++) {
      w.clock.advance(60_000);
      const u = fresh(base);
      if (u.message) u.message.message_id = 10_000 + i;
      await w.send(u);
    }
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      w.clock.advance(60_000);
      const u = fresh(base);
      if (u.message) u.message.message_id = 20_000 + i;
      const t = performance.now();
      await w.send(u);
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    const median = ((times[9] ?? 0) + (times[10] ?? 0)) / 2;
    expect(w.llm.okCalls.length).toBe(23);
    expect(median).toBeLessThan(8);
  });
});
