import { describe, expect, it } from 'vitest';
import { FakeTransport, memoryContentHash, UPSERT_MEMORY_FILE_SQL } from '@ogrenmen/llm';
import { getJob } from '../src/jobs/registry.js';
import { cutIndex, messageText, summaryWindow } from '../src/jobs/conversationSummarize.js';
import { NIGHTLY_SLOT_SEC, REFRESH_DEBOUNCE_SEC } from '../src/jobs/dedupe.js';
import { COMPACT_ABOVE_BYTES } from '../src/jobs/memoryCompact.js';
import { NIGHTLY_CHAIN, nextIstanbulTime } from '../src/schedules.js';
import { jobCtx, routedDb } from './support.js';

const SID = '00000000-0000-4000-8000-0000000000aa';
const CONV = '00000000-0000-4000-8000-0000000000cc';
const big = (n: number) => 'Kesirlerde payda eşitlemeyi unutuyor, 3 Kas. '.repeat(n);

describe('memory.compact (Batch: gönder → topla)', () => {
  it('gece çalışması zinciri kurar ve > 6 KB dosyayı Batch ile gönderir; toplama ≤ 4 KB yazar (compact, memory-compact)', async () => {
    const content = big(160); // ~7.5 KB
    expect(Buffer.byteLength(content)).toBeGreaterThan(COMPACT_ABOVE_BYTES);
    const writes: unknown[][] = [];
    const db = routedDb([
      [/from public\.memory_files mf join public\.students/, () => [{ student_id: SID, public_ref: 's_qk7m2rx4tn5a', path: '/memories/patterns.md', bytes: Buffer.byteLength(content), content }]],
      [/upsert_memory_file/, (v) => {
        writes.push(v ?? []);
        return [{ result: {} }];
      }],
    ]);
    const transport = new FakeTransport();
    transport.enqueue('memory_compaction', { json: { files: [{ path: '/memories/patterns.md', content: '- Kesirlerde payda eşitlemeyi unutuyor · tyt.mat.temel.rasyonel-sayilar · 160× · 3 Kas' }, { path: '/memories/baska.md', content: 'gönderilmedi' }] } });
    const ctx = jobCtx({ db, transport });
    const job = getJob('memory.compact')!;

    const sub = await job.handler!({}, ctx);
    expect(sub).toMatchObject({ phase: 'submit', students: 1, files: 1, chained: ['conversation.summarize', 'suggestions.refresh@03:30'] });
    const names = ctx.enqueued.map((e) => e.name);
    expect(names).toEqual(['conversation.summarize', 'suggestions.refresh', 'memory.compact']);
    expect(ctx.enqueued[1]!.opts?.startAfter).toEqual(new Date('2026-11-03T00:30:00Z')); // 03:30 Europe/Istanbul
    // Gece zinciri 12 saatlik dilimde bir kez (standard kuyrukta singletonKey tek başına yinelemeyi düşürmez)
    expect(ctx.enqueued.slice(0, 2).map((e) => e.opts)).toEqual([
      { singletonKey: 'nightly:conversation.summarize', singletonSeconds: NIGHTLY_SLOT_SEC },
      { startAfter: new Date('2026-11-03T00:30:00Z'), singletonKey: 'nightly:suggestions.refresh', singletonSeconds: NIGHTLY_SLOT_SEC },
    ]);
    expect((ctx.enqueued[2]!.data as { hashes: Record<string, Record<string, string>> }).hashes).toEqual({ [SID]: { '/memories/patterns.md': memoryContentHash(content) } });
    const batchReq = transport.requests.find((r) => r.kind === 'batch')!;
    expect(batchReq.customId).toBe(`mc-${SID}`);
    expect(batchReq.body.model).toBe('claude-sonnet-5-5');

    const collectPayload = ctx.enqueued[2]!.data as { batch_id: string };
    const col = await job.handler!(job.payload.parse(collectPayload), ctx);
    expect(col).toEqual({ phase: 'collect', pending: false, compacted: 1, failed: 1, retriedSync: 0, deferred: 0 });
    expect(writes).toHaveLength(1);
    expect(writes[0]!.slice(1, 5)).toEqual(['/memories/patterns.md', expect.stringContaining('160×'), 'compact', 'memory-compact']);
    expect(writes[0]![6]).toBe(memoryContentHash(content)); // koşullu yazım: gönderilen içerik
    expect(db.calls.some((c) => c.text === UPSERT_MEMORY_FILE_SQL)).toBe(true);
    expect(ctx.ledger.rows.some((r) => r.route === 'memory_compaction' && r.batch === true)).toBe(true);
  });

  it('Batch sürerken değişen dosyaya Batch çıktısı yazılmaz; güncel içerik senkron yeniden sıkıştırılır', async () => {
    let content = big(160);
    const writes: unknown[][] = [];
    const db = routedDb([
      [/from public\.memory_files mf join public\.students/, () => [{ student_id: SID, public_ref: 's_qk7m2rx4tn5a', path: '/memories/patterns.md', bytes: Buffer.byteLength(content), content }]],
      [/upsert_memory_file/, (v) => {
        writes.push(v ?? []);
        return [{ result: {} }];
      }],
    ]);
    const transport = new FakeTransport();
    transport.enqueue('memory_compaction', { json: { files: [{ path: '/memories/patterns.md', content: '- eski içerikten özet' }] } });
    const ctx = jobCtx({ db, transport });
    const job = getJob('memory.compact')!;
    await job.handler!({ student_id: SID }, ctx);
    const collectPayload = ctx.enqueued.find((e) => e.name === 'memory.compact')!.data;
    // Koç Batch sürerken yeni bir satır ekledi
    content = `${content}\n- Yeni örüntü: işaret hatası · 4 Kas`;
    transport.enqueue('memory_compaction', { json: { files: [{ path: '/memories/patterns.md', content: '- güncel içerikten özet · işaret hatası' }] } });
    const col = await job.handler!(job.payload.parse(collectPayload), ctx);
    expect(col).toEqual({ phase: 'collect', pending: false, compacted: 1, failed: 0, retriedSync: 1, deferred: 0 });
    expect(writes).toHaveLength(1);
    expect(writes[0]![2]).toBe('- güncel içerikten özet · işaret hatası');
    expect(writes[0]![6]).toBe(memoryContentHash(content));
    const sync = transport.requests.filter((r) => r.route === 'memory_compaction' && r.kind !== 'batch');
    expect(JSON.stringify(sync.at(-1)!.body.messages)).toContain('Yeni örüntü');
  });

  it('tek öğrenci, sıkıştırılacak dosya yok: Batch yok, zincir yok', async () => {
    const ctx = jobCtx();
    const res = await getJob('memory.compact')!.handler!({ student_id: SID }, ctx);
    expect(res).toEqual({ phase: 'submit', students: 0, files: 0, batchId: null, chained: [] });
    expect(ctx.enqueued).toEqual([]);
  });

  it('gece zinciri belgelenir; 03:30 hesabı', () => {
    expect(NIGHTLY_CHAIN.map((x) => x.job)).toEqual(['memory.compact', 'conversation.summarize', 'suggestions.refresh']);
    expect(nextIstanbulTime(new Date('2026-11-03T00:00:00Z'), 3, 30).toISOString()).toBe('2026-11-03T00:30:00.000Z');
    const late = new Date('2026-11-03T09:00:00Z');
    expect(nextIstanbulTime(late, 3, 30)).toBe(late);
  });
});

