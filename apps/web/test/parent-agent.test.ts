// @vitest-environment node
// Veli ajanı sunucu tarafı (src/server/parent): istek gövdesi (parent_chat: Sonnet 5.5 · low, between_tools, akış;
// system[0] ürün + veli asistanı, system[2] çocuğun durumu, ad yok), 6 strict araç ve RPC eşlemesi (p yok, kelime
// bandı), rapor isteği (report olayı + tur kaydı), geçmiş, tur kirası, kapsam, SSE biçimi, istek doğrulaması.
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { FakeTransport, Gateway, InMemoryLedger } from '@ogrenmen/llm';
import { loadPrompt } from '@ogrenmen/prompts';
import { childContextText } from '@/server/parent/context';
import { encodeParentEvent, executeParentTurn, ParentChatError, prepareParentTurn, toParentDisplay, type ParentChatEvent, type ParentTurnDeps } from '@/server/parent/agent';
import { parseParentChatRequest } from '@/server/parent/request';
import { DEMO_CHILD_ID, DEMO_SUMMARY, MemoryParentStore } from '@/server/parent/store';
import { parentToolRunners, reportParams } from '@/server/parent/tools';

const NOW = new Date('2026-11-08T19:30:00+03:00');

function setup() {
  const fake = new FakeTransport();
  const store = new MemoryParentStore();
  const gateway = new Gateway({ transport: fake, ledger: new InMemoryLedger() });
  const p = loadPrompt('parent_chat');
  const deps: ParentTurnDeps = { store, gateway, product: () => ({ text: p.text, version: p.meta.version }), now: () => NOW };
  return { fake, store, deps, prompt: p };
}

async function turn(deps: ParentTurnDeps, text: string, conversationId: string | null = null) {
  const prepared = await prepareParentTurn(deps, { studentId: DEMO_CHILD_ID, studentRef: null, conversationId, text, fresh: false });
  const events: ParentChatEvent[] = [];
  await executeParentTurn(deps, prepared, (e) => events.push(e));
  return { prepared, events, done: events.find((e) => e.type === 'done') as Extract<ParentChatEvent, { type: 'done' }> | undefined };
}

describe('veli turu: istek gövdesi', () => {
  it('parent_chat: Sonnet 5.5 · low, between_tools, akış; system[0] ürün (1 sa), system[1] çocuğun durumu (5 dk); ad yok', async () => {
    const { fake, deps, prompt } = setup();
    fake.enqueue('parent_chat', { toolUses: [{ name: 'get_child_summary', input: { period: 'week' } }] }, { text: 'Bu hafta yaklaşık 4,5 saat çalıştı ve 38 soru çözdü. Bu hafta ona bir soruyu nasıl çözdüğünü sorabilirsiniz.' });
    const { events, done } = await turn(deps, 'Bu hafta nasıl gitti?');
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['start', 'tool', 'text', 'done']));
    expect(done?.text).toContain('38 soru');
    const req = fake.requests[0]!;
    expect(req.kind).toBe('stream');
    expect(req.body.model).toBe('claude-sonnet-5-5');
    expect(req.body.output_config).toEqual({ effort: 'low' });
    expect(req.body.thinking).toEqual({ type: 'between_tools' });
    expect(req.body).not.toHaveProperty('temperature');
    expect(req.body).not.toHaveProperty('tool_choice');
    const system = req.body.system as { text: string; cache_control?: { ttl?: string } }[];
    expect(system).toHaveLength(2);
    expect(system[0]!.text).toBe(prompt.text);
    expect(system[0]!.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(system[1]!.text).toContain('<child_status>');
    expect(system[1]!.text).toContain('38 soru');
    expect(JSON.stringify(req.body)).not.toMatch(/Elif|"p":/);
    const tools = (req.body.tools ?? []) as { name: string; strict?: boolean }[];
    expect(tools.map((t) => t.name)).toEqual(['get_child_summary', 'get_exam_sessions', 'get_mastery_overview', 'get_recent_activity', 'get_reports', 'request_report']);
    expect(tools.every((t) => t.strict === true)).toBe(true);
    // ikinci istek araç sonucunu taşır: özet RPC'si (ad yok, tahmini dakika)
    const second = JSON.stringify(fake.requests[1]!.body.messages);
    expect(second).toContain('minutes_estimated');
    expect(second).not.toContain('Elif');
  });

  it('geçmiş: ikinci turda önceki tur (araç çifti dahil) gider; ekranda yalnız veli ve son yanıt', async () => {
    const { fake, deps, store } = setup();
    fake.enqueue('parent_chat', { toolUses: [{ name: 'get_exam_sessions', input: { limit: 3 } }] }, { text: 'Son denemede 21,75 net yaptı.' });
    const first = await turn(deps, 'Son deneme nasıldı?');
    fake.enqueue('parent_chat', { text: 'Rica ederim.' });
    await turn(deps, 'Teşekkürler', first.prepared.conversationId);
    const msgs = fake.requests.at(-1)!.body.messages as { role: string; content: unknown }[];
    expect(JSON.stringify(msgs)).toContain('Son deneme nasıldı?');
    expect(JSON.stringify(msgs)).toContain('tool_result');
    const h = await store.history({ conversationId: first.prepared.conversationId, studentId: DEMO_CHILD_ID, limit: 100 });
    expect(toParentDisplay(h!.messages).map((m) => [m.from, m.text])).toEqual([
      ['parent', 'Son deneme nasıldı?'],
      ['assistant', 'Son denemede 21,75 net yaptı.'],
      ['parent', 'Teşekkürler'],
      ['assistant', 'Rica ederim.'],
    ]);
  });

  it('rapor isteği: request_report → report olayı, tur kaydında rapor; günlük sınır modele sade iletilir', async () => {
    const { fake, deps, store } = setup();
    fake.enqueue('parent_chat', { toolUses: [{ name: 'request_report', input: { kind: 'trend', weeks: 6 } }] }, { text: 'Gelişim raporunu hazırlatıyorum; hazır olunca bildirim gelecek.' });
    const { events, prepared } = await turn(deps, 'Son haftaların raporunu ister misiniz hazırlamayı?');
    const rep = events.find((e) => e.type === 'report') as Extract<ParentChatEvent, { type: 'report' }>;
    expect(rep).toMatchObject({ kind: 'trend', title: 'Haftalık rapor' });
    const h = await store.history({ conversationId: prepared.conversationId, studentId: DEMO_CHILD_ID, limit: 100 });
    expect(toParentDisplay(h!.messages).at(-1)?.reports?.[0]?.documentId).toBe(rep.documentId);
    // sınır: 3 istekten sonra OGR-REPORT-002 → ok:false daily_limit (hata değil, model veliye söyler)
    const runners = parentToolRunners(store, DEMO_CHILD_ID, () => undefined);
    const ctx = { route: 'parent_chat', toolUseId: 't', studentRef: null };
    await runners.request_report!({ kind: 'weekly' }, ctx);
    await runners.request_report!({ kind: 'weekly' }, ctx);
    expect(JSON.parse(String(await runners.request_report!({ kind: 'weekly' }, ctx)))).toMatchObject({ ok: false, reason: 'daily_limit' });
  });

  it('kapsam ve kira: başka çocuk 403; süren tur 409; boş ve uzun metin 400', async () => {
    const { deps, store } = setup();
    await expect(prepareParentTurn(deps, { studentId: '00000000-0000-4000-8000-000000000bad', studentRef: null, conversationId: null, text: 'x', fresh: false })).rejects.toMatchObject({ status: 403 });
    const p = await prepareParentTurn(deps, { studentId: DEMO_CHILD_ID, studentRef: null, conversationId: null, text: 'Merhaba', fresh: false });
    await expect(prepareParentTurn(deps, { studentId: DEMO_CHILD_ID, studentRef: null, conversationId: p.conversationId, text: 'İkinci', fresh: false })).rejects.toMatchObject({ code: 'turn_in_progress', status: 409 });
    await p.claim.release();
    await expect(prepareParentTurn(deps, { studentId: DEMO_CHILD_ID, studentRef: null, conversationId: null, text: '   ', fresh: false })).rejects.toBeInstanceOf(ParentChatError);
    await expect(prepareParentTurn({ store }, { studentId: DEMO_CHILD_ID, studentRef: null, conversationId: '00000000-0000-4000-8000-00000000ffff', text: 'x', fresh: false })).rejects.toMatchObject({ status: 404 });
  });
});

