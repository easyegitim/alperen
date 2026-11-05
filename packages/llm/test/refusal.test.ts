import { describe, expect, it } from 'vitest';
import { audienceForRoute, mapRefusal, refusalOf } from '../src/refusal.js';
import { PRODUCT, setup } from './helpers.js';

const CATS = ['cyber', 'bio', 'frontier_llm', 'reasoning_extraction', 'general_harms'] as const;

describe('ret eşlemesi', () => {
  it('ret değilse null', () => {
    expect(refusalOf({ stop_reason: 'end_turn', stop_details: null })).toBeNull();
  });

  it.each(CATS)('%s → Türkçe kibar ileti (ünlem/emoji yok)', (category) => {
    const r = mapRefusal({
      type: 'refusal',
      category,
      explanation: null,
      fallback_credit_token: null,
      fallback_has_prefill_claim: null,
      recommended_model: null,
    });
    expect(r.category).toBe(category);
    expect(r.user_message_tr.length).toBeGreaterThan(20);
    expect(r.user_message_tr).not.toMatch(/[!\u{1F000}-\u{1FAFF}]/u);
  });

  it('stop_details null → kategori null, eğitmene yönlendir', () => {
    const r = refusalOf({ stop_reason: 'refusal', stop_details: null });
    expect(r).toMatchObject({ category: null, notify_instructor: true });
    expect(r?.user_message_tr).toContain('hocana');
  });

  it('reasoning_extraction eğitmene gitmez, açıklama önerir', () => {
    const r = mapRefusal({ type: 'refusal', category: 'reasoning_extraction', explanation: 'x', fallback_credit_token: null, fallback_has_prefill_claim: null, recommended_model: 'claude-opus-5' });
    expect(r.notify_instructor).toBe(false);
    expect(r.recommended_model).toBe('claude-opus-5');
    expect(r.explanation).toBe('x');
  });

  it('sohbet rotasında ret: sonuç döner, metin kibar ileti, defterde kategori', async () => {
    const { gateway, fake, ledger } = setup();
    fake.enqueue('coach_chat', { stopReason: 'refusal', stopDetails: { category: 'bio' } });
    const res = await gateway.call('coach_chat', { system: { product: PRODUCT }, user: 'soru' });
    expect(res.refusal?.category).toBe('bio');
    expect(res.text).toBe(res.refusal?.user_message_tr);
    expect(res.toolCalls).toEqual([]);
    expect(ledger.rows[0]).toMatchObject({ status: 'refusal', error_code: 'bio', stop_reason: 'refusal' });
  });

  it('ret turunda araç çalıştırılmaz', async () => {
    const { gateway, fake } = setup();
    let ran = 0;
    fake.enqueue('coach_chat', { stopReason: 'refusal', toolUses: [{ name: 'get_mastery', input: {} }] });
    const res = await gateway.call('coach_chat', {
      system: { product: PRODUCT },
      user: 'soru',
      tools: { runners: { get_mastery: () => { ran += 1; return '{}'; } } },
    });
    expect(ran).toBe(0);
    expect(res.refusal).not.toBeNull();
  });

  it.each(CATS)('%s: iletiler not bırakıldığını iddia etmez (bildirimi çağıran yazar)', (category) => {
    for (const audience of ['student', 'parent'] as const) {
      const r = mapRefusal({ type: 'refusal', category, explanation: null, fallback_credit_token: null, fallback_has_prefill_claim: null, recommended_model: null }, audience);
      expect(r.audience).toBe(audience);
      expect(r.user_message_tr).not.toMatch(/not bıraktım|not bırakıldı/);
      expect(r.user_message_tr).not.toMatch(/[!\u{1F000}-\u{1FAFF}]/u);
    }
  });

  it('veli kitlesi: siz dili, "hocana" yok; rota parent_chat → veli', () => {
    expect(audienceForRoute('parent_chat')).toBe('parent');
    expect(audienceForRoute('coach_chat')).toBe('student');
    const r = mapRefusal({ type: 'refusal', category: 'bio', explanation: null, fallback_credit_token: null, fallback_has_prefill_claim: null, recommended_model: null }, 'parent');
    expect(r.user_message_tr).not.toContain('hocana');
    expect(r.user_message_tr).toMatch(/iletebilirsiniz/);
    expect(r.notify_instructor).toBe(true);
  });

  it('parent_chat reddi veli iletisini döndürür', async () => {
    const { gateway, fake } = setup();
    fake.enqueue('parent_chat', { stopReason: 'refusal', stopDetails: { category: 'general_harms' } });
    const res = await gateway.call('parent_chat', { system: { product: PRODUCT }, user: 'soru' });
    expect(res.refusal?.audience).toBe('parent');
    expect(res.text).toBe(mapRefusal({ type: 'refusal', category: 'general_harms', explanation: null, fallback_credit_token: null, fallback_has_prefill_claim: null, recommended_model: null }, 'parent').user_message_tr);
    expect(res.text).not.toContain('hocana');
  });
});
