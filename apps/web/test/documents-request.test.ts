// @vitest-environment node
// Koç'tan belge isteği (Akış 5): araç şeması, RPC kapsamı, durum metinleri, Belgelerim satırları, inceleme özeti,
// sahte koç betiği ve gerçek tur döngüsünde request_document (istek açılır, sohbet kartı kaydı, hata iletileri).
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { FakeTransport, Gateway, InMemoryLedger, requestDocumentInput } from '@ogrenmen/llm';
import { loadPrompt, MAX_EXAM_QUESTIONS } from '@ogrenmen/prompts';
import { MemoryChatStore } from '@/server/chat/memory-store';
import { detectDocumentRequest, fakeCoachScript } from '@/server/chat/fake-script';
import { toDisplay } from '@/server/chat/history';
import { executeTurn, prepareTurn, type ChatEvent, type TurnDeps } from '@/server/chat/turn';
import type { ChatStudent } from '@/server/chat/types';
import { libraryRows } from '@/server/documents/present';
import { documentRequestView, requestDocument, toSpec } from '@/server/documents/request';
import { kindWord, verificationLines, reviewWarning } from '@/server/documents/review-present';
import { chatCardLine, documentStatus, phaseOf, statusWord, toolError, toolReply } from '@/server/documents/status';
import { parseDocumentList, parseRequestView } from '@/server/documents/types';
import type { RpcClient } from '@/server/practice/rpc';

const REQ = '11111111-2222-4333-8444-555555555555';
const view = (over: Record<string, unknown> = {}) => ({ request_id: REQ, kind: 'notes', status: 'queued', status_line: 'Sıraya aldım', document: { id: 'd1', title: 'Rasyonel sayılar', status: 'queued' }, reused: false, ...over });

function rpc(handler: (fn: string, args: Record<string, unknown>) => { data?: unknown; error?: { code?: string; message: string } }) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const client: RpcClient = {
    rpc: async (fn, args = {}) => {
      calls.push({ fn, args });
      const r = handler(fn, args);
      return { data: r.data ?? null, error: r.error ?? null };
    },
  };
  return { client, calls };
}

describe('araç şeması ve kapsam', () => {
  it('request_document girdisi: tür zorunlu, sınırlar zod ile', () => {
    expect(requestDocumentInput.safeParse({ kind: 'notes', topic: 'rasyonel sayılar' }).success).toBe(true);
    expect(requestDocumentInput.safeParse({ kind: 'mock_exam', question_count: 40, duration_min: 75 }).success).toBe(true);
    expect(requestDocumentInput.safeParse({ kind: 'rapor' }).success).toBe(false);
    expect(requestDocumentInput.safeParse({ kind: 'notes', length: 'huge' }).success).toBe(false);
    expect(requestDocumentInput.safeParse({ kind: 'notes', topic: 'x'.repeat(121) }).success).toBe(false);
  });

  it('deneme soru sınırı tek: araç şeması = üretim sınırı (MAX_EXAM_QUESTIONS, DB de aynı üst sınırı denetler)', () => {
    expect(MAX_EXAM_QUESTIONS).toBe(40);
    expect(requestDocumentInput.safeParse({ kind: 'mock_exam', question_count: MAX_EXAM_QUESTIONS }).success).toBe(true);
    expect(requestDocumentInput.safeParse({ kind: 'mock_exam', question_count: MAX_EXAM_QUESTIONS + 1 }).success).toBe(false);
  });

  it('toSpec yalnız verilen alanları taşır; süre yalnız denemede', () => {
    expect(toSpec({ kind: 'notes', topic: ' rasyonel sayılar ', include_my_mistakes: true, difficulty: 'hard' })).toEqual({ topic: 'rasyonel sayılar', include_my_mistakes: true, difficulty: 'hard' });
    expect(toSpec({ kind: 'notes', topic: 'a', duration_min: 30 })).toEqual({ topic: 'a' });
    expect(toSpec({ kind: 'mock_exam', question_count: 40, duration_min: 75, skill_ids: [] })).toEqual({ question_count: 40, duration_min: 75 });
  });

  it('requestDocument: RPC adı, kaynak chat, mesaj kimliği; yanıt ayrıştırılır', async () => {
    const { client, calls } = rpc(() => ({ data: view() }));
    const res = await requestDocument(client, { kind: 'notes', topic: 'rasyonel sayılar' }, 42);
    expect(calls).toEqual([{ fn: 'request_document', args: { p_kind: 'notes', p_spec: { topic: 'rasyonel sayılar' }, p_source: 'chat', p_message_id: 42 } }]);
    expect(res.ok && res.data.request_id).toBe(REQ);
  });

  it('requestDocument: günlük sınır kodu döner; document_request_view çağrılır', async () => {
    const { client } = rpc(() => ({ error: { code: 'P0001', message: 'OGR-DOC-004 bugünkü belge sınırı doldu (3)' } }));
    const res = await requestDocument(client, { kind: 'notes', topic: 'x' }, null);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.code).toBe('OGR-DOC-004');
    const ok = rpc(() => ({ data: view({ status: 'ready' }) }));
    const v = await documentRequestView(ok.client, REQ);
    expect(ok.calls[0]).toEqual({ fn: 'document_request_view', args: { p_id: REQ } });
    expect(v.ok && v.data.status).toBe('ready');
  });
});