describe('conversation.summarize', () => {
  const msgs = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: [{ type: 'text', text: `${i % 2 === 0 ? 'Soru' : 'Yanıt'} ${i + 1}: kesirlerde payda` }],
    }));

  it('kesim son 30 mesajı korur, araç sonucunda bölmez', () => {
    const m = msgs(50);
    expect(cutIndex(m)).toBe(20);
    m[20] = { id: 21, role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] as never };
    expect(cutIndex(m)).toBe(18);
    expect(messageText([{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'tool_use', name: 'get_mastery' }])).toBe('a\n[görsel]\n[araç: get_mastery]');
  });

  it('özet penceresi en eskiden başlar, tur sınırında biter; sığmayan mesaj atlanmaz (sonraki tura kalır)', () => {
    const m = msgs(50);
    const cut = cutIndex(m);
    const all = summaryWindow(m, cut, 'öğrenci');
    expect(all.end).toBe(cut);
    expect(all.lines[0]!.text).toContain('Soru 1:');
    const small = summaryWindow(m, cut, 'öğrenci', 120);
    expect(small.end).toBeGreaterThan(0);
    expect(small.end).toBeLessThan(cut);
    expect(small.lines[0]!.text).toContain('Soru 1:'); // en eskiler önce
    expect(m[small.end]!.role).toBe('user'); // kalan kısım kullanıcı turuyla başlar
    expect(small.lines.at(-1)!.text).toContain(`${small.end}:`);
  });

  it('pencere dolunca özet yalnız gönderilen mesaja kadar ilerler ve kalan için yeni tur açılır', async () => {
    const long = Array.from({ length: 80 }, (_, i) => ({
      id: i + 1,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: [{ type: 'text', text: `${i + 1}: ${'x'.repeat(1900)}` }],
    }));
    const updates: unknown[][] = [];
    const db = routedDb([
      [/from public\.conversations c join public\.students/, () => [{ id: CONV, summary: null, summary_upto_message_id: null, kind: 'coach', public_ref: 's_qk7m2rx4tn5a' }]],
      [/from public\.conversation_messages/, () => long],
      [/update public\.conversations/, (v) => {
        updates.push(v ?? []);
        return { rows: [], rowCount: 1 };
      }],
    ]);
    const transport = new FakeTransport();
    transport.enqueue('conversation_summary', { json: { summary: 'Özet.', open_threads: [], skill_ids: [] } });
    const ctx = jobCtx({ db, transport });
    const res = await getJob('conversation.summarize')!.handler!({ conversation_id: CONV }, ctx);
    const upto = res.mode === 'conversation' ? res.uptoMessageId! : 0;
    expect(upto).toBeLessThan(50); // eski kısım 50 mesaj, pencere ~30
    expect(upto % 2).toBe(0); // asistan mesajında biter, sonraki kullanıcı turu
    expect(updates[0]![2]).toBe(upto);
    const req = JSON.stringify(transport.requests.find((r) => r.route === 'conversation_summary')!.body.messages);
    expect(req).toContain('1: xxx');
    expect(req).toContain(`${upto}: xxx`);
    expect(req).not.toContain(`${upto + 1}: xxx`);
    expect(ctx.enqueued).toEqual([{ name: 'conversation.summarize', data: { conversation_id: CONV }, opts: { singletonKey: `summary:${CONV}:${upto}`, singletonSeconds: NIGHTLY_SLOT_SEC } }]);
  });

  it('eski mesajları özetler, summary + summary_upto_message_id yazar (Haiku)', async () => {
    const updates: unknown[][] = [];
    const db = routedDb([
      [/from public\.conversations c join public\.students/, () => [{ id: CONV, summary: 'Önceki özet.', summary_upto_message_id: null, kind: 'coach', public_ref: 's_qk7m2rx4tn5a' }]],
      [/from public\.conversation_messages/, () => msgs(45)],
      [/update public\.conversations/, (v) => {
        updates.push(v ?? []);
        return { rows: [], rowCount: 1 };
      }],
    ]);
    const transport = new FakeTransport();
    transport.enqueue('conversation_summary', { json: { summary: 'Öğrenci payda eşitlemeyi çalıştı ve ikinci denemede doğru yaptı.', open_threads: ['Kesir problemlerine geçilecek'], skill_ids: [] } });
    const ctx = jobCtx({ db, transport });
    const res = await getJob('conversation.summarize')!.handler!({ conversation_id: CONV }, ctx);
    expect(res).toEqual({ mode: 'conversation', conversationId: CONV, summarized: 14, uptoMessageId: 14 }); // kesim asistan mesajında değil, kullanıcı turunda
    expect(updates[0]).toEqual([CONV, 'Öğrenci payda eşitlemeyi çalıştı ve ikinci denemede doğru yaptı.\n\nAçık kalanlar:\n- Kesir problemlerine geçilecek', 14]);
    const req = transport.requests.find((r) => r.route === 'conversation_summary')!;
    expect(req.body.model).toBe('claude-haiku-5-5');
    const user = JSON.stringify(req.body.messages);
    expect(user).toContain('Önceki özet.');
    expect(user).toContain('Yanıt 14');
    expect(user).not.toContain('Soru 15:');
  });

  it('30 + 10 mesajdan azsa Haiku çağrılmaz; yüksüz çalışma sohbet başına iş açar', async () => {
    const db = routedDb([
      [/select c\.id from public\.conversations/, () => [{ id: CONV }]],
      [/from public\.conversations c join public\.students/, () => [{ id: CONV, summary: null, summary_upto_message_id: 5, kind: 'coach', public_ref: 's_x' }]],
      [/from public\.conversation_messages/, () => msgs(35)],
    ]);
    const ctx = jobCtx({ db });
    expect(await getJob('conversation.summarize')!.handler!({ conversation_id: CONV }, ctx)).toMatchObject({ summarized: 0 });
    expect(ctx.transport.requests).toHaveLength(0);
    expect(await getJob('conversation.summarize')!.handler!({}, ctx)).toEqual({ mode: 'fanout', conversations: 1 });
    expect(ctx.enqueued[0]).toMatchObject({ name: 'conversation.summarize', data: { conversation_id: CONV } });
  });
});