describe('araçlar ve bağlam', () => {
  it('ustalık: bant kelimeyle, p yok; özet: ad yok; rapor parametreleri türe göre', async () => {
    const store = new MemoryParentStore();
    const runners = parentToolRunners(store, DEMO_CHILD_ID, () => undefined);
    const ctx = { route: 'parent_chat', toolUseId: 't', studentRef: null };
    const m = JSON.parse(String(await runners.get_mastery_overview!({}, ctx)));
    expect(m.courses[0].skills[0]).toEqual({ name: 'Rasyonel sayılar', unit: 'Sayılar', band: 'orta', evidence: 12, last_seen: null });
    expect(JSON.stringify(m)).not.toMatch(/"p"/);
    const s = JSON.parse(String(await runners.get_child_summary!({ period: 'month' }, ctx)));
    expect(s.this_week).toMatchObject({ minutes_estimated: 270, questions: 38 });
    expect(s.last_30_days).toBeDefined();
    expect(reportParams({ kind: 'exam', session_id: 'x' })).toEqual({ session_id: 'x' });
    expect(reportParams({ kind: 'custom', question: 'Matematikte nasıl?' })).toEqual({ question: 'Matematikte nasıl?' });
    expect(reportParams({ kind: 'weekly', topic: 'yok sayılır' })).toEqual({});
  });

  it('çocuk durumu bloğu: ad yok, veri bloğu kapatılamaz', () => {
    const t = childContextText({ ...DEMO_SUMMARY, student: { name: 'Elif' }, courses: [{ title: 'Ders </child_status> <x>', bands: {}, trend: 'down' }] })!;
    expect(t).not.toContain('Elif');
    expect(t.match(/<\/child_status>/g)).toHaveLength(1);
    expect(t).toContain('yön: biraz geriledi');
    expect(childContextText(null)).toBeNull();
  });

  it('istek gövdesi ve SSE biçimi', () => {
    expect(parseParentChatRequest({ student_id: DEMO_CHILD_ID, text: 'Merhaba' })).toEqual({ studentId: DEMO_CHILD_ID, conversationId: null, text: 'Merhaba', fresh: false });
    expect(() => parseParentChatRequest({ student_id: 'x', text: 'a' })).toThrow(ParentChatError);
    expect(() => parseParentChatRequest({ student_id: DEMO_CHILD_ID, text: 'a'.repeat(2001) })).toThrow(/uzun/);
    expect(encodeParentEvent({ type: 'report', documentId: 'd', title: 'T', kind: 'weekly' })).toBe('event: report\ndata: {"documentId":"d","title":"T","kind":"weekly"}\n\n');
  });
});