describe('durum metinleri', () => {
  it('istek durumu → evre → kelime (öğrencide yalnız Hazırlanıyor · İncelemede · Hazır)', () => {
    for (const s of ['queued', 'generating', 'verifying']) expect(statusWord(s)).toBe('Hazırlanıyor');
    expect(statusWord('review')).toBe('İncelemede');
    expect(statusWord('ready')).toBe('Hazır');
    expect(statusWord('failed')).toBe('Hazırlanamadı');
    expect(phaseOf('published')).toBe('ready');
  });

  it('sohbet kartı tek satır; hata satırı Koç’a yönlendirir', () => {
    expect(chatCardLine('notes', 'generating')).toBe('Hazırlıyorum… Bugün’de görürsün');
    expect(chatCardLine('notes', 'ready')).toBe('Notun hazır');
    expect(chatCardLine('mock_exam', 'ready')).toBe('Denemen hazır');
    expect(chatCardLine('notes', 'review')).toMatch(/Hocan inceliyor/);
    expect(chatCardLine('notes', 'failed')).toMatch(/Koça/);
    for (const k of ['notes', 'mock_exam', 'question_set'] as const) for (const s of ['queued', 'review', 'ready', 'failed']) expect(chatCardLine(k, s)).not.toMatch(/[!%]|\d/);
  });

  it('araç yanıtları: model öğrenciye ne diyeceğini bilir', () => {
    expect(toolReply('notes', false)).toMatch(/Notunu hazırlatmaya başladım/);
    expect(toolReply('mock_exam', true)).toMatch(/zaten alınmıştı/);
    expect(toolError('OGR-DOC-004')).toMatch(/yarın/);
    expect(toolError('OGR-DOC-006')).toMatch(/ders/);
    expect(toolError(null)).toMatch(/biraz sonra/);
  });

  it('Belgelerim: hazırlananlar dahil, durum kelimesiyle; anahtar ve başarısızlar yok', () => {
    const base = { kind: 'notes', pdf_path: null, student_id: 's', created_at: '2026-11-03T10:00:00Z' };
    const docs = parseDocumentList({
      documents: [
        { ...base, id: 'a', title: 'Rasyonel sayılar', status: 'published', pdf_path: 'a.pdf', request_status: 'ready' },
        { ...base, id: 'b', title: 'Üslü sayılar', status: 'generating', request_status: 'generating' },
        { ...base, id: 'c', title: 'Denemen', kind: 'mock_exam', status: 'review', review_required: true, request_status: 'review' },
        { ...base, id: 'd', title: 'Bozuk', status: 'failed', request_status: 'failed' },
      ],
    });
    const rows = libraryRows(docs);
    expect(rows.map((r) => [r.id, r.word, r.open])).toEqual([
      ['a', 'Hazır', true],
      ['b', 'Hazırlanıyor', false],
      ['c', 'İncelemede', false],
    ]);
    expect(documentStatus({ status: 'published', request_status: 'ready', pdf_path: null })).toBe('Hazırlanıyor');
  });

  it('istek görünümü ayrıştırılır; bilinmeyen tür reddedilir', () => {
    expect(parseRequestView(view()).document?.title).toBe('Rasyonel sayılar');
    expect(() => parseRequestView(view({ kind: 'report' }))).toThrow();
  });
});

