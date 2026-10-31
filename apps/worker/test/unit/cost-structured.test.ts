import { describe, expect, it } from 'vitest';
import { isValid } from '@ogrenmen/contracts/validators';
import { apiModelName, chain, COST_RULES, costUsd, isPaidProvider, neurons } from '../../src/llm/cost.ts';
import { geminiToJsonSchema, parseTutorReply, TUTOR_REPLY_GEMINI_SCHEMA, TUTOR_REPLY_JSON_SCHEMA, validateTutorReply } from '../../src/llm/structured.ts';
import { loadLlmFixtures } from '../fakes/llm-fixtures.ts';

describe('cost', () => {
  it('Flash-Lite turu: 1800 giriş + 160 çıkış = 0,000244 $ ≤ hedef', () => {
    const c = costUsd('gemini-2.5-flash-lite', 1800, 160);
    expect(c).toBeCloseTo(0.000244, 9);
    expect(c).toBeLessThanOrEqual(COST_RULES.chat_target_usd);
    expect(costUsd('gemini-2.5-flash-lite@free', 1800, 160)).toBe(0);
    expect(costUsd('bilinmeyen-model', 1000, 1000)).toBe(0);
  });

  it('zincirler models.json\'dan; ücretli sağlayıcı yalnız chat zincirinin başında; güçlü zincir reddedilir', () => {
    const c = chain('chat');
    expect(c[0]).toEqual({ model: 'gemini-2.5-flash-lite', provider: 'gemini-paid' });
    expect(chain('chat_free_only').some((x) => isPaidProvider(x.provider))).toBe(false);
    expect(() => chain('lesson_analysis')).toThrow(/OGR-LLM-001/);
    expect(apiModelName('gemini-2.5-flash-lite@free')).toBe('gemini-2.5-flash-lite');
    expect(neurons('@cf/meta/llama-3.3-70b-instruct-fp8-fast', 1500, 500)).toBeGreaterThan(0);
  });
});

describe('structured', () => {
  const fx = loadLlmFixtures();
  it('chat ve chat_group fixture\'ları tutor-reply olarak geçer, bad-schema geçmez', () => {
    for (const purpose of ['chat', 'chat_group']) {
      for (const f of fx[purpose] ?? []) {
        const r = parseTutorReply(JSON.stringify(f.data));
        expect(r.ok, `${purpose}/${f.name}`).toBe(!f.name.startsWith('bad-schema'));
      }
    }
    expect(parseTutorReply('```json\n' + JSON.stringify(fx.chat?.find((f) => f.name.startsWith('01'))?.data) + '\n```').ok).toBe(true);
    const bad = parseTutorReply('çöp');
    expect(bad.ok).toBe(false);
    expect(validateTutorReply({}).ok).toBe(false);
  });

  it('Gemini şemasından standart JSON Schema: nullable → null tipi, additionalProperties=false', () => {
    const s = geminiToJsonSchema({ type: 'object', properties: { a: { type: 'string', nullable: true }, b: { type: 'string', enum: ['x'], nullable: true } }, propertyOrdering: ['a', 'b'] }) as Record<string, unknown>;
    expect(s).toEqual({ type: 'object', properties: { a: { type: ['string', 'null'] }, b: { type: ['string', 'null'], enum: ['x', null] } }, additionalProperties: false });
    expect(TUTOR_REPLY_GEMINI_SCHEMA.type).toBe('object');
    expect(JSON.stringify(TUTOR_REPLY_JSON_SCHEMA)).not.toContain('nullable');
    expect(isValid('tutor-reply', fx.chat?.[0]?.data)).toBe(true);
  });
});
