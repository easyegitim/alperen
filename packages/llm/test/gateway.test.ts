import { describe, expect, it, vi } from 'vitest';
import { BadRequestError, RateLimitError } from '@anthropic-ai/sdk';
import { contractRegistry, type Contract } from '@ogrenmen/contracts';
import { createTransport } from '../src/client.js';
import { RouteConfigError, StudentRefError, ToolLoopError } from '../src/errors.js';
import { FakeTransport } from '../src/fake.js';
import { createGateway, Gateway } from '../src/gateway.js';
import { FALLBACK_BETA } from '../src/client.js';
import { assertBreakpoints } from '../src/prompt.js';
import { costUsd, usageFromApi } from '../src/pricing.js';
import { buildLedgerRow, InMemoryLedger, LEDGER_INSERT_SQL, PgLedger, RpcLedger, toLedgerRecord, type LedgerWriter } from '../src/ledger.js';
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

  it('gerçek taşımada ledger zorunlu (sessiz InMemoryLedger yok)', async () => {
    const transport = await createTransport({ kind: 'anthropic', env: { ANTHROPIC_API_KEY: 'x' } });
    await expect(createGateway({ transport })).rejects.toBeInstanceOf(RouteConfigError);
    const ledger = new RpcLedger({ rpc: async () => ({ data: 1, error: null }) });
    expect((await createGateway({ transport, ledger })).ledger).toBe(ledger);
  });
});

