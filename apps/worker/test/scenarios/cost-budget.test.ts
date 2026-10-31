import { describe, expect, it } from 'vitest';
import { COST_RULES } from '../../src/llm/cost.ts';
import { IDS, makeApp, rows, type TestWorld } from '../helpers.ts';

/** §5.6 `test/scenarios/cost-budget.test.ts`: tur maliyeti ve giriş token bütçesi. */
const ask = (w: TestWorld, text: string) => w.send(w.privateText(IDS.elifChat, text));

describe('cost-budget', () => {
  it(`sohbet turu ≤ ${COST_RULES.chat_turn_max_usd} $ ve giriş ≤ ${COST_RULES.chat_budget_tokens_in} token`, async () => {
    const w = makeApp();
    const seeded = rows(w, 'bot_responses').length;
    const prompts = [
      'Kesirlerde paydaları nasıl eşitlerim?',
      'Mutlak değer denkleminde neden iki durum var?',
      'Yüzde problemlerinde %20 artış sonra %20 azalış neden aynı yere getirmez?',
    ];
    for (const p of prompts) {
      w.clock.advance(30_000);
      await ask(w, p);
    }
    const chats = rows(w, 'bot_responses').slice(seeded).filter((b) => b.purpose === 'chat' && b.provider !== null);
    expect(chats.length).toBe(3);
    for (const b of chats) {
      expect(Number(b.cost_usd)).toBeLessThanOrEqual(COST_RULES.chat_turn_max_usd);
      expect(Number(b.tokens_in)).toBeLessThanOrEqual(COST_RULES.chat_budget_tokens_in);
    }
    for (const c of w.llm.okCalls) expect(c.tokensIn).toBeLessThanOrEqual(COST_RULES.chat_budget_tokens_in);
  });

  it('uzun bağlam bütçeye kırpılır (recent 4, facts 3)', async () => {
    const w = makeApp();
    for (let i = 0; i < 12; i++) {
      w.clock.advance(30_000);
      await ask(w, `Soru ${i}: ` + 'rasyonel sayılarda paydaları eşitleme ve sadeleştirme adımlarını uzun uzun anlatır mısın? '.repeat(6));
    }
    for (const c of w.llm.okCalls) expect(c.tokensIn).toBeLessThanOrEqual(COST_RULES.chat_budget_tokens_in);
  });
});
