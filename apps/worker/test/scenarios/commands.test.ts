import { describe, expect, it } from 'vitest';
import { texts } from '../../src/texts.ts';
import { lineCount } from '../../src/telegram/format.ts';
import { captureConsole, fx, IDS, lastKeyboard, makeApp, rows, type TestWorld } from '../helpers.ts';

const FORBIDDEN = /(tahmin|çıkacak|kesin|garanti)/iu;
const MERT = { firstName: 'Mert', lastName: 'Demir', username: 'mert_d' };
const flag = (key: string, value: unknown) => (seed: Record<string, unknown>) => {
  const f = (seed.runtime_flags as Array<Record<string, unknown>>).find((r) => r.key === key);
  if (f) f.value = value;
  else (seed.runtime_flags as Array<Record<string, unknown>>).push({ key, value, updated_at: '2026-10-01T00:00:00Z', updated_by: 'test' });
};
const out = (w: TestWorld, chat: number) => w.telegram.textsTo(chat);

describe('gizlilik-from-legal-texts', () => {
  it('/gizlilik cevabı legal_texts.body_md cocuk-dili işaretleri arasıdır; texts.ts kopyası yok; {{ yok', async () => {
    const w = makeApp();
    await w.send(w.privateText(IDS.elifChat, '/gizlilik'));
    const body = String(rows(w, 'legal_texts', (l) => l.kind === 'kvkk_aydinlatma')[0]?.body_md);
    const a = body.indexOf('<!-- ogrenmen:cocuk-dili:start -->');
    const b = body.indexOf('<!-- ogrenmen:cocuk-dili:end -->');
    const block = body.slice(a + '<!-- ogrenmen:cocuk-dili:start -->'.length, b).trim();
    const reply = out(w, IDS.elifChat).at(-1) ?? '';
    expect(reply).toBe(block.replace(/\*\*/g, ''));
    expect(reply).not.toContain('{{');
    expect(JSON.stringify(texts)).not.toContain(block.split('\n')[1]?.slice(0, 30) ?? 'x');
    expect(w.llm.calls.length).toBe(0);
  });

  it('ham {{…}} yer tutucusu görülürse blok gösterilmez (yedek metin + console.warn)', async () => {
    const w = makeApp({
      mutateSeed: (seed) => {
        const l = (seed.legal_texts as Array<Record<string, unknown>>).find((x) => x.kind === 'kvkk_aydinlatma')!;
        l.body_md = String(l.body_md).replace('90 gün sonra', '{{RETENTION_MESSAGES}} gün sonra');
      },
    });
    const cap = captureConsole();
    try {
      await w.send(w.privateText(IDS.elifChat, '/gizlilik'));
    } finally {
      cap.restore();
    }
    expect(out(w, IDS.elifChat).at(-1)).toBe(texts.privacyFallback);
    expect(cap.lines.some((l) => l.includes('legal_placeholder_unresolved'))).toBe(true);
  });
});

describe('oncelik-no-forbidden-words', () => {
  it('onaylı plan → 2 mesaj, ≤ 4 satır, ilk satır "Sıklık analizine göre öncelikler", yasak kelime yok, LLM yok', async () => {
    const w = makeApp();
    await w.send(w.privateText(IDS.mertChat, '/oncelik', MERT));
    const msgs = out(w, IDS.mertChat);
    expect(msgs.length).toBe(2);
    for (const m of msgs) {
      expect(lineCount(m)).toBeLessThanOrEqual(4);
      expect(FORBIDDEN.test(m)).toBe(false);
    }
    expect(msgs[0]?.split('\n')[0]?.startsWith('Sıklık analizine göre öncelikler')).toBe(true);
    expect(msgs[0]).toContain('TYT-MAT · YKS 2027 · 3 yılın arşivi');
    expect(msgs[0]?.split('\n')[1]).toMatch(/^1\. .+ · .+ · \d\/3 yıl · .+ · kanıt \d+$/u);
    expect(w.llm.calls.length).toBe(0);
    expect(w.db.rpcCalls.filter((r) => r === 'priority_plan_for_enrollment').length).toBe(1);
  });

  it('plan yoksa tek satır bilgi', async () => {
    const w = makeApp({ mutateSeed: (seed) => void (seed.exam_priority_plans = []) });
    await w.send(w.privateText(IDS.mertChat, '/oncelik', MERT));
    expect(out(w, IDS.mertChat)).toEqual([texts.oncelikNone]);
  });
});