describe('sahte taşıma', () => {
  it.each(ROUTE_NAMES.filter((n) => ROUTES[n].schema !== null))('%s: şemaya uygun örnek döner', (route) => {
    const fake = new FakeTransport();
    const c = contractRegistry[ROUTES[route].schema as keyof typeof contractRegistry] as Contract;
    expect(c.isValid(fake.sampleFor(route, c))).toBe(true);
  });

  it('kayıtlı v2 rota fikstürünü okur (packages/llm/fixtures/lesson_analysis/)', () => {
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

describe('veli sohbeti', () => {
  it('6 strict araç; araç önekiyle birlikte önbellek: ikinci turda cache_read > 0, araç listesi aynı', async () => {
    const { gateway, fake } = setup();
    const runners = {
      get_recent_activity: ({ days }: { days?: number }) => `son ${days ?? 7} gün: 4 oturum`,
      get_exam_sessions: ({ limit }: { limit?: number }) => `son ${limit ?? 5} deneme: 72 net`,
    };
    fake.enqueue('parent_chat', { toolUses: [{ name: 'get_recent_activity', input: { days: 7 } }, { name: 'get_exam_sessions', input: {} }] }, { text: 'Bu hafta 4 oturum çalıştı.' });
    const input = { system: { product: PRODUCT, course: COURSE, dossier: DOSSIER }, user: 'Bu hafta ne yaptı?', tools: { runners } };
    const first = await gateway.call('parent_chat', input);
    expect(first.toolCalls.map((t) => [t.name, t.isError])).toEqual([
      ['get_recent_activity', false],
      ['get_exam_sessions', false],
    ]);
    const second = await gateway.call('parent_chat', { ...input, user: 'Denemesi nasıldı?' });
    expect(second.usage.cacheRead).toBeGreaterThan(0);
    const toolLists = fake.requests.map((r) => JSON.stringify(r.body.tools));
    expect(new Set(toolLists).size).toBe(1);
    // strict şemaya uymayan girdi (days 1..30) zod ile reddedilir; çalıştırıcı çağrılmaz
    fake.enqueue('parent_chat', { toolUses: [{ name: 'get_recent_activity', input: { days: 90 } }] }, { text: 'tamam' });
    const third = await gateway.call('parent_chat', { ...input, user: 'Son 90 gün?' });
    expect(third.toolCalls[0]).toMatchObject({ name: 'get_recent_activity', isError: true });
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

  it('geçersiz studentRef API isteğinden önce reddedilir (ücretli istek yok, yanıt kaybı yok)', async () => {
    const { gateway, fake, ledger } = setup();
    await expect(
      gateway.call('page_class', { system: { product: PRODUCT }, user: 'x', studentRef: '11111111-1111-4111-8111-111111111111' }),
    ).rejects.toBeInstanceOf(StudentRefError);
    await expect(
      gateway.submitBatch('eval_judge', [
        { customId: 'a', input: { system: { product: PRODUCT }, user: 'x', studentRef: SREF } },
        { customId: 'b', input: { system: { product: PRODUCT }, user: 'x', studentRef: 'Ayşe Yılmaz' } },
      ]),
    ).rejects.toBeInstanceOf(StudentRefError);
    expect(fake.requests).toHaveLength(0);
    expect(ledger.rows).toHaveLength(0);
  });

  it('defter yazıcısı fırlatsa da asıl API hatası korunur; başarılı yanıt kaybolmaz', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const throwing: LedgerWriter = { write: async () => { throw new Error('defter düştü'); } };
    const fake = new FakeTransport();
    const g = new Gateway({ transport: fake, ledger: throwing });
    fake.enqueue('page_class', { error: new RateLimitError(429, { type: 'error', error: { type: 'rate_limit_error', message: 'yavaş' } }, 'yavaş', new Headers()) });
    await expect(g.call('page_class', { system: { product: PRODUCT }, user: 'x' })).rejects.toBeInstanceOf(RateLimitError);
    const ok = await g.call('notification_copy', { system: { product: PRODUCT }, user: 'deneme bitti' });
    expect(ok.data).not.toBeNull();
    expect(ok.ledgerIds).toEqual([]);
    expect(String(logged.mock.calls[0]?.[0])).toContain('OGR-LLM-009');
    logged.mockRestore();
  });

  it('RpcLedger: log_llm_call(p_call) sütunlarla aynı kayıt; hata çağrıyı düşürmez', async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const ok = new RpcLedger({ rpc: async (fn, args) => { calls.push({ fn, args }); return { data: '7', error: null }; } });
    const row = buildLedgerRow({ route: 'parent_chat', model: 'claude-sonnet-5-5', effort: 'low', usage: { input: 10, output: 5, cacheRead: 2, cacheWrite5m: 1, cacheWrite1h: 0 }, batch: false, status: 'refusal', stopReason: 'refusal', costUsd: 0.0001, studentRef: SREF });
    expect(await ok.write(row)).toBe(7);
    expect(calls).toEqual([{ fn: 'log_llm_call', args: { p_call: toLedgerRecord(row) } }]);
    const rec = calls[0]?.args.p_call as Record<string, unknown>;
    expect(rec.error_code).toBe('refusal');
    expect('stop_reason' in rec).toBe(false);
    const errs: unknown[] = [];
    const bad = new RpcLedger({ rpc: async () => ({ data: null, error: { message: 'OGR-AUTH-002 LLM defterine yalnız worker ve personel yazar' } }) }, (e) => errs.push(e));
    expect(await bad.write(row)).toBeNull();
    expect(String(errs[0])).toContain('OGR-AUTH-002');
  });

  it('Haiku: role:"system" 400 dönerse bir kez <system-reminder> yedeğiyle yeniden dener; sonra doğrudan yedek', async () => {
    const { gateway, fake, ledger } = setup();
    const err = new BadRequestError(400, { type: 'error', error: { type: 'invalid_request_error', message: "role 'system' is not supported on this model" } }, undefined, new Headers());
    fake.enqueue('memory_delta', { error: err });
    const input = { system: { product: PRODUCT }, user: 'tur bitti', turn: { date: '2026-11-02', mode: 'hint' as const } };
    const res = await gateway.call('memory_delta', input);
    expect(res.data).not.toBeNull();
    expect(fake.requests).toHaveLength(2);
    expect(fake.requests[0]?.body.messages.at(-1)?.role).toBe('system');
    expect(JSON.stringify(fake.requests[1]?.body.messages.at(-1))).toContain('<system-reminder>Bugün 2026-11-02. Mod: ipucu.</system-reminder>');
    expect(ledger.rows.map((r) => r.status)).toEqual(['error', 'ok']);
    expect(res.ledgerIds).toEqual([1, 2]);
    await gateway.call('memory_delta', input);
    expect(JSON.stringify(fake.requests[2]?.body.messages.at(-1))).toContain('<system-reminder>');
    // başka 400 hatası yeniden denenmez
    const { gateway: g2, fake: f2 } = setup();
    f2.enqueue('memory_delta', { error: new BadRequestError(400, { type: 'error', error: { type: 'invalid_request_error', message: 'max_tokens çok büyük' } }, undefined, new Headers()) });
    await expect(g2.call('memory_delta', input)).rejects.toBeInstanceOf(BadRequestError);
    expect(f2.requests).toHaveLength(1);
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

  it('geçersiz meta.studentRef sonuçları kesmez: satır student_ref=null, error_code=bad_student_ref', async () => {
    const fake = new FakeTransport();
    const ledger = new InMemoryLedger();
    const g = new Gateway({ transport: fake, ledger });
    const { batch } = await g.submitBatch('eval_judge', [
      { customId: 'a', input: { system: { product: PRODUCT }, user: 'vaka 1' } },
      { customId: 'b', input: { system: { product: PRODUCT }, user: 'vaka 2' } },
      { customId: 'c', input: { system: { product: PRODUCT }, user: 'vaka 3' } },
    ]);
    const results = await g.collectBatch('eval_judge', batch.id, { b: { studentRef: '11111111-1111-4111-8111-111111111111' }, c: { studentRef: SREF } });
    expect(results.map((r) => [r.customId, r.status])).toEqual([
      ['a', 'ok'],
      ['b', 'ok'],
      ['c', 'ok'],
    ]);
    expect(ledger.rows.map((r) => [r.student_ref, r.error_code])).toEqual([
      [null, null],
      [null, 'bad_student_ref'],
      [SREF, null],
    ]);
  });

  it('pause_turn (code_execution döngüsü durakladı): status=error, error=pause_turn; JSON hatası değil', async () => {
    const fake = new FakeTransport();
    const ledger = new InMemoryLedger();
    const g = new Gateway({ transport: fake, ledger });
    fake.enqueue('inferred_keys', { text: '', stopReason: 'pause_turn' });
    const { batch } = await g.submitBatch('inferred_keys', [{ customId: 'k1', input: { system: { product: PRODUCT, course: COURSE }, user: 'anahtar çıkar' } }]);
    const [r] = await g.collectBatch('inferred_keys', batch.id);
    expect(r).toMatchObject({ customId: 'k1', status: 'error', error: 'pause_turn', data: null });
    expect(ledger.rows[0]).toMatchObject({ status: 'error', error_code: 'pause_turn', batch: true });
    // yeniden gönderim: senkron call (batchRetry) pause_turn'ü sürdürür
    const ik = contractRegistry['inferred-keys'] as Contract;
    fake.enqueue('inferred_keys', { text: '', stopReason: 'pause_turn' }, { json: fake.sampleFor('inferred_keys', ik) });
    const retry = await g.call('inferred_keys', { system: { product: PRODUCT, course: COURSE }, user: 'anahtar çıkar', batchRetry: true });
    expect(ik.isValid(retry.data)).toBe(true);
    expect(ledger.rows.slice(1).map((x) => [x.batch, x.status])).toEqual([
      [false, 'ok'],
      [false, 'ok'],
    ]);
  });

  it('sync rota call ile, batch rota submitBatch ile; istemci araçlı rota Batch\'e gitmez', async () => {
    const { gateway } = setup();
    await expect(gateway.call('eval_judge', { system: { product: PRODUCT }, user: 'x' })).rejects.toBeInstanceOf(RouteConfigError);
    await expect(gateway.submitBatch('page_class', [{ customId: 'a', input: { system: { product: PRODUCT }, user: 'x' } }])).rejects.toBeInstanceOf(RouteConfigError);
    await expect(gateway.submitBatch('eval_judge', [{ customId: 'geçersiz id', input: { system: { product: PRODUCT }, user: 'x' } }])).rejects.toBeInstanceOf(RouteConfigError);
  });
});

describe('denetim düzeltmeleri (geçit)', () => {
  /** API sıra kuralları: son olmayan asistan turu boş olamaz; role:"system" ya sonda ya da ardından asistan gelir. */
  function assertValidHistory(messages: readonly { role: string; content: unknown }[]): void {
    messages.forEach((m, i) => {
      const last = i === messages.length - 1;
      if (m.role === 'assistant' && !last) {
        expect(Array.isArray(m.content) ? (m.content as unknown[]).length : String(m.content).length, `messages[${i}]`).toBeGreaterThan(0);
      }
      if (m.role === 'system' && !last) expect(messages[i + 1]?.role, `messages[${i + 1}]`).toBe('assistant');
    });
  }

  it('sohbet reddi: transkript kibar iletiyle kapanır; sonraki tur bu geçmişle geçerli istek kurar', async () => {
    const { gateway, fake } = setup();
    fake.enqueue('coach_chat', { stopReason: 'refusal', stopDetails: { category: 'bio' } });
    const input = { system: { product: PRODUCT, course: COURSE, dossier: DOSSIER }, user: 'soru', turn: { date: '2026-11-02', mode: 'hint' as const } };
    const res = await gateway.call('coach_chat', input);
    expect(res.transcript.map((m) => m.role)).toEqual(['user', 'system', 'assistant']);
    const last = res.transcript.at(-1);
    expect(last).toEqual({ role: 'assistant', content: [{ type: 'text', text: res.refusal?.user_message_tr }] });
    expect(res.refusal?.user_message_tr.length).toBeGreaterThan(0);

    fake.enqueue('coach_chat', { text: 'Kesirlere bakalım.' });
    const next = await gateway.call('coach_chat', { ...input, history: res.transcript, user: 'Kesirleri anlat' });
    const body = fake.requests[1]!.body;
    expect(() => assertBreakpoints(body)).not.toThrow();
    expect(body.messages.map((m) => m.role)).toEqual(['user', 'system', 'assistant', 'user', 'system']);
    assertValidHistory(body.messages as { role: string; content: unknown }[]);
    assertValidHistory(next.transcript as { role: string; content: unknown }[]);
  });

  it('ara akışta ret: reddedilen yarım çıktı transkripte girmez', async () => {
    const { gateway, fake } = setup();
    fake.enqueue('coach_chat', { text: 'Yarım kalan reddedilmiş metin', stopReason: 'refusal', stopDetails: { category: 'cyber' } });
    const res = await gateway.call('coach_chat', { system: { product: PRODUCT }, user: 'soru' });
    expect(JSON.stringify(res.transcript)).not.toContain('Yarım kalan');
    expect(res.transcript.at(-1)).toEqual({ role: 'assistant', content: [{ type: 'text', text: res.text }] });
    // ileti yalnız günlük için korunur
    expect(JSON.stringify(res.message.content)).toContain('Yarım kalan');
  });

  it('maliyet yanıtı veren modelle: msg.model=claude-opus-4-8, iterations yok → 5 / 25', async () => {
    const { gateway, fake, ledger } = setup();
    const usage = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null, iterations: null };
    fake.enqueue('coach_deep', { text: 'yanıt', model: 'claude-opus-4-8', usage });
    const res = await gateway.call('coach_deep', { system: { product: PRODUCT }, user: 'x' });
    const expected = costUsd('claude-opus-4-8', usageFromApi(usage));
    expect(expected).toBeCloseTo((1000 * 5 + 500 * 25) / 1_000_000, 9);
    expect(res.costUsd).toBe(expected);
    expect(ledger.rows[0]).toMatchObject({ model: 'claude-opus-4-8', cost_usd: expected });
  });

  it('yapılandırılmış rotada maxTokens < 4000 üzerine yazımı reddedilir', async () => {
    const { gateway, fake } = setup();
    expect(() => gateway.buildRequest('page_class', { system: { product: PRODUCT }, user: 'x', maxTokens: 1000 })).toThrow(RouteConfigError);
    await expect(gateway.call('page_class', { system: { product: PRODUCT }, user: 'x', maxTokens: 3999 })).rejects.toBeInstanceOf(RouteConfigError);
    expect(fake.requests).toHaveLength(0);
    // serbest metin rotasında sınır yok
    expect(gateway.buildRequest('coach_chat', { system: { product: PRODUCT }, user: 'x', maxTokens: 1000 }).max_tokens).toBe(1000);
  });

  it('batchRetry: Opus/Sonnet Batch rotasının senkron yeniden gönderimi fallbacks:"default" + beta taşır; Batch gövdesi taşımaz', () => {
    const { gateway } = setup();
    const input = { system: { product: PRODUCT, course: COURSE }, user: 'x' };
    const retry = gateway.buildRequest('inferred_keys', { ...input, batchRetry: true });
    expect(retry.fallbacks).toBe('default');
    expect(retry.betas).toEqual([FALLBACK_BETA]);
    const batch = gateway.buildRequest('inferred_keys', input, { batch: true });
    expect(batch).not.toHaveProperty('fallbacks');
    expect(batch).not.toHaveProperty('betas');
  });

  it('proposal_review Batch: proposal-review sözleşmesiyle doğrulanmış karar döner (rota fikstürü)', async () => {
    const { gateway } = setup();
    const { batch, meta } = await gateway.submitBatch('proposal_review', [{ customId: 'p1', input: { system: { product: PRODUCT, course: COURSE }, user: 'öneriler' } }]);
    const [r] = await gateway.collectBatch('proposal_review', batch.id, meta);
    expect(r?.status).toBe('ok');
    expect(r?.data?.decisions.map((d) => [d.proposal_id, d.action])).toEqual([
      ['33333333-3333-4333-8333-333333333333', 'accept'],
      ['44444444-4444-4444-8444-444444444444', 'reject'],
    ]);
  });

  it('style_question_gen: style-question-generation (zorunlu style_id, ayrı anahtar)', async () => {
    const { gateway } = setup();
    const res = await gateway.call('style_question_gen', { system: { product: PRODUCT, course: COURSE }, user: 'tarz T1 için 2 soru' });
    expect(res.data.items.length).toBeGreaterThan(0);
    expect(res.data.items.every((it) => typeof it.style_id === 'string')).toBe(true);
    expect(res.data.keys.length).toBe(res.data.items.length);
  });
});