describe('eğitmen inceleme özeti', () => {
  it('beş basamak kelimeyle, kalan basamak uyarısı, yeniden üretilen blok sayısı', () => {
    const v = verificationLines({
      schema: { status: 'pass' },
      sympy: { status: 'pass', summary: '12 çözüm doğrulandı' },
      figures: { status: 'fail', reason: 'Şekil 2 etiketsiz' },
      duplicates: { status: 'skipped' },
      regen: [{ block_id: 'b3' }, { block_id: 'b3' }, { block_id: 'b5' }],
    });
    expect(v.steps.map((s) => `${s.label}: ${s.word}`)).toEqual([
      'Biçim: geçti',
      'Çözümler (SymPy): geçti',
      'Şekiller: kaldı',
      'Tekrarlar: atlandı',
      'Kişiselleştirme: bekliyor',
    ]);
    expect(v.steps[1]!.note).toBe('12 çözüm doğrulandı');
    expect(v.regenerated).toBe(2);
    expect(reviewWarning(v.steps)).toBe('Kontrolden geçmeyen: Şekiller');
    expect(reviewWarning(verificationLines(null).steps)).toBeNull();
    expect(kindWord('mock_exam')).toBe('Deneme');
  });
});

describe('sahte koç betiği', () => {
  it('cümleden belge isteği', () => {
    expect(detectDocumentRequest('rasyonel sayılar notu istiyorum')).toEqual({ kind: 'notes', topic: 'rasyonel sayılar' });
    expect(detectDocumentRequest('40 soruluk deneme hazırla')).toEqual({ kind: 'mock_exam', question_count: 40 });
    expect(detectDocumentRequest('Kesirleri nasıl toplarım?')).toBeNull();
    expect(detectDocumentRequest('deneme sonucum ne')).toBeNull();
  });

  it('betik sıraya konur: araç çağrısı, sonra tek cümle', () => {
    const t = new FakeTransport();
    const spy = vi.spyOn(t, 'enqueue');
    fakeCoachScript(t, 'coach_chat', 'rasyonel sayılar notu istiyorum');
    fakeCoachScript(t, 'coach_chat', 'merhaba');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]!.slice(0, 2)).toEqual(['coach_chat', { toolUses: [{ name: 'request_document', input: { kind: 'notes', topic: 'rasyonel sayılar' } }] }]);
  });
});

const PROFILE = '00000000-0000-4000-8000-000000000001';

async function setup(handler: Parameters<typeof rpc>[0]) {
  const fake = new FakeTransport();
  const store = new MemoryChatStore({ isolated: true });
  const gateway = new Gateway({ transport: fake, ledger: new InMemoryLedger() });
  const product = (route: 'coach_chat' | 'coach_deep') => {
    const x = loadPrompt(route);
    return { text: x.text, version: x.meta.version };
  };
  const r = rpc(handler);
  const deps: TurnDeps = { store, gateway, product, persistentIds: false, requestDocument: (input, ctx) => requestDocument(r.client, input, ctx.messageId) };
  const student = (await store.resolveStudent(PROFILE)) as ChatStudent;
  return { fake, store, deps, student, calls: r.calls };
}

async function turn(deps: TurnDeps, student: ChatStudent, text: string) {
  const prepared = await prepareTurn(deps, { student, conversationId: null, text, uploadIds: [], mode: null, seedId: null });
  const events: ChatEvent[] = [];
  await executeTurn(deps, prepared, (e) => events.push(e));
  return { events, conversationId: prepared.conversation.id };
}