describe('arastir-queued', () => {
  it('research_enabled=false → kapalı metni, enqueue_research çağrılmaz', async () => {
    const w = makeApp();
    await w.send(w.privateText(IDS.elifChat, '/arastir aralıklı tekrar matematikte işe yarar mı'));
    expect(out(w, IDS.elifChat).at(-1)).toBe(texts.arastirClosed);
    expect(w.db.rpcCalls).not.toContain('enqueue_research');
  });

  it('true + pilot katmanı → research_requests 1 satır, kota 1 düştü; research_ready ≤ 6 atıf, DOI ya da bağlantı', async () => {
    const w = makeApp({
      mutateSeed: (seed) => {
        flag('research_enabled', true)(seed);
        (seed.students as Array<Record<string, unknown>>).find((s) => s.id === IDS.elif)!.tier = 'pilot';
      },
    });
    const before = rows(w, 'research_requests').length;
    await w.send(w.privateText(IDS.elifChat, '/arastir aralıklı tekrar matematikte işe yarar mı'));
    expect(out(w, IDS.elifChat).at(-1)).toBe(texts.arastirQueued);
    const req = rows(w, 'research_requests').slice(before);
    expect(req.length).toBe(1);
    expect(req[0]?.status).toBe('queued');
    expect(rows(w, 'quota_usage', (u) => u.student_id === IDS.elif && u.kind === 'research')[0]?.used).toBe(1);

    // Eğitmen yayımladı: app.research_released() tetikleyicisi proaktif satırı kuyruğa koyar.
    const output = rows(w, 'research_outputs')[0] as Record<string, unknown>;
    output.status = 'released';
    w.db.table('proactive_messages').push({ id: 'f0f0f0f0-0000-4000-8000-000000000001', student_id: IDS.elif, chat_id: IDS.elifChat, recipient: 'student', template_id: 'research_ready', params: { output_id: output.id }, scheduled_for: '2026-10-20T15:00:00Z', sent_at: null, telegram_message_id: null, status: 'scheduled' });
    const n = out(w, IDS.elifChat).length;
    await w.app.runCron('*/15 * * * *');
    const msgs = out(w, IDS.elifChat).slice(n);
    expect(msgs.length).toBeGreaterThanOrEqual(2);
    expect(msgs[0]).toContain('Kaynaklar aşağıda.');
    expect(lineCount(msgs[0] ?? '')).toBeLessThanOrEqual(4);
    const cites = msgs.slice(1).flatMap((m) => m.split('\n'));
    expect(cites.length).toBeGreaterThan(0);
    expect(cites.length).toBeLessThanOrEqual(6);
    for (const c of cites) expect(/10\.\d{4,}\/\S+|https?:\/\/\S+/.test(c)).toBe(true);
    const all = msgs.join('\n');
    expect(all).not.toContain('CitationCard');
    expect(all).not.toContain('relevance');
    expect(rows(w, 'proactive_messages', (p) => p.template_id === 'research_ready')[0]?.status).toBe('sent');
    expect(w.llm.calls.length).toBe(0);
  });
});

