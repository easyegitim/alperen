import { describe, expect, it } from 'vitest';
import { RateLimitError } from '@anthropic-ai/sdk';
import { contractRegistry, type Contract } from '@ogrenmen/contracts';
import { createTransport } from '../src/client.js';
import { RouteConfigError, ToolLoopError } from '../src/errors.js';
import { FakeTransport } from '../src/fake.js';
import { createGateway, Gateway } from '../src/gateway.js';
import { buildLedgerRow, InMemoryLedger, LEDGER_INSERT_SQL, PgLedger } from '../src/ledger.js';
import { InMemoryStore } from '../src/memory/pgMemory.js';
import { ROUTE_NAMES, ROUTES } from '../src/routes.js';
import type { StreamEvent } from '../src/stream.js';
import { COURSE, DOSSIER, PRODUCT, setup } from './helpers.js';

const SREF = 's_qk7m2rx4tn5a';

describe('fabrika', () => {
  it('OGRENMEN_LLM=fake → sahte taşıma; aksi halde Anthropic', async () => {
    expect((await createTransport({ env: { OGRENMEN_LLM: 'fake' } })).kind).toBe('fake');
    expect((await createTransport({ kind: 'anthropic', env: { ANTHROPIC_API_KEY: 'x' } })).kind).toBe('anthropic');
    const g = await createGateway({ env: { OGRENMEN_LLM: 'fake' } });
    expect(g.transport.kind).toBe('fake');
  });
});

