// @vitest-environment node
// Koç sohbeti sunucu tarafı: istek gövdesi (3 system blok + tur sistem mesajı, araç listesi, model/effort), mod
// kuralı, araç döngüsünün kalıcılaştırılması, geçmiş öneki, ret → yönlendirme, ekler ve "Koça sor" bağlamı.
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { FakeTransport, Gateway, InMemoryLedger } from '@ogrenmen/llm';
import { loadPrompt } from '@ogrenmen/prompts';
import {
  buildHistory,
  MEDIA_BUDGET_B64,
  sanitizeHistory,
  SEED_PREFIX,
  steppedStart,
  SUMMARY_PREFIX,
  toDisplay,
  uploadBlock,
  windowMessages,
  type BetaMessageParam,
} from '@/server/chat/history';
import { pdfPageCount, sniffMime } from '@/server/chat/mime';
import { DEMO_COURSE_BLOCK, DEMO_DOSSIER_BLOCK, DEMO_SEED_ID, MemoryChatStore } from '@/server/chat/memory-store';
import { assertBodySize, assertJsonBody, assertSameOrigin, CHAT_BODY_MAX, parseChatRequest, UPLOAD_BODY_MAX, uploadKindFor } from '@/server/chat/request';
import { encodeEvent } from '@/server/chat/sse';
import { storeKindFor } from '@/server/chat/store-kind';
import { checkDbRole } from '@/server/chat/deps';
import { ChatError, executeTurn, prepareTurn, type ChatEvent, type TurnDeps } from '@/server/chat/turn';
import type { ChatStudent, StoredMessage } from '@/server/chat/types';
import { parseSseChunk } from '@/components/chat/sse-client';

const PROFILE = '00000000-0000-4000-8000-000000000001';
const NOW = new Date('2026-11-03T09:30:00+03:00');

async function setup() {
  const fake = new FakeTransport();
  const store = new MemoryChatStore({ isolated: true });
  const ledger = new InMemoryLedger();
  const gateway = new Gateway({ transport: fake, ledger });
  const p = loadPrompt('coach_chat');
  const product = (route: 'coach_chat' | 'coach_deep') => {
    const x = loadPrompt(route);
    return { text: x.text, version: x.meta.version };
  };
  const deps: TurnDeps = { store, gateway, product, now: () => NOW };
  const student = (await store.resolveStudent(PROFILE)) as ChatStudent;
  return { fake, store, ledger, deps, student, prompt: p };
}

async function turn(deps: TurnDeps, student: ChatStudent, over: Partial<Parameters<typeof prepareTurn>[1]> = {}) {
  const prepared = await prepareTurn(deps, { student, conversationId: null, text: 'Merhaba', uploadIds: [], mode: null, seedId: null, ...over });
  const events: ChatEvent[] = [];
  await executeTurn(deps, prepared, (e) => events.push(e));
  return { prepared, events, done: events.find((e) => e.type === 'done') as Extract<ChatEvent, { type: 'done' }> | undefined };
}