describe('commands', () => {
  it('/ilerleme: evidence_count < 5 → "henüz yeterli kanıt yok", ≤ 6 satır, iki mesaj', async () => {
    const w = makeApp();
    await w.send(w.privateText(IDS.mertChat, '/ilerleme', MERT));
    const msgs = out(w, IDS.mertChat);
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    expect(msgs.length).toBeLessThanOrEqual(2);
    const lines = msgs.join('\n').split('\n').slice(1);
    expect(lines.length).toBeLessThanOrEqual(6);
    const view = await w.db.forStudent(IDS.mert).masteryView(IDS.mertEnrollment);
    for (const l of lines) {
      const name = l.split(' · ')[0];
      const r = view.find((v) => v.skill_name === name);
      expect(r).toBeDefined();
      if (r && r.evidence_count < 5) expect(l.endsWith('henüz yeterli kanıt yok')).toBe(true);
      else expect(l).toMatch(/%\d+$/);
    }
  });

  it('/mod → [Sokratik kal · Doğrudan cevap]; seçim sessions.mode ve preferences.default_mode', async () => {
    const w = makeApp();
    await w.send(w.privateText(IDS.mertChat, '/mod', MERT));
    expect(lastKeyboard(w, IDS.mertChat)).toEqual(['mode:socratic', 'mode:direct']);
    await w.send(w.callback(IDS.mertChat, 'mode:direct'));
    expect(rows(w, 'sessions', (s) => s.student_id === IDS.mert)[0]?.mode).toBe('direct');
    expect(rows(w, 'preferences', (p) => p.student_id === IDS.mert)[0]?.default_mode).toBe('direct');
  });

  it('/durdur ve /baslat proactive_enabled değiştirir', async () => {
    const w = makeApp();
    await w.send(w.privateText(IDS.mertChat, '/durdur', MERT));
    expect(out(w, IDS.mertChat).at(-1)).toBe(texts.durdur);
    expect(rows(w, 'preferences', (p) => p.student_id === IDS.mert)[0]?.proactive_enabled).toBe(false);
    w.clock.advance(5000);
    await w.send(w.privateText(IDS.mertChat, '/baslat', MERT));
    expect(out(w, IDS.mertChat).at(-1)).toBe(texts.baslat);
    expect(rows(w, 'preferences', (p) => p.student_id === IDS.mert)[0]?.proactive_enabled).toBe(true);
  });

  it('/sil → [Onaylıyorum · Vazgeç] → request_deletion', async () => {
    const w = makeApp();
    await w.send(w.privateText(IDS.mertChat, '/sil', MERT));
    expect(lastKeyboard(w, IDS.mertChat)).toEqual(['del:yes', 'del:no']);
    await w.send(w.callback(IDS.mertChat, 'del:yes'));
    expect(out(w, IDS.mertChat).at(-1)).toBe(texts.silDone);
    expect(w.db.rpcCalls).toContain('request_deletion');
  });

  it('/yardim ve bilinmeyen komut; /hoca özelde iletir', async () => {
    const w = makeApp();
    await w.send(w.privateText(IDS.mertChat, '/yardim', MERT));
    expect(out(w, IDS.mertChat).at(-1)).toBe(texts.help.replace(/`/g, ''));
    await w.send(w.privateText(IDS.mertChat, '/bilinmeyen', MERT));
    expect(out(w, IDS.mertChat).at(-1)).toBe(texts.unknownCommand);
    await w.send(w.privateText(IDS.mertChat, '/hoca türevde zincir kuralı', MERT));
    expect(out(w, IDS.mertChat).at(-1)).toBe(texts.hocaPrivateAiOnly);
    expect(rows(w, 'escalations').at(-1)?.reason).toBe('human_requested');
  });

  it('ses mesajı → yazılı mesaj notu; edited_message metni günceller, LLM yok', async () => {
    const w = makeApp({ llm: { pick: 'chat/01-socratic-paydalar.json' } });
    await w.send(fx('voice'));
    expect(out(w, IDS.elifChat).at(-1)).toBe(texts.voice);
    expect(w.llm.calls.length).toBe(0);
    await w.send(fx('private_text'));
    const calls = w.llm.calls.length;
    await w.send(fx('edited_message'));
    expect(w.llm.calls.length).toBe(calls);
    const m = rows(w, 'messages', (x) => x.chat_id === IDS.elifChat && x.telegram_message_id === 41)[0];
    expect(String(m?.text_raw)).toContain('yanlış mı?');
    expect(String(m?.text_llm)).not.toContain('Elif');
  });

  it('yasak konu (ödeme) → onaylı olgu yoksa hocaya devir; onaylı olgu varsa aynen aktarılır', async () => {
    const w = makeApp();
    await w.send(w.privateText(IDS.mertChat, 'Bu ayın taksit ödemesi ne zaman?', MERT));
    expect(out(w, IDS.mertChat).at(-1)).toBe(texts.handoff);
    expect(rows(w, 'escalations').at(-1)?.reason).toBe('grade_attendance_payment');
    expect(w.llm.calls.length).toBe(0);
  });
});

describe('proactive', () => {
  it('*/15 cron şablon mesaj gönderir (LLM yok); proactive_enabled=false ise göndermez', async () => {
    const w = makeApp();
    w.db.table('proactive_messages').push({ id: 'f0f0f0f0-0000-4000-8000-000000000002', student_id: IDS.mert, chat_id: IDS.mertChat, recipient: 'student', template_id: 'priority_plan_ready', params: {}, scheduled_for: '2026-10-20T15:30:00Z', sent_at: null, telegram_message_id: null, status: 'scheduled' });
    await w.app.runCron('*/15 * * * *');
    expect(out(w, IDS.mertChat)).toContain(texts.proactive.priority_plan_ready);
    expect(rows(w, 'bot_responses').at(-1)?.purpose).toBe('proactive');
    expect(w.llm.calls.length).toBe(0);
    const w2 = makeApp();
    w2.db.table('preferences').find((p) => p.student_id === IDS.mert)!.proactive_enabled = false;
    w2.db.table('proactive_messages').push({ id: 'f0f0f0f0-0000-4000-8000-000000000003', student_id: IDS.mert, chat_id: IDS.mertChat, recipient: 'student', template_id: 'priority_plan_ready', params: {}, scheduled_for: '2026-10-20T15:30:00Z', sent_at: null, telegram_message_id: null, status: 'scheduled' });
    await w2.app.runCron('*/15 * * * *');
    expect(out(w2, IDS.mertChat).length).toBe(0);
  });

  it('saatlik cron: storage_deletions kuyruğu Storage API ile silinir; gece cron yalnız cron_owner=worker', async () => {
    const w = makeApp({ mutateSeed: flag('cron_owner', 'worker') });
    w.db.table('storage_deletions').push({ id: 1, bucket: 'lessons', path: 'videos/x.mp4', requested_at: '2026-10-20T10:00:00Z', done_at: null, error: null });
    await w.app.runCron('5 * * * *');
    expect(w.storage.removed).toEqual([{ bucket: 'lessons', path: 'videos/x.mp4' }]);
    expect(rows(w, 'storage_deletions')[0]?.done_at).not.toBeNull();
    await w.app.runCron('0 3 * * *');
    expect(w.db.rpcCalls).toContain('run_retention');
    expect(w.db.rpcCalls).toContain('compute_table_sizes');
    expect(w.db.rpcCalls).toContain('recompute_is_minor');
    const w2 = makeApp();
    await w2.app.runCron('0 3 * * *');
    expect(w2.db.rpcCalls).not.toContain('run_retention');
    await w2.app.runCron('0 6 * * *');
    expect(w2.db.rpcCalls).toContain('ping');
  });
});