describe('sahte taşıma', () => {
  it.each(ROUTE_NAMES.filter((n) => ROUTES[n].schema !== null))('%s: şemaya uygun örnek döner', (route) => {
    const fake = new FakeTransport();
    const c = contractRegistry[ROUTES[route].schema as keyof typeof contractRegistry] as Contract;
    expect(c.isValid(fake.sampleFor(route, c))).toBe(true);
  });

  it('kayıtlı rota fikstürünü okur (fixtures/llm/lesson_analysis/)', () => {
    const fake = new FakeTransport();
    const sample = fake.sampleFor('lesson_analysis', contractRegistry['lesson-analysis'] as Contract) as { lesson_ref?: string };
    expect(sample.lesson_ref).toBe('00000000-0000-0000-0000-000000000001');
  });

  it('serbest metin deterministik', async () => {
    const a = await setup().gateway.call('coach_chat', { system: { product: PRODUCT }, user: 'aynı' });
    const b = await setup().gateway.call('coach_chat', { system: { product: PRODUCT }, user: 'aynı' });
    expect(a.text).toBe(b.text);
    expect(a.text).toMatch(/^Sahte yanıt \(coach_chat/);
  });

  it('önbellek benzetimi: ikinci aynı önek cache_read > 0 (1h yazım ayrımı)', async () => {
    const { gateway, ledger } = setup();
    const input = { system: { product: PRODUCT, course: COURSE, dossier: DOSSIER }, user: 'Sayfa 1' };
    const first = await gateway.call('solution_diagnosis', input);
    expect(first.usage.cacheRead).toBe(0);
    expect(first.usage.cacheWrite1h).toBeGreaterThan(0);
    const second = await gateway.call('solution_diagnosis', { ...input, user: 'Sayfa 2' });
    expect(second.usage.cacheRead).toBeGreaterThan(0);
    expect(ledger.rows[1]?.cache_read_tokens).toBe(second.usage.cacheRead);
    expect(second.costUsd).toBeLessThan(first.costUsd);
  });
});

describe('araç döngüsü (koç sohbeti)', () => {
  it('tool_use → enjekte çalıştırıcı → tool_result → son yanıt; akış olayları; transkript', async () => {
    const { gateway, fake, ledger } = setup();
    fake.enqueue(
      'coach_chat',
      { toolUses: [{ name: 'get_mastery', input: { skill_codes: ['tyt.mat.k3'] }, id: 'tu_1' }] },
      { text: 'Payda eşitlemede zorlanıyorsun; 4 kanıta göre ustalığın 0,31.', thinking: 'özet' },
    );
    const seen: unknown[] = [];
    const events: StreamEvent[] = [];
    const res = await gateway.call('coach_chat', {
      system: { product: PRODUCT, course: COURSE, dossier: DOSSIER },
      user: 'Kesirlerde neredeyim?',
      turn: { date: '2026-11-02', mode: 'explain' },
      studentRef: SREF,
      promptVersion: 'v1',
      ref: { table: 'conversations', id: 'c1' },
      tools: { runners: { get_mastery: (input) => { seen.push(input); return JSON.stringify({ 'tyt.mat.k3': 0.31 }); } } },
      onEvent: (e) => events.push(e),
    });
    expect(seen).toEqual([{ skill_codes: ['tyt.mat.k3'] }]);
    expect(res.text).toContain('0,31');
    expect(res.toolCalls).toEqual([{ id: 'tu_1', name: 'get_mastery', input: { skill_codes: ['tyt.mat.k3'] }, isError: false }]);
    expect(fake.requests.map((r) => r.kind)).toEqual(['stream', 'stream']);
    const second = fake.requests[1]?.body.messages ?? [];
    const toolResult = second[second.length - 1];
    expect(toolResult?.role).toBe('user');
    expect(JSON.stringify(toolResult)).toContain('"tool_use_id":"tu_1"');
    // Tur sistem mesajı kullanıcıdan sonra, asistandan önce kalır (append-only).
    expect(second.map((m) => m.role)).toEqual(['user', 'system', 'assistant', 'user']);
    expect(events.some((e) => e.type === 'tool_use' && e.name === 'get_mastery')).toBe(true);
    expect(events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text).join('')).toContain('0,31');
    expect(events.some((e) => e.type === 'thinking')).toBe(true);
    expect(res.transcript.map((m) => m.role)).toEqual(['user', 'system', 'assistant', 'user', 'assistant']);
    expect(ledger.rows).toHaveLength(2);
    expect(res.ledgerIds).toEqual([1, 2]);
  });

  it('hafıza aracı depoya yazar; geçersiz araç girdisi is_error döner; eksik çalıştırıcı is_error', async () => {
    const { gateway, fake } = setup();
    const store = new InMemoryStore();
    fake.enqueue(
      'coach_chat',
      {
        toolUses: [
          { name: 'memory', input: { command: 'create', path: '/memories/patterns.md', file_text: '- işaret hatası (2026-11-02)' }, id: 'm1' },
          { name: 'memory', input: { command: 'create', path: '/memories/../x', file_text: 'x' }, id: 'm2' },
          { name: 'get_recent_exams', input: { limit: 99 }, id: 'g1' },
          { name: 'search_evidence', input: { query: 'kesir' }, id: 's1' },
        ],
      },
      { text: 'Tamam.' },
    );
    const res = await gateway.call('coach_chat', {
      system: { product: PRODUCT },
      user: 'not al',
      tools: { memory: { store, studentId: 'st-1', actor: 'coach' } },
    });
    expect(await store.read('st-1', '/memories/patterns.md')).toBe('- işaret hatası (2026-11-02)');
    expect(res.toolCalls.map((t) => [t.id, t.isError])).toEqual([
      ['m1', false],
      ['m2', true],
      ['g1', true],
      ['s1', true],
    ]);
    const results = JSON.stringify(fake.requests[1]?.body.messages.at(-1));
    expect(results).toContain('OGR-MEM-013');
    expect(results).toContain('INVALID_INPUT');
    expect(results).toContain('OGR-LLM-010');
  });

  it('pause_turn: asistan içeriği aynen geri gider, ek kullanıcı iletisi yok', async () => {
    const { gateway, fake } = setup();
    fake.enqueue('curriculum_draft', { text: 'araştırıyorum', stopReason: 'pause_turn' });
    await gateway.call('curriculum_draft', { system: { product: PRODUCT }, user: 'TYT Fizik' });
    const msgs = fake.requests[1]?.body.messages ?? [];
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('araç döngüsü sınırı', async () => {
    const { gateway, fake } = setup();
    const loop = { toolUses: [{ name: 'get_mastery', input: {} }] };
    for (let i = 0; i < 20; i++) fake.enqueue('coach_chat', loop);
    await expect(
      gateway.call('coach_chat', { system: { product: PRODUCT }, user: 'x', tools: { runners: { get_mastery: () => '{}' } } }),
    ).rejects.toBeInstanceOf(ToolLoopError);
  });
});

describe('defter (llm_calls)', () => {
  it('satır alanları: rota, model, effort, token, önbellek, maliyet, durum, stop_reason, prompt_version, ref, student_ref', async () => {
    const { gateway, ledger } = setup();
    const res = await gateway.call('page_class', {
      system: { product: PRODUCT },
      user: [{ type: 'image', source: { type: 'url', url: 'https://example.invalid/p1.png' } }, { type: 'text', text: 'sınıfla' }],
      studentRef: SREF,
      promptVersion: 'v3',
      ref: { table: 'exam_sessions', id: 'es-1' },
    });
    const row = ledger.rows[0];
    expect(row).toMatchObject({
      id: 1,
      route: 'page_class',
      purpose: 'page_class',
      provider: 'anthropic',
      model: 'claude-haiku-5-5',
      effort: 'low',
      prompt_version: 'v3',
      batch: false,
      status: 'ok',
      error_code: null,
      stop_reason: 'end_turn',
      images: 1,
      ref_table: 'exam_sessions',
      ref_id: 'es-1',
      student_ref: SREF,
    });
    expect(row?.tokens_in).toBeGreaterThan(0);
    expect(row?.tokens_out).toBeGreaterThan(0);
    expect(row?.cache_write_tokens).toBe(res.usage.cacheWrite5m + res.usage.cacheWrite1h);
    expect(row?.cost_usd).toBe(res.costUsd);
    expect(row?.latency_ms).toBe(10);
  });

  it('student_ref uuid olamaz', () => {
    expect(() =>
      buildLedgerRow({ route: 'x', model: 'm', effort: null, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }, batch: false, status: 'ok', costUsd: 0, studentRef: '11111111-1111-4111-8111-111111111111' }),
    ).toThrow(/OGR-LLM-008/);
  });

  it('API hatası: defter satırı (rate_limited) ve hata yükselir', async () => {
    const { gateway, fake, ledger } = setup();
    fake.enqueue('page_class', { error: new RateLimitError(429, { type: 'error', error: { type: 'rate_limit_error', message: 'yavaş' } }, 'yavaş', new Headers()) });
    await expect(gateway.call('page_class', { system: { product: PRODUCT }, user: 'x' })).rejects.toBeInstanceOf(RateLimitError);
    expect(ledger.rows[0]).toMatchObject({ status: 'rate_limited', error_code: '429', tokens_in: 0 });
  });

  it('PgLedger: llm_calls insert, parametre sırası sütunlarla aynı', async () => {
    const calls: { sql: string; values: unknown[] }[] = [];
    const db = { query: async (sql: string, values: unknown[] = []) => { calls.push({ sql, values }); return { rows: [{ id: '42' }] }; } };
    const row = buildLedgerRow({ route: 'page_class', model: 'claude-haiku-5-5', effort: 'low', usage: { input: 10, output: 5, cacheRead: 2, cacheWrite5m: 1, cacheWrite1h: 3 }, batch: true, status: 'max_tokens', stopReason: 'max_tokens', costUsd: 0.000012, studentRef: SREF });
    const id = await new PgLedger(db).write(row);
    expect(id).toBe(42);
    expect(calls[0]?.sql).toBe(LEDGER_INSERT_SQL);
    expect(LEDGER_INSERT_SQL).toMatch(/^insert into public\.llm_calls \(route, purpose, provider, model, effort, prompt_version, tokens_in, tokens_out, cache_read_tokens, cache_write_tokens, images, batch, status, error_code, latency_ms, cost_usd, ref_table, ref_id, student_ref\)/);
    expect(calls[0]?.values).toEqual(['page_class', 'page_class', 'anthropic', 'claude-haiku-5-5', 'low', null, 10, 5, 2, 4, null, true, 'max_tokens', 'max_tokens', null, 0.000012, null, null, SREF]);
  });

  it('PgLedger yazma hatası çağrıyı düşürmez', async () => {
    const errs: unknown[] = [];
    const db = { query: async () => { throw new Error('bağlantı yok'); } };
    const g = new Gateway({ transport: new FakeTransport(), ledger: new PgLedger(db, (e) => errs.push(e)) });
    const res = await g.call('notification_copy', { system: { product: PRODUCT }, user: 'deneme bitti' });
    expect(res.data).not.toBeNull();
    expect(res.ledgerIds).toEqual([]);
    expect(errs).toHaveLength(1);
  });
});

describe('Batch', () => {
  it('gönder → bekle → topla: doğrulama, 0.5× fiyat, batch=true defter', async () => {
    const fake = new FakeTransport();
    const ledger = new InMemoryLedger();
    const g = new Gateway({ transport: fake, ledger });
    const c = contractRegistry['eval-verdict'] as Contract;
    fake.enqueue('eval_judge', { json: fake.sampleFor('eval_judge', c) }, { text: '{"bozuk":1}' }, { stopReason: 'refusal', stopDetails: { category: 'general_harms' } });
    const { batch, meta } = await g.submitBatch('eval_judge', [
      { customId: 'case_1', input: { system: { product: PRODUCT }, user: 'vaka 1', studentRef: SREF } },
      { customId: 'case_2', input: { system: { product: PRODUCT }, user: 'vaka 2' } },
      { customId: 'case_3', input: { system: { product: PRODUCT }, user: 'vaka 3' } },
    ]);
    const done = await g.pollBatch(batch.id, { sleep: async () => undefined });
    expect(done.processing_status).toBe('ended');
    const results = await g.collectBatch('eval_judge', batch.id, meta);
    expect(results.map((r) => [r.customId, r.status])).toEqual([
      ['case_1', 'ok'],
      ['case_2', 'bad_output'],
      ['case_3', 'refusal'],
    ]);
    expect(c.isValid(results[0]?.data)).toBe(true);
    expect(results[2]?.refusal?.category).toBe('general_harms');
    expect(ledger.rows.every((r) => r.batch)).toBe(true);
    expect(ledger.rows[0]?.student_ref).toBe(SREF);
    expect(ledger.rows[2]?.error_code).toBe('general_harms');
  });

  it('sync rota call ile, batch rota submitBatch ile; istemci araçlı rota Batch\'e gitmez', async () => {
    const { gateway } = setup();
    await expect(gateway.call('eval_judge', { system: { product: PRODUCT }, user: 'x' })).rejects.toBeInstanceOf(RouteConfigError);
    await expect(gateway.submitBatch('page_class', [{ customId: 'a', input: { system: { product: PRODUCT }, user: 'x' } }])).rejects.toBeInstanceOf(RouteConfigError);
    await expect(gateway.submitBatch('eval_judge', [{ customId: 'geçersiz id', input: { system: { product: PRODUCT }, user: 'x' } }])).rejects.toBeInstanceOf(RouteConfigError);
  });
});
