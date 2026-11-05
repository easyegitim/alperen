import { describe, expect, it } from 'vitest';
import { contractRegistry, type Contract } from '@ogrenmen/contracts';
import { MaxTokensError, ParseError, RefusalError } from '../src/errors.js';
import { echoableContent, extractStructured, repairPrompt, structuredFormat } from '../src/parse.js';
import { PRODUCT, setup } from './helpers.js';

const pageClass = contractRegistry['page-class'] as Contract;

function validPageClass(fake: ReturnType<typeof setup>['fake']): unknown {
  return fake.sampleFor('page_class', pageClass);
}

const input = { system: { product: PRODUCT }, user: 'Sayfayı sınıfla', studentRef: 's_qk7m2rx4tn5a' };

describe('yapılandırılmış çıktı', () => {
  it('format strict şemadan kurulur; parse geçersizde null döner', () => {
    const f = structuredFormat(pageClass);
    expect(f.type).toBe('json_schema');
    expect(f.parse('{bozuk')).toBeNull();
    expect(f.parse('{"x":1}')).toBeNull();
    const { fake } = setup();
    expect(f.parse(JSON.stringify(validPageClass(fake)))).not.toBeNull();
    // parse işlevi JSON gövdesine girmez
    expect(JSON.parse(JSON.stringify(f))).not.toHaveProperty('parse');
  });

  it('geçerli yanıt: tek istek, ok defter satırı', async () => {
    const { gateway, ledger } = setup();
    const res = await gateway.call('page_class', input);
    expect(res.data).not.toBeNull();
    expect(pageClass.isValid(res.data)).toBe(true);
    expect(res.repaired).toBe(false);
    expect(ledger.rows.map((r) => r.status)).toEqual(['ok']);
  });

  it('parsed_output null → bir onarım turu, sonra başarı', async () => {
    const { gateway, fake, ledger } = setup();
    fake.enqueue('page_class', { text: '{"yanlis": true}' }, { json: validPageClass(fake) });
    const res = await gateway.call('page_class', input);
    expect(res.repaired).toBe(true);
    expect(ledger.rows.map((r) => r.status)).toEqual(['bad_output', 'ok']);
    const repairBody = fake.requests[1]?.body;
    const msgs = repairBody?.messages ?? [];
    expect(msgs[msgs.length - 2]?.role).toBe('assistant');
    expect(msgs[msgs.length - 1]?.role).toBe('user');
    expect(JSON.stringify(msgs[msgs.length - 1])).toContain('şemasına uymadı');
    // İlk istek değişmeden önek olarak kalır (önbellek ve thinking bağı).
    const first = fake.requests[0]?.body.messages ?? [];
    expect(msgs.slice(0, first.length)).toEqual(first);
  });

  it('onarımdan sonra da geçersiz → ParseError (kısmi veri dönmez)', async () => {
    const { gateway, fake, ledger } = setup();
    fake.enqueue('page_class', { text: 'düz metin' }, { text: '{"hala":"yanlis"}' });
    await expect(gateway.call('page_class', input)).rejects.toBeInstanceOf(ParseError);
    expect(ledger.rows.map((r) => r.status)).toEqual(['bad_output', 'bad_output']);
    expect(fake.requests).toHaveLength(2);
  });

  it('max_tokens → bir kez iki kat max_tokens ile yeniden', async () => {
    const { gateway, fake, ledger } = setup();
    fake.enqueue('page_class', { text: '{"kes', stopReason: 'max_tokens' }, { json: validPageClass(fake) });
    const res = await gateway.call('page_class', input);
    expect(res.data).not.toBeNull();
    expect(fake.requests.map((r) => r.body.max_tokens)).toEqual([4000, 8000]);
    expect(ledger.rows.map((r) => r.status)).toEqual(['max_tokens', 'ok']);
  });

  it('max_tokens iki kez → MaxTokensError', async () => {
    const { gateway, fake } = setup();
    fake.enqueue('page_class', { text: '{', stopReason: 'max_tokens' }, { text: '{', stopReason: 'max_tokens' });
    await expect(gateway.call('page_class', input)).rejects.toBeInstanceOf(MaxTokensError);
    expect(fake.requests).toHaveLength(2);
  });

  it('akışsız sınırı aşan iki kat deneme akışla gider', async () => {
    const { gateway, fake } = setup();
    fake.enqueue('solution_diagnosis', { text: '{', stopReason: 'max_tokens' });
    await gateway.call('solution_diagnosis', { system: { product: PRODUCT }, user: 'çözüm' });
    expect(fake.requests.map((r) => [r.kind, r.body.max_tokens])).toEqual([
      ['create', 16000],
      ['stream', 32000],
    ]);
  });

  it('yapılandırılmış rotada ret → RefusalError, onarım denenmez', async () => {
    const { gateway, fake, ledger } = setup();
    fake.enqueue('page_class', { stopReason: 'refusal', stopDetails: { category: 'cyber' } });
    const err = await gateway.call('page_class', input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RefusalError);
    expect((err as RefusalError).refusal.category).toBe('cyber');
    expect(fake.requests).toHaveLength(1);
    expect(ledger.rows[0]).toMatchObject({ status: 'refusal', error_code: 'cyber' });
  });

  it('extractStructured son metin bloğunu okur', () => {
    const { fake } = setup();
    const good = JSON.stringify(validPageClass(fake));
    const r = extractStructured(
      { content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: good, citations: null }] },
      pageClass,
    );
    expect(r.ok).toBe(true);
    expect(extractStructured({ content: [] }, pageClass)).toMatchObject({ ok: false });
  });

  it('repairPrompt sorunları içerir', () => {
    expect(repairPrompt('- a: eksik')).toContain('- a: eksik');
  });

  it('echoableContent: yedek sınırından önceki thinking/tool_use atılır', () => {
    const out = echoableContent([
      { type: 'thinking', thinking: '', signature: 's' },
      { type: 'text', text: 'kısmi', citations: null },
      { type: 'tool_use', id: 't1', name: 'x', input: {} },
      { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-5' }, trigger: { type: 'refusal' } } as never,
      { type: 'text', text: 'devam', citations: null },
    ]);
    expect(out.map((b) => b.type)).toEqual(['text', 'fallback', 'text']);
    const plain = [{ type: 'thinking' as const, thinking: '', signature: 's' }];
    expect(echoableContent(plain)).toEqual(plain);
  });
});