describe('koç turu: istek gövdesi', () => {
  it('3 system blok (1sa · 1sa · 5dk) + sona tur sistem mesajı; Sonnet 5.5 · medium; araçlar sıralı', async () => {
    const { fake, deps, student, prompt } = await setup();
    const { done } = await turn(deps, student, { text: 'Kesirlerde neredeyim?', mode: 'explain' });
    expect(done?.text).toMatch(/Sahte yanıt/);
    const req = fake.requests[0]!;
    expect(req.kind).toBe('stream');
    expect(req.route).toBe('coach_chat');
    const body = req.body;
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(body.output_config).toEqual({ effort: 'medium' });
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('tool_choice');
    const system = body.system as { type: string; text: string; cache_control?: { type: string; ttl?: string } }[];
    expect(system).toHaveLength(3);
    expect(system[0]!.text).toBe(prompt.text);
    expect(system[0]!.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(system[1]!.text).toBe(DEMO_COURSE_BLOCK);
    expect(system[1]!.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(system[2]!.text).toBe(DEMO_DOSSIER_BLOCK);
    expect(system[2]!.cache_control).toEqual({ type: 'ephemeral' });
    // Tarih/mod system bloklarında değil, son mesajda.
    expect(system.map((b) => b.text).join('\n')).not.toMatch(/Bugün 2026/);
    const last = body.messages[body.messages.length - 1]!;
    expect(last.role).toBe('system');
    expect(last.content).toBe('Bugün 2026-11-03. Mod: açıkla.');
    expect(body.messages[body.messages.length - 2]).toEqual({ role: 'user', content: [{ type: 'text', text: 'Kesirlerde neredeyim?' }] });
    expect(body.cache_control).toEqual({ type: 'ephemeral' });
    const tools = (body.tools ?? []) as { name: string; type?: string }[];
    expect(tools.map((t) => t.name)).toEqual(['get_mastery', 'get_recent_exams', 'memory', 'record_turn_meta', 'search_evidence']);
    expect(tools.find((t) => t.name === 'memory')?.type).toBe('memory_20250818');
  });

  it('mod verilmezse sohbetin modu (varsayılan ipucu) kullanılır', async () => {
    const { fake, deps, student } = await setup();
    await turn(deps, student);
    const msgs = fake.requests[0]!.body.messages;
    expect(msgs[msgs.length - 1]!.content).toBe('Bugün 2026-11-03. Mod: ipucu.');
  });

  it('ders kaydı yoksa yalnız ürün bloğu gider', async () => {
    const { fake, deps, student } = await setup();
    await turn(deps, { ...student, courseId: null });
    expect(fake.requests[0]!.body.system as unknown[]).toHaveLength(1);
  });
});

describe('koç turu: mod kuralı ve araç döngüsü', () => {
  it('öğrenci modu değiştirir; modelin önerisi modu değiştirmez, yalnız öneri olarak döner', async () => {
    const { fake, store, deps, student } = await setup();
    fake.enqueue(
      'coach_deep',
      {
        text: 'Kayıtlarına bakıyorum.',
        toolUses: [
          { name: 'get_mastery', input: {} },
          {
            name: 'record_turn_meta',
            input: { skill_ids: ['tyt.mat.denklem.birinci-derece'], misconception_tags: ['isaret-dagitma'], mode_suggestion: 'explain', escalate_to_instructor: false, confidence: 0.8 },
          },
        ],
      },
      { text: 'Parantezi açarken $-3 \\cdot -2$ çarpımına bak. Sonuç artı mı, eksi mi?' },
    );
    const { prepared, events, done } = await turn(deps, student, { text: 'Bunu nasıl çözerim?', mode: 'solve' });
    expect(done?.modeSuggestion).toBe('explain');
    expect(events.filter((e) => e.type === 'tool').map((e) => (e as { name: string }).name)).toEqual(['get_mastery', 'record_turn_meta']);
    const conv = await store.getConversation(student, prepared.conversation.id);
    expect(conv?.mode).toBe('solve');
    // İkinci istek araç sonuçlarını taşır; get_mastery çalıştırıcısı bantlı çıktı döndü.
    const second = fake.requests[1]!.body.messages;
    const results = second[second.length - 1]!.content as { type: string; content: string; tool_use_id: string }[];
    expect(results.map((r) => r.type)).toEqual(['tool_result', 'tool_result']);
    expect(results[0]!.content).toContain('zayıf');
    // Kayıt: kullanıcı, tur sistem mesajı, asistan (araç), kullanıcı (araç sonucu), asistan (son).
    const raw = store.rawMessages(prepared.conversation.id);
    expect(raw.map((m) => m.role)).toEqual(['user', 'system', 'assistant', 'user', 'assistant']);
    expect(raw[1]!.content).toEqual([{ type: 'text', text: 'Bugün 2026-11-03. Mod: çözümü göster.' }]);
    const final = raw[4]!;
    expect(final.llmCallId).toBe(2);
    expect(final.toolCalls?.turnMeta?.skill_ids).toEqual(['tyt.mat.denklem.birinci-derece']);
    expect(final.toolCalls?.calls.map((c) => c.name)).toEqual(['get_mastery', 'record_turn_meta']);
    // Ekranda yalnız öğrenci mesajı ve son yanıt.
    const display = toDisplay(raw as StoredMessage[]);
    expect(display.map((d) => d.from)).toEqual(['student', 'tutor']);
    expect(display[1]!.text).toMatch(/^Parantezi/);
  });

  it('ikinci turun geçmişi ilk turun gönderilen mesajlarıyla birebir aynı başlar (önbellek öneki)', async () => {
    const { fake, deps, student } = await setup();
    const first = await turn(deps, student, { text: 'İlk soru' });
    await turn(deps, student, { text: 'İkinci soru', conversationId: first.prepared.conversation.id });
    const a = fake.requests[0]!.body.messages;
    const b = fake.requests[1]!.body.messages;
    expect(b.slice(0, a.length)).toEqual(a);
    expect(b[a.length]!.role).toBe('assistant');
    expect(b[b.length - 1]!.content).toBe('Bugün 2026-11-03. Mod: ipucu.');
  });

  it('özet ve 30 mesaj penceresi: özet ilk kullanıcı mesajına eklenir, araç çifti bölünmez', async () => {
    const mk = (id: number, role: StoredMessage['role'], content: StoredMessage['content']): StoredMessage => ({ id, role, content, uploadIds: [], toolCalls: null, createdAt: '' });
    const msgs: StoredMessage[] = [];
    let id = 1;
    for (let i = 0; i < 8; i++) {
      msgs.push(mk(id++, 'user', [{ type: 'text', text: `soru ${i}` }]));
      msgs.push(mk(id++, 'system', [{ type: 'text', text: 'Bugün 2026-11-03. Mod: ipucu.' }]));
      msgs.push(mk(id++, 'assistant', [{ type: 'tool_use', id: `t${i}`, name: 'get_mastery', input: {} }]));
      msgs.push(mk(id++, 'user', [{ type: 'tool_result', tool_use_id: `t${i}`, content: '{}' }]));
      msgs.push(mk(id++, 'assistant', [{ type: 'text', text: `yanıt ${i}` }]));
    }
    const win = windowMessages(msgs, { limit: 30 });
    expect(win[0]!.role).toBe('user');
    expect(win[0]!.content[0]!.type).toBe('text');
    expect(win.length).toBeGreaterThanOrEqual(30);
    const hist = await buildHistory(msgs, 'Öğrenci kesirlerde payda eşitlemeyi çalıştı.', async () => null);
    const firstUser = hist[0]!;
    expect(firstUser.role).toBe('user');
    expect((firstUser.content as { text: string }[])[0]!.text).toBe(`${SUMMARY_PREFIX}\nÖğrenci kesirlerde payda eşitlemeyi çalıştı.`);
    expect(hist.filter((m) => m.role === 'system').every((m) => typeof m.content === 'string')).toBe(true);
  });
});

describe('koç turu: ret, ekler, teşhis bağlamı', () => {
  it('ret: kibar Türkçe ileti, eğitmene yönlendirme, kapanış asistan turu kaydedilir', async () => {
    const { fake, store, deps, student } = await setup();
    fake.enqueue('coach_chat', { stopReason: 'refusal', stopDetails: { category: 'cyber' } });
    const { prepared, done } = await turn(deps, student, { text: 'zararlı istek' });
    expect(done?.refusal).toBe(true);
    expect(done?.escalated).toBe(true);
    expect(done?.text).toMatch(/hocana sorman daha iyi/);
    expect(done?.text).not.toMatch(/!/);
    expect(store.escalations).toHaveLength(1);
    expect(store.escalations[0]).toMatchObject({ reason: 'refusal', category: 'cyber' });
    const raw = store.rawMessages(prepared.conversation.id);
    expect(raw[raw.length - 1]!.content).toEqual([{ type: 'text', text: done!.text }]);
    expect(raw[raw.length - 1]!.toolCalls?.refusal).toEqual({ category: 'cyber' });
    expect(toDisplay(raw as StoredMessage[]).at(-1)?.escalated).toBe(true);
  });

  it('koç turu escalate_to_instructor ile işaretlerse not düşülür', async () => {
    const { fake, store, deps, student } = await setup();
    fake.enqueue(
      'coach_chat',
      { toolUses: [{ name: 'record_turn_meta', input: { skill_ids: [], misconception_tags: [], mode_suggestion: null, escalate_to_instructor: true, confidence: 0.5, note: 'Sınav itirazı soruyor.' } }] },
      { text: 'Bunu hocana sorman daha iyi; hocan bu konuyu görecek.' },
    );
    const { done } = await turn(deps, student, { text: 'Bu soruya itiraz edebilir miyim?' });
    expect(done?.escalated).toBe(true);
    expect(store.escalations[0]).toMatchObject({ reason: 'turn_meta', note: 'Sınav itirazı soruyor.' });
  });

  it('fotoğraf eki: istekte base64 görsel, kayıtta yükleme başvurusu', async () => {
    const { fake, store, deps, student } = await setup();
    const up = await store.saveUpload(student, { mime: 'image/png', kind: 'photo', data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) });
    const { prepared } = await turn(deps, student, { text: 'Bu soruda nerede yanlış yaptım?', uploadIds: [up.id] });
    const msgs = fake.requests[0]!.body.messages;
    const user = msgs[msgs.length - 2]!.content as { type: string; source?: { type: string; media_type?: string; data?: string } }[];
    expect(user[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64') } });
    const raw = store.rawMessages(prepared.conversation.id);
    expect(raw[0]!.content[0]).toEqual({ type: 'image', source: { type: 'upload', upload_id: up.id } });
    expect(raw[0]!.uploadIds).toEqual([up.id]);
    expect(JSON.stringify(raw)).not.toContain('iVBORw');
    expect(toDisplay(raw as StoredMessage[])[0]!.attachments).toEqual([{ id: up.id, kind: 'photo' }]);
  });

  it('başka öğrencinin eki ve bilinmeyen sohbet reddedilir (akış başlamadan)', async () => {
    const { store, deps, student } = await setup();
    const other = (await store.resolveStudent('00000000-0000-4000-8000-000000000099')) as ChatStudent;
    const up = await store.saveUpload(other, { mime: 'image/png', kind: 'photo', data: new Uint8Array([1]) });
    await expect(prepareTurn(deps, { student, conversationId: null, text: 'x', uploadIds: [up.id], mode: null, seedId: null })).rejects.toMatchObject({ code: 'upload_not_found', status: 404 });
    await expect(
      prepareTurn(deps, { student, conversationId: '11111111-1111-4111-8111-111111111111', text: 'x', uploadIds: [], mode: null, seedId: null }),
    ).rejects.toBeInstanceOf(ChatError);
    await expect(prepareTurn(deps, { student, conversationId: null, text: '   ', uploadIds: [], mode: null, seedId: null })).rejects.toMatchObject({ code: 'empty' });
  });

  it('Koça sor: teşhis bağlamı modele gider, ekranda gizli kalır', async () => {
    const { fake, store, deps, student } = await setup();
    const { prepared } = await turn(deps, student, { text: 'Bu soruda nerede yanlış yaptım?', seedId: DEMO_SEED_ID });
    const msgs = fake.requests[0]!.body.messages;
    const user = msgs[msgs.length - 2]!.content as { type: string; text: string }[];
    expect(user.map((b) => b.type)).toEqual(['text', 'text']);
    expect(user[1]!.text.startsWith(SEED_PREFIX)).toBe(true);
    expect(user[1]!.text).toContain('İlk bozulan adım: 3');
    expect(user[1]!.text).toContain('Hata nedeni: işlem');
    const d = toDisplay(store.rawMessages(prepared.conversation.id) as StoredMessage[]);
    expect(d[0]).toMatchObject({ from: 'student', text: 'Bu soruda nerede yanlış yaptım?', seeded: true });
    await expect(prepareTurn(deps, { student, conversationId: null, text: 'x', uploadIds: [], mode: null, seedId: '22222222-2222-4222-8222-222222222222' })).rejects.toMatchObject({ code: 'seed_not_found' });
  });

  it('LLM hatası: kullanıcı turu kalır, sade hata olayı döner', async () => {
    const { fake, store, deps, student } = await setup();
    fake.enqueue('coach_chat', { error: new Error('bağlantı koptu') });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { prepared, events } = await turn(deps, student, { text: 'Merhaba' });
    spy.mockRestore();
    expect(events.map((e) => e.type)).toEqual(['start', 'error']);
    expect((events[1] as { message: string }).message).toBe('Koç şu an yanıt veremedi. Biraz sonra yeniden dene.');
    expect(store.rawMessages(prepared.conversation.id).map((m) => m.role)).toEqual(['user']);
  });
});

describe('istek, akış ve yapılandırma', () => {
  it('gövde doğrulaması', () => {
    expect(parseChatRequest({ text: 'a', mode: 'hint' })).toEqual({ conversationId: null, text: 'a', uploadIds: [], mode: 'hint', seedId: null });
    expect(() => parseChatRequest({ text: 'a'.repeat(4001) })).toThrow(/çok uzun/);
    expect(() => parseChatRequest({ text: 'a', mode: 'cheat' })).toThrow(ChatError);
    expect(() => parseChatRequest({ upload_ids: ['x'] })).toThrow(ChatError);
    expect(() => parseChatRequest(null)).toThrow(ChatError);
    const jpeg = new Uint8Array(1000);
    jpeg.set([0xff, 0xd8, 0xff, 0xe0]);
    expect(uploadKindFor(jpeg)).toEqual({ kind: 'photo', mime: 'image/jpeg' });
    expect(uploadKindFor(Buffer.from('%PDF-1.7\n1 0 obj << /Type /Page >> endobj'))).toEqual({ kind: 'pdf', mime: 'application/pdf' });
    // HEIC ve HTML: tür baytlardan çözülür, istemcinin "image/jpeg" demesi işe yaramaz.
    expect(() => uploadKindFor(Buffer.from('<html><script>alert(1)</script></html>'))).toThrow(/JPEG/);
    const big = new Uint8Array(4 * 1024 * 1024);
    big.set([0xff, 0xd8, 0xff]);
    expect(() => uploadKindFor(big)).toThrow(/büyük/);
    const longPdf = Buffer.from('%PDF-1.7\n' + '<< /Type /Page >>\n'.repeat(101) + '<< /Type /Pages >>');
    expect(pdfPageCount(longPdf)).toBe(101);
    expect(() => uploadKindFor(longPdf)).toThrow(/100 sayfa/);
    const bigPdf = new Uint8Array(5 * 1024 * 1024);
    bigPdf.set(Buffer.from('%PDF-'));
    expect(() => uploadKindFor(bigPdf)).toThrow(/4 MB/);
  });

  it('rota kapıları: aynı köken (403), yalnız JSON (415), gövde boyu Content-Length ile gövde okunmadan (411/413)', () => {
    const req = (headers: Record<string, string>, url = 'http://localhost:3000/api/chat') => new Request(url, { method: 'POST', headers });
    const site = { NEXT_PUBLIC_SITE_URL: 'https://ogrenmen.app' };
    const code = (fn: () => void) => {
      try {
        fn();
        return 'ok';
      } catch (e) {
        return (e as ChatError).code;
      }
    };
    expect(code(() => assertSameOrigin(req({}), site))).toBe('ok');
    expect(code(() => assertSameOrigin(req({ origin: 'http://localhost:3000' }), site))).toBe('ok');
    expect(code(() => assertSameOrigin(req({ origin: 'https://ogrenmen.app' }), site))).toBe('ok');
    expect(code(() => assertSameOrigin(req({ origin: 'https://ogrenmen.app', host: 'web.internal:8080' }, 'http://web.internal:8080/api/chat'), site))).toBe('ok');
    expect(code(() => assertSameOrigin(req({ origin: 'https://kotu.example' }), site))).toBe('forbidden_origin');
    expect(code(() => assertSameOrigin(req({ origin: 'null' }), site))).toBe('forbidden_origin');
    expect(code(() => assertSameOrigin(req({ 'sec-fetch-site': 'cross-site' }), site))).toBe('forbidden_origin');
    expect(code(() => assertJsonBody(req({ 'content-type': 'application/json; charset=utf-8' })))).toBe('ok');
    expect(code(() => assertJsonBody(req({ 'content-type': 'text/plain' })))).toBe('unsupported_media_type');
    expect(code(() => assertJsonBody(req({})))).toBe('unsupported_media_type');
    expect(code(() => assertBodySize(req({ 'content-length': String(CHAT_BODY_MAX) }), CHAT_BODY_MAX, 'x'))).toBe('ok');
    expect(code(() => assertBodySize(req({ 'content-length': String(CHAT_BODY_MAX + 1) }), CHAT_BODY_MAX, 'x'))).toBe('file_too_large');
    expect(code(() => assertBodySize(req({}), CHAT_BODY_MAX, 'x'))).toBe('ok');
    expect(code(() => assertBodySize(req({}), UPLOAD_BODY_MAX, 'x', { required: true }))).toBe('length_required');
    expect(code(() => assertBodySize(req({ 'content-length': String(5 * 1024 * 1024) }), UPLOAD_BODY_MAX, 'x', { required: true }))).toBe('file_too_large');
    expect(code(() => assertBodySize(req({ 'content-length': '4194304' }), UPLOAD_BODY_MAX, 'x', { required: true }))).toBe('ok');
    expect(code(() => assertBodySize(req({ 'content-length': 'abc' }), UPLOAD_BODY_MAX, 'x', { required: true }))).toBe('bad_request');
  });

  it('SSE kodlama ↔ ayrıştırma', () => {
    const wire = encodeEvent({ type: 'text', text: 'a\nb' }) + encodeEvent({ type: 'done', messageId: 3, text: 'x', refusal: false, escalated: false, modeSuggestion: null });
    const half = wire.slice(0, 20);
    expect(parseSseChunk(half).events).toEqual([]);
    const { events, rest } = parseSseChunk(wire);
    expect(rest).toBe('');
    expect(events).toEqual([
      { event: 'text', data: { text: 'a\nb' } },
      { event: 'done', data: { messageId: 3, text: 'x', refusal: false, escalated: false, modeSuggestion: null } },
    ]);
  });

  it('depo seçimi: bellek deposu yalnız sahte LLM ile', () => {
    expect(storeKindFor({ OGRENMEN_CHAT_STORE: 'memory', OGRENMEN_LLM: 'fake' })).toBe('memory');
    expect(() => storeKindFor({ OGRENMEN_CHAT_STORE: 'memory' })).toThrow(ChatError);
    expect(storeKindFor({ OGRENMEN_WEB_COACH_DATABASE_URL: 'postgresql://x' })).toBe('pg');
    // Depo genelindeki yönetici adresi koçu açmaz.
    expect(storeKindFor({ OGRENMEN_DATABASE_URL: 'postgresql://postgres@x' })).toBeNull();
    expect(storeKindFor({})).toBeNull();
  });
});

describe('koç turu: rota, tur kilidi, pencere ve ek bütçesi', () => {
  it('Çözümü göster: coach_deep (Opus 5.5 · high, thinking alanı yok), ürün metni ve tur kaydı rotayı taşır', async () => {
    const { fake, store, deps, student } = await setup();
    const { prepared } = await turn(deps, student, { text: 'Tam çözümü göster', mode: 'solve' });
    const req = fake.requests[0]!;
    expect(req.route).toBe('coach_deep');
    expect(req.body.model).toBe('claude-opus-5-5');
    expect(req.body.output_config).toEqual({ effort: 'high' });
    expect(req.body).not.toHaveProperty('thinking');
    expect((req.body.system as { text: string }[])[0]!.text).toBe(loadPrompt('coach_deep').text);
    const raw = store.rawMessages(prepared.conversation.id);
    expect(raw.at(-1)!.toolCalls?.route).toBe('coach_deep');
    // İpucu moduna dönünce yeniden Sonnet.
    await turn(deps, student, { text: 'Şimdi ipucu', mode: 'hint', conversationId: prepared.conversation.id });
    expect(fake.requests[1]!.route).toBe('coach_chat');
    expect(store.rawMessages(prepared.conversation.id).at(-1)!.toolCalls?.route).toBe('coach_chat');
  });

  it('önceki turların thinking blokları geçmişe girmez: özet, pencere kayması, dossier değişimi, ipucu → çözüm', async () => {
    const thinkingIn = (msgs: BetaMessageParam[]) =>
      msgs.filter((m) => Array.isArray(m.content) && (m.content as { type: string }[]).some((b) => b.type === 'thinking' || b.type === 'redacted_thinking')).length;
    const { fake, store, deps, student } = await setup();
    fake.enqueue('coach_chat', {
      thinking: 'Öğrenci işaret dağıtmada zorlanıyor.',
      toolUses: [{ name: 'get_mastery', input: {} }],
    }, { thinking: 'Kısa bir ipucu yeter.', text: 'Parantezin önündeki eksiyi her terime dağıt.' });
    const first = await turn(deps, student, { text: 'Bu denklemi çözemedim' });
    const conversationId = first.prepared.conversation.id;
    // Thinking kayıtta kalır (denetim), yalnız sonraki turların geçmişine konmaz; süren turun araç döngüsünde kalır.
    const raw = store.rawMessages(conversationId);
    expect(raw.filter((m) => m.role === 'assistant' && m.content.some((b) => b.type === 'thinking'))).toHaveLength(2);
    expect(thinkingIn(fake.requests[1]!.body.messages)).toBe(1);

    // (a) özet yazıldı
    const conv = store.state.conversations.get(conversationId)!;
    conv.summary = 'Öğrenci işaret dağıtmayı çalıştı.';
    await turn(deps, student, { text: 'Özetten sonra', conversationId });
    expect(thinkingIn(fake.requests.at(-1)!.body.messages)).toBe(0);
    conv.summary = null;

    // (b) pencere 45 mesajı geçip önden kaydı
    for (let i = 0; i < 16; i++) await turn(deps, student, { text: `soru ${i}`, conversationId });
    fake.enqueue('coach_chat', { thinking: 'Yeni tur.', text: 'Tamam.' });
    await turn(deps, student, { text: 'Kayan pencere', conversationId });
    await turn(deps, student, { text: 'Bir sonraki', conversationId });
    const last = fake.requests.at(-1)!.body.messages;
    expect(JSON.stringify(last[0])).not.toContain('Bu denklemi çözemedim');
    expect(thinkingIn(last)).toBe(0);

    // (c) dossier metni değişti
    const orig = store.systemBlocks.bind(store);
    store.systemBlocks = async (s, c) => ({ ...(await orig(s, c)), dossier: 'Yeni kanıt geldi: kesirlerde ilerleme var.' });
    fake.enqueue('coach_chat', { thinking: 'Dossier değişti.', text: 'Güzel.' });
    await turn(deps, student, { text: 'Dossier sonrası', conversationId });
    await turn(deps, student, { text: 'Bir daha', conversationId });
    expect((fake.requests.at(-1)!.body.system as { text: string }[])[2]!.text).toContain('Yeni kanıt');
    expect(thinkingIn(fake.requests.at(-1)!.body.messages)).toBe(0);

    // (d) ipucu → Çözümü göster (system[0] ve model değişir)
    await turn(deps, student, { text: 'Tam çözümü göster', mode: 'solve', conversationId });
    const deep = fake.requests.at(-1)!;
    expect(deep.route).toBe('coach_deep');
    expect(thinkingIn(deep.body.messages)).toBe(0);
    // Asistan araç çağrıları ve metinler kalır (yalnız thinking ayıklanır).
    expect(JSON.stringify(deep.body.messages)).toContain('"text":"Güzel."');
  });

  it('aynı sohbette iki tur aynı anda: ikincisi 409, kayıt sırası bozulmaz; bitince yeni tur açılır', async () => {
    const { fake, store, deps, student } = await setup();
    const first = await prepareTurn(deps, { student, conversationId: null, text: 'Birinci', uploadIds: [], mode: null, seedId: null });
    const convId = first.conversation.id;
    expect(await store.turnInProgress(convId)).toBe(true);
    const second = prepareTurn(deps, { student, conversationId: convId, text: 'İkinci', uploadIds: [], mode: null, seedId: null });
    await expect(second).rejects.toMatchObject({ code: 'turn_in_progress', status: 409, message: 'Koç önceki mesajına yanıt veriyor. Biraz bekle.' });
    // Paralel yürütme: ikinci istek akış başlamadan reddedilir, birincinin satırları bütün kalır.
    const events: ChatEvent[] = [];
    const [, rejected] = await Promise.allSettled([
      executeTurn(deps, first, (e) => events.push(e)),
      prepareTurn(deps, { student, conversationId: convId, text: 'Üçüncü', uploadIds: [], mode: null, seedId: null }),
    ]);
    expect(rejected.status).toBe('rejected');
    expect(events.at(-1)?.type).toBe('done');
    expect(await store.turnInProgress(convId)).toBe(false);
    expect(store.rawMessages(convId).map((m) => m.role)).toEqual(['user', 'system', 'assistant']);
    // Kilit bırakıldı: sonraki tur geçer; LLM hatasında da bırakılır.
    fake.enqueue('coach_chat', { error: new Error('koptu') });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await turn(deps, student, { conversationId: convId, text: 'Dördüncü' });
    spy.mockRestore();
    expect(await store.turnInProgress(convId)).toBe(false);
    await turn(deps, student, { conversationId: convId, text: 'Beşinci' });
    expect(fake.requests).toHaveLength(3);
  });

  it('güvenlik ağı: iç içe yazılmış iki turun sırası geçerli diziye ayıklanır', () => {
    const sys = (t: string) => ({ role: 'system', content: t }) as unknown as BetaMessageParam;
    const msgs: BetaMessageParam[] = [
      { role: 'user', content: [{ type: 'text', text: 'u1' }] },
      { role: 'user', content: [{ type: 'text', text: 'u2' }] },
      sys('Bugün. Mod: ipucu.'),
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'get_mastery', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{}' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'a1' }] },
      sys('Bugün. Mod: ipucu.'),
      { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'get_mastery', input: {} }] },
      { role: 'assistant', content: [{ type: 'text', text: 'a2' }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't9', content: '{}' }, { type: 'text', text: 'u3' }] },
    ];
    const out = sanitizeHistory(msgs);
    const roles = out.map((m) => m.role as string);
    expect(roles).toEqual(['user', 'user', 'system', 'assistant', 'user', 'assistant', 'assistant', 'user']);
    // system yalnız kullanıcı mesajından sonra; her tool_use'un hemen ardından eşi gelir.
    out.forEach((m, i) => {
      if ((m.role as string) === 'system') expect(out[i - 1]!.role).toBe('user');
      const blocks = Array.isArray(m.content) ? (m.content as { type: string; id?: string; tool_use_id?: string }[]) : [];
      for (const b of blocks.filter((x) => x.type === 'tool_use')) {
        const next = out[i + 1]!.content as { type: string; tool_use_id?: string }[];
        expect(next.some((x) => x.type === 'tool_result' && x.tool_use_id === b.id)).toBe(true);
      }
      for (const b of blocks.filter((x) => x.type === 'tool_result')) {
        const prev = out[i - 1]!.content as { type: string; id?: string }[];
        expect(prev.some((x) => x.type === 'tool_use' && x.id === b.tool_use_id)).toBe(true);
      }
    });
    expect(out.at(-1)!.content).toEqual([{ type: 'text', text: 'u3' }]);
  });

  it('kademeli pencere: 30 mesajı geçtikten sonra 5 turda başlangıç en çok bir kez değişir', async () => {
    expect([0, 30, 44, 45, 59, 60].map((n) => steppedStart(n))).toEqual([0, 0, 0, 15, 15, 30]);
    const { fake, deps, student } = await setup();
    const first = await turn(deps, student, { text: 'soru 0' });
    const conversationId = first.prepared.conversation.id;
    for (let i = 1; i < 25; i++) await turn(deps, student, { text: `soru ${i}`, conversationId });
    const starts = fake.requests.map((r) => JSON.stringify(r.body.messages[0]));
    // Tur başına 3 satır: 11. turdan (30 mesaj) sonra her 5 turluk dilimde en çok bir değişim.
    for (let k = 10; k + 5 <= starts.length; k++) {
      const slice = starts.slice(k, k + 5);
      const changes = slice.filter((x, j) => j > 0 && x !== slice[j - 1]).length;
      expect(changes).toBeLessThanOrEqual(1);
    }
    // Değişmeyen başlangıçta bir sonraki istek öncekinin mesajlarıyla birebir başlar (önbellek öneki).
    const a = fake.requests[11]!.body.messages;
    const b = fake.requests[12]!.body.messages;
    if (starts[11] === starts[12]) expect(b.slice(0, a.length - 1)).toEqual(a.slice(0, a.length - 1));
    // Pencere hep bir kullanıcı turuyla başlar ve 45 mesajı geçmez.
    for (const r of fake.requests) {
      expect(r.body.messages[0]!.role).toBe('user');
      expect(r.body.messages.length).toBeLessThanOrEqual(45 + 2);
    }
  });

  it('ek bütçesi: geçmişte üç 16 MB PDF varken istek gövdesi 32 MB altında, ekler bütçede kalır', async () => {
    const { fake, store, deps, student } = await setup();
    const conv = await store.createConversation(student, 'hint');
    for (let i = 0; i < 3; i++) {
      const data = new Uint8Array(16 * 1024 * 1024);
      data.set(Buffer.from(`%PDF-1.7 ${i}`));
      const up = await store.saveUpload(student, { mime: 'application/pdf', kind: 'pdf', data });
      await store.appendMessages(conv.id, [
        { role: 'user', content: [{ type: 'document', source: { type: 'upload', upload_id: up.id } }, { type: 'text', text: `PDF ${i}` }], uploadIds: [up.id] },
        { role: 'system', content: [{ type: 'text', text: 'Bugün 2026-11-03. Mod: ipucu.' }] },
        { role: 'assistant', content: [{ type: 'text', text: `yanıt ${i}` }] },
      ]);
    }
    await turn(deps, student, { conversationId: conv.id, text: 'Son PDF neydi?' });
    const body = fake.requests[0]!.body;
    expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThan(32 * 1024 * 1024);
    const docs = body.messages.flatMap((m) => (Array.isArray(m.content) ? (m.content as { type: string; source?: { data?: string } }[]) : []).filter((b) => b.type === 'document'));
    const b64 = docs.reduce((n, d) => n + (d.source?.data?.length ?? 0), 0);
    expect(b64).toBeLessThanOrEqual(MEDIA_BUDGET_B64);
    // Önden düşülür: kalan geçmiş bir kullanıcı turuyla başlar, ortadan ek çıkarılmaz (yer tutucu yok).
    expect(body.messages[0]!.role).toBe('user');
    expect(JSON.stringify(body.messages)).not.toContain('[Bu ek artık okunamıyor]');
    // Sığan eklerde: en yeni turlar kalır, eskiler önden düşer; yeni ek eklenmedikçe başlangıç sabit.
    const m = (role: StoredMessage['role'], up: boolean) => ({ role, content: up ? [{ type: 'document', source: { type: 'upload', upload_id: 'x' } }] : [{ type: 'text', text: 'a' }] });
    const seq = [m('user', true), m('system', false), m('assistant', false), m('user', true), m('system', false), m('assistant', false), m('user', false), m('system', false), m('assistant', false)];
    const mediaSize = (x: { content: { type: string }[] }) => (x.content[0]!.type === 'document' ? 13 * 1024 * 1024 : 0);
    expect(windowMessages(seq, { mediaSize })).toEqual(seq.slice(3));
    expect(windowMessages(seq.slice(0, 6), { mediaSize })).toEqual(seq.slice(3, 6));
    expect(windowMessages(seq.slice(0, 3), { mediaSize, reserve: 13 * 1024 * 1024 })).toEqual([]);
    // Tek turda bütçeyi aşan ekler akış başlamadan reddedilir.
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const data = new Uint8Array(7 * 1024 * 1024);
      data.set(Buffer.from('%PDF-1.7'));
      ids.push((await store.saveUpload(student, { mime: 'application/pdf', kind: 'pdf', data })).id);
    }
    await expect(prepareTurn(deps, { student, conversationId: conv.id, text: 'x', uploadIds: ids, mode: null, seedId: null })).rejects.toMatchObject({
      code: 'uploads_too_large',
      status: 413,
    });
  });

  it('ek türü baytlardan: .jpg diye saklanan PNG png gider; tanınmayan tür modele gitmez', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
    expect(sniffMime(png)).toBe('image/png');
    const row = { id: 'u', kind: 'photo' as const, mime: 'image/jpeg', storagePath: 'x', anthropicFileId: null, bytes: png.length };
    expect(uploadBlock(row, png)).toMatchObject({ type: 'image', source: { media_type: 'image/png' } });
    expect(uploadBlock({ ...row, mime: 'text/html' }, Buffer.from('<html></html>'))).toBeNull();
    expect(uploadBlock({ ...row, kind: 'pdf', mime: 'application/pdf' }, png)).toBeNull();
  });
});