describe('diagnosis.followup ve activity.completed', () => {
  const AN = '00000000-0000-4000-8000-0000000000d1';
  const ENR = '00000000-0000-4000-8000-0000000000e9';
  const COURSE = '00000000-0000-4000-8000-0000000000c9';

  it('memory_delta → applyMemoryDelta (aynı işleyiciler) → activity.completed', async () => {
    const line = '- Kesirleri toplarken paydaları da topluyor · tyt.mat.temel.rasyonel-sayilar · 1× · 2 Kas';
    const files = new Map<string, string>([['/memories/patterns.md', line]]);
    const db = routedDb([
      [/from public\.solution_analyses sa/, () => [{ id: AN, verdict: 'wrong', error_cause: 'concept', failing_step_no: 2, skill_ids: ['tyt.mat.temel.rasyonel-sayilar'], misconception_tags: [], analysis: { summary: 'payda' }, student_id: SID, course_id: COURSE, course_code: 'TYT-MAT', public_ref: 's_qk7m2rx4tn5a' }]],
      [/select path, bytes, updated_at from public\.memory_files/, () => [...files].map(([path, c]) => ({ path, bytes: Buffer.byteLength(c), updated_at: new Date() }))],
      [/select content from public\.memory_files/, (v) => (files.has(String(v?.[1])) ? [{ content: files.get(String(v?.[1])) }] : [])],
      [/upsert_memory_file/, (v) => {
        files.set(String(v?.[1]), String(v?.[2]));
        return [{ result: {} }];
      }],
    ]);
    const transport = new FakeTransport();
    transport.enqueue('memory_delta', { json: { ops: [{ op: 'str_replace', path: '/memories/patterns.md', old_str: line, new_str: line.replace('1× · 2 Kas', '2× · 2 Kas, 3 Kas') }] } });
    const ctx = jobCtx({ db, transport });
    const res = await getJob('diagnosis.followup')!.handler!({ analysis_id: AN, enrollment_id: ENR }, ctx);
    expect(res).toEqual({ analysisId: AN, memory: { called: true, applied: 1, failed: 0 }, enqueued: ['activity.completed'] });
    expect(files.get('/memories/patterns.md')).toContain('2× · 2 Kas, 3 Kas');
    const up = db.calls.find((c) => /upsert_memory_file/.test(c.text))!;
    expect(up.values?.slice(3, 5)).toEqual(['str_replace', 'memory-delta']);
    const req = transport.requests.find((r) => r.route === 'memory_delta')!;
    expect(JSON.stringify(req.body.messages)).toContain('1×');
    expect(ctx.enqueued[0]).toMatchObject({ name: 'activity.completed', data: { student_id: SID, enrollment_id: ENR, course_id: COURSE, kind: 'diagnosis' } });
  });

  it('doğru çözümde Haiku çağrılmaz; teşhis yoksa kalıcı hata', async () => {
    const db = routedDb([[/from public\.solution_analyses sa/, () => [{ id: AN, verdict: 'correct', student_id: SID, course_id: null, public_ref: 's_x' }]]]);
    const ctx = jobCtx({ db });
    const res = await getJob('diagnosis.followup')!.handler!({ analysis_id: AN, enrollment_id: ENR }, ctx);
    expect(res.memory.called).toBe(false);
    expect(ctx.transport.requests).toHaveLength(0);
    await expect(getJob('diagnosis.followup')!.handler!({ analysis_id: AN, enrollment_id: ENR }, jobCtx())).rejects.toThrow(/teşhis yok/);
  });

  it('activity.completed: suggestions.refresh (tekil) + dossier.render (kayıttan ders)', async () => {
    const db = routedDb([[/select course_id from public\.enrollments/, () => [{ course_id: COURSE }]]]);
    const ctx = jobCtx({ db });
    const res = await getJob('activity.completed')!.handler!({ student_id: SID, enrollment_id: ENR, kind: 'practice' }, ctx);
    expect(res).toEqual({ enqueued: ['suggestions.refresh', 'dossier.render'] });
    expect(ctx.enqueued.map((e) => [e.name, e.opts])).toEqual([
      ['suggestions.refresh', { singletonKey: `suggestions:${SID}`, singletonSeconds: REFRESH_DEBOUNCE_SEC, debounce: true }],
      ['dossier.render', { singletonKey: `dossier:${SID}:${COURSE}`, singletonSeconds: REFRESH_DEBOUNCE_SEC, debounce: true }],
    ]);
  });
});