describe('koç turu: request_document', () => {
  it('model aracı çağırır → RPC açılır, document olayı gelir, tur kaydı ve geçmiş kartı taşır', async () => {
    const { fake, deps, student, store, calls } = await setup(() => ({ data: view() }));
    fake.enqueue('coach_chat', { toolUses: [{ name: 'request_document', input: { kind: 'notes', topic: 'rasyonel sayılar' } }] }, { text: 'Hazırlıyorum; Bugün’de görürsün.' });
    const { events, conversationId } = await turn(deps, student, 'rasyonel sayılar notu istiyorum');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toMatchObject({ p_kind: 'notes', p_source: 'chat', p_message_id: null, p_spec: { topic: 'rasyonel sayılar' } });
    const doc = events.find((e) => e.type === 'document') as Extract<ChatEvent, { type: 'document' }>;
    expect(doc).toMatchObject({ requestId: REQ, kind: 'notes', title: 'Rasyonel sayılar' });
    const done = events.find((e) => e.type === 'done') as Extract<ChatEvent, { type: 'done' }>;
    expect(done.text).toMatch(/Hazırlıyorum/);
    const shown = toDisplay(await store.listMessages(conversationId, { limit: 50 }));
    const last = shown[shown.length - 1]!;
    expect(last.documents).toEqual([{ requestId: REQ, kind: 'notes', title: 'Rasyonel sayılar' }]);
  });

  it('günlük sınır: araç sonucu modele yarın yeniden denemeyi söyletir, kart çıkmaz', async () => {
    const { fake, deps, student } = await setup(() => ({ error: { code: 'P0001', message: 'OGR-DOC-004 bugünkü belge sınırı doldu (3)' } }));
    fake.enqueue('coach_chat', { toolUses: [{ name: 'request_document', input: { kind: 'notes', topic: 'x' } }] }, { text: 'Bugünlük sınır doldu, yarın yeniden isteyebilirsin.' });
    const { events } = await turn(deps, student, 'bir not daha');
    expect(events.some((e) => e.type === 'document')).toBe(false);
    expect(events.find((e) => e.type === 'done')).toBeTruthy();
    const req = fake.requests[1]!;
    expect(JSON.stringify(req.body.messages)).toMatch(/belge sınırı doldu/);
  });

  it('aynı istek iki kez gelirse tek kart', async () => {
    const { fake, deps, student } = await setup(() => ({ data: view({ reused: true }) }));
    fake.enqueue('coach_chat', { toolUses: [{ name: 'request_document', input: { kind: 'notes', topic: 'x' } }, { name: 'request_document', input: { kind: 'notes', topic: 'x' }, id: 'b' }] }, { text: 'Tamam.' });
    const { events } = await turn(deps, student, 'not');
    expect(events.filter((e) => e.type === 'document')).toHaveLength(1);
  });

  it('aynı mesajda farklı türde iki istek ayrı kart açar (not + deneme)', async () => {
    const { fake, deps, student, calls } = await setup((_fn, args) => ({
      data: view({ request_id: args.p_kind === 'notes' ? REQ : '11111111-2222-4333-8444-555555555556', kind: args.p_kind, reused: false }),
    }));
    fake.enqueue(
      'coach_chat',
      { toolUses: [{ name: 'request_document', input: { kind: 'notes', topic: 'x' } }, { name: 'request_document', input: { kind: 'mock_exam', question_count: 10 }, id: 'b' }] },
      { text: 'Notunu ve denemeni hazırlıyorum.' },
    );
    const { events } = await turn(deps, student, 'not ve deneme');
    expect(calls.map((c) => c.args.p_kind)).toEqual(['notes', 'mock_exam']);
    expect(events.filter((e) => e.type === 'document').map((e) => (e as { kind: string }).kind)).toEqual(['notes', 'mock_exam']);
  });
});