describe('sunucu bağlantı rolü', () => {
  const db = (row: { rolsuper: boolean; rolbypassrls: boolean }) => ({ query: async () => ({ rows: [{ name: 'r', ...row }] }) }) as never;
  it('kapalı başarısızlık: RLS aşan rol üretimde hep, yerelde bayraksız reddedilir; RLS’e tabi rol geçer', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const refused = { code: 'misconfigured', status: 503 };
    const prod = { NODE_ENV: 'production' };
    const flag = { OGRENMEN_WEB_COACH_TRUSTED_DEV: '1' };
    await expect(checkDbRole(db({ rolsuper: true, rolbypassrls: true }), prod)).rejects.toMatchObject(refused);
    await expect(checkDbRole(db({ rolsuper: false, rolbypassrls: true }), prod)).rejects.toMatchObject(refused);
    // Üretimde bayrak açamaz.
    await expect(checkDbRole(db({ rolsuper: false, rolbypassrls: true }), { ...prod, ...flag })).rejects.toMatchObject(refused);
    expect(err.mock.calls.at(-1)?.[0]).toMatch(/OGR-CHAT-011/);
    // Yerel: bayraksız reddedilir, bayrakla uyarıyla açılır.
    await expect(checkDbRole(db({ rolsuper: true, rolbypassrls: true }), { NODE_ENV: 'development' })).rejects.toMatchObject(refused);
    expect(err.mock.calls.at(-1)?.[0]).toMatch(/OGR-CHAT-014/);
    await checkDbRole(db({ rolsuper: true, rolbypassrls: true }), { NODE_ENV: 'development', ...flag });
    expect(warn.mock.calls.at(-1)?.[0]).toMatch(/OGR-CHAT-012/);
    warn.mockClear();
    // RLS'e tabi rol sessiz geçer.
    await checkDbRole(db({ rolsuper: false, rolbypassrls: false }), prod);
    expect(warn).not.toHaveBeenCalled();
    // Rol satırı yoksa da kapalı.
    await expect(checkDbRole({ query: async () => ({ rows: [] }) } as never, prod)).rejects.toMatchObject(refused);
    err.mockRestore();
    warn.mockRestore();
  });
});
