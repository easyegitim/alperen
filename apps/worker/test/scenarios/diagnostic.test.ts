import { describe, expect, it } from 'vitest';
import { decodeAnswer } from '../../src/telegram/keyboard.ts';
import { fx, IDS, lastKeyboard, makeApp, rows, type TestWorld } from '../helpers.ts';

const SEED_QUESTIONS = (w: TestWorld) => w.db.table('questions');

/** Elif'in yarım teşhisini 20 cevapla bitirir; `wrongSkills` kazanımlarında etiketli yanlış şık seçilir. */
async function runDiagnostic(w: TestWorld, wrongSkills: Set<string>): Promise<void> {
  await w.send(w.privateText(IDS.elifChat, '/test'));
  for (let i = 0; i < 20; i++) {
    const data = lastKeyboard(w, IDS.elifChat);
    expect(data.length).toBe(4);
    const ans = decodeAnswer(data[0] ?? '');
    expect(ans).not.toBeNull();
    const q = SEED_QUESTIONS(w).find((x) => x.id === ans?.question) as { skill_ids: string[]; options: Array<{ key: string; misconception_tag: string | null }> };
    const correct = w.oracle.correctKey(String(ans?.question));
    let key = correct;
    if (wrongSkills.has(q.skill_ids[0] ?? '')) key = q.options.find((o) => o.key !== correct && o.misconception_tag !== null)?.key ?? key;
    const chosen = data.find((d) => d.endsWith(`:${key}`)) ?? '';
    w.clock.advance(20_000);
    await w.send(w.callback(IDS.elifChat, chosen, w.telegram.lastTo(IDS.elifChat)?.message_id ?? 0));
  }
}

describe('diagnostic-20', () => {
  it('20 cevap → mastery satırları, evidence_count ≤ 2, yüzde yok, yanılgı satırı, çıkarım gözlemi sayılmaz', async () => {
    const w = makeApp();
    const wrong = new Set(['tyt.mat.temel.rasyonel-sayilar', 'tyt.mat.problem.yuzde', 'tyt.mat.temel.ebob-ekok']);
    const sentBefore = w.telegram.outbox.length;
    await runDiagnostic(w, wrong);
    const mastery = rows(w, 'mastery', (m) => m.enrollment_id === IDS.elifEnrollment);
    expect(mastery.length).toBeGreaterThanOrEqual(15);
    for (const m of mastery) expect(Number(m.evidence_count)).toBeLessThanOrEqual(2);
    const texts = w.telegram.outbox.slice(sentBefore).filter((o) => o.method === 'sendMessage').map((o) => String(o.params.text));
    const summary = texts.filter((t) => t.includes('Teşhis testi bitti'));
    expect(summary.length).toBe(1);
    // Güvenilir kazanım yok (evidence_count ≤ 2 < 5): özet yüzde içermez (soru kökleri %20 gibi ifadeler taşıyabilir).
    expect(summary.every((t) => t.includes('%') === false)).toBe(true);
    const mcs = rows(w, 'misconceptions', (m) => m.enrollment_id === IDS.elifEnrollment);
    expect(mcs.some((m) => m.tag === 'rasyonel.pay-payda-ayri-toplama')).toBe(true);
    const inferred = rows(w, 'observations', (o) => o.enrollment_id === IDS.elifEnrollment && o.kind === 'inferred');
    expect(inferred.length).toBeGreaterThan(0);
    for (const o of inferred) {
      expect(o.counts_for_mastery).toBe(false);
      const direct = rows(w, 'observations', (x) => x.enrollment_id === IDS.elifEnrollment && x.skill_id === o.skill_id && x.kind === 'diagnostic').length;
      const m = mastery.find((x) => x.skill_id === o.skill_id);
      expect(Number(m?.evidence_count ?? 0)).toBe(direct);
    }
    expect(rows(w, 'diagnostic_sessions', (d) => d.id === '5c661df7-8220-5b58-a114-d78ef1c4630e')[0]?.status).toBe('finished');
    expect(w.llm.calls.length).toBe(0);
    // Hiçbir giden metin doğru şıkkı ilan etmez; şıklar etiketsiz.
    const all = JSON.stringify(w.telegram.outbox);
    expect(all.includes('misconception_tag')).toBe(false);
  });

  it('practice-after-diagnostic: /test → 10 şablon sorusu, yedek kural (teşhiste yanlış yapılan en düşük p)', async () => {
    const w = makeApp();
    const wrong = new Set(['tyt.mat.temel.rasyonel-sayilar', 'tyt.mat.problem.yuzde']);
    await runDiagnostic(w, wrong);
    const items = await w.db.forStudent(IDS.elif).nextPracticeItems(IDS.elifEnrollment, 10);
    expect(items.length).toBe(10);
    for (const it of items) {
      const q = SEED_QUESTIONS(w).find((x) => x.id === it.question_id) as Record<string, unknown>;
      expect(q.source).toBe('template');
      expect(q.status).toBe('approved');
      if (q.figure_id !== null) expect(w.db.table('figures').find((f) => f.id === q.figure_id)?.review_status).toBe('verified');
    }
    expect(items.some((it) => SEED_QUESTIONS(w).find((x) => x.id === it.question_id)?.source === 'llm')).toBe(false);
    expect(wrong.has(items[0]?.skill_id ?? '')).toBe(true);
    w.clock.advance(60_000);
    await w.send(w.privateText(IDS.elifChat, '/test'));
    const data = lastKeyboard(w, IDS.elifChat);
    const ans = decodeAnswer(data[0] ?? '');
    const session = rows(w, 'sessions', (s) => s.student_id === IDS.elif && s.chat_id === IDS.elifChat)[0];
    expect(session?.state).toBe('awaiting_answer');
    expect(session?.pending_question_id).toBe(ans?.question);
    // Yazılı cevap ("B") da aynı set kimliğiyle puanlanır.
    w.clock.advance(30_000);
    await w.send(w.privateText(IDS.elifChat, 'B'));
    const att = rows(w, 'attempts', (a) => a.enrollment_id === IDS.elifEnrollment && a.context === 'practice');
    expect(att.length).toBe(1);
    expect(att[0]?.session_id).toBe(ans?.session);
    expect(w.llm.calls.length).toBe(0);
  });
});

describe('figure-unverified-not-sent', () => {
  it('review_status=pending şekilli soru sete girmez; verified şekil sendPhoto ile, altyazı kök + alt_text, A·B·C·D', async () => {
    const pending = '15c5b12a';
    const w = makeApp({
      mutateSeed: (seed) => {
        for (const q of seed.questions as Array<Record<string, unknown>>) {
          if (String(q.id).startsWith(pending)) q.status = 'approved';
          if (q.source === 'template' && q.figure_id === null) q.status = 'retired';
        }
      },
    });
    const mertChat = IDS.mertChat;
    await w.send(w.privateText(mertChat, '/test', { firstName: 'Mert', lastName: 'Demir', username: 'mert_d' }));
    const photo = w.telegram.calls('sendPhoto')[0];
    expect(photo).toBeDefined();
    const qid = decodeAnswer(lastKeyboard(w, mertChat)[0] ?? '')?.question;
    const q = w.db.table('questions').find((x) => x.id === qid) as Record<string, unknown>;
    const fig = w.db.table('figures').find((f) => f.id === q.figure_id) as Record<string, unknown>;
    expect(photo?.params.photo).toBe(w.storage.publicUrl(String(fig.png_path)));
    expect(photo?.params.photo).toBe(`http://fake-storage/figures/${String(fig.id)}.png`);
    const caption = String(photo?.params.caption).replace(/\\/g, '');
    expect(caption).toContain(String(q.stem).replace(/`/g, ''));
    expect(caption).toContain(String(fig.alt_text));
    expect(lastKeyboard(w, mertChat).map((d) => d.slice(-1))).toEqual(['A', 'B', 'C', 'D']);
    // Tüm seti bitir: bekleyen şekilli soru hiç gönderilmez.
    for (let i = 0; i < 10; i++) {
      const data = lastKeyboard(w, mertChat);
      if (data.length !== 4) break;
      w.clock.advance(20_000);
      await w.send(w.callback(mertChat, data[1] ?? ''));
    }
    for (const p of w.telegram.calls('sendPhoto')) expect(String(p.params.photo).includes('eb17b011')).toBe(false);
  });
});

describe('cevap-direct-once', () => {
  it('/cevap yalnız bekleyen soru için; çözüm sunucudan, sonraki soruda Sokratik', async () => {
    const w = makeApp();
    const m = { firstName: 'Mert', lastName: 'Demir', username: 'mert_d' };
    await w.send(w.privateText(IDS.mertChat, '/cevap', m));
    expect(w.telegram.textsTo(IDS.mertChat).at(-1)).toBe('Şu an açık bir soru yok; bir soru sor, sonra /cevap yazabilirsin.');
    w.clock.advance(10_000);
    await w.send(w.privateText(IDS.mertChat, '/test', m));
    w.clock.advance(10_000);
    await w.send(w.privateText(IDS.mertChat, '/cevap', m));
    expect(w.telegram.textsTo(IDS.mertChat).at(-1)).toBe('Tamam, bu soruda çözümü doğrudan göstereceğim.');
    expect(rows(w, 'sessions', (s) => s.student_id === IDS.mert)[0]?.direct_once).toBe(true);
    const first = lastKeyboard(w, IDS.mertChat);
    w.clock.advance(10_000);
    await w.send(w.callback(IDS.mertChat, first[0] ?? ''));
    const out = w.telegram.textsTo(IDS.mertChat);
    const qid = decodeAnswer(first[0] ?? '')?.question ?? '';
    expect(out.some((t) => t.startsWith('Çözüm:'))).toBe(true);
    expect(out.join('\n')).toContain((w.oracle.solution(qid) ?? 'yok').replace(/`/g, '').slice(0, 20));
    expect(rows(w, 'sessions', (s) => s.student_id === IDS.mert)[0]?.direct_once).toBe(false);
    const n = out.filter((t) => t.startsWith('Çözüm:')).length;
    w.clock.advance(10_000);
    await w.send(w.callback(IDS.mertChat, lastKeyboard(w, IDS.mertChat)[0] ?? ''));
    expect(w.telegram.textsTo(IDS.mertChat).filter((t) => t.startsWith('Çözüm:')).length).toBe(n);
    expect(rows(w, 'audit.events', (a) => a.action === 'RPC:reveal_solution').length).toBeGreaterThan(0);
    void fx;
  });
});

/** Yalnız şekilli şablon soruları kalsın (figure-unverified-not-sent ile aynı kurulum). */
function onlyFigured(seed: Record<string, unknown>): void {
  for (const q of seed.questions as Array<Record<string, unknown>>) if (q.source === 'template' && q.figure_id === null) q.status = 'retired';
}
const MERT = { firstName: 'Mert', lastName: 'Demir', username: 'mert_d' };

describe('figure-quota', () => {
  it("consume_quota('figure') şekil başına düşer; günlük hak 1 iken ikinci şekilli soru sendPhoto olmadan, alt_text altyazısıyla gider", async () => {
    const w = makeApp({
      mutateSeed: (seed) => {
        onlyFigured(seed);
        (seed.quota_limits as Array<Record<string, unknown>>).find((l) => l.tier === 'standard' && l.kind === 'figure')!.daily_limit = 1;
      },
    });
    await w.send(w.privateText(IDS.mertChat, '/test', MERT));
    expect(w.telegram.calls('sendPhoto').length).toBe(1);
    w.clock.advance(20_000);
    await w.send(w.callback(IDS.mertChat, lastKeyboard(w, IDS.mertChat)[1] ?? ''));
    expect(w.telegram.calls('sendPhoto').length).toBe(1);
    const second = [...w.telegram.outbox].reverse().find((o) => o.method === 'sendMessage' && Number(o.params.chat_id) === IDS.mertChat && String(o.params.text).includes('Soru 2/10'));
    expect(second).toBeDefined();
    expect(String(second?.params.text)).toContain('Şekil:');
    expect(lastKeyboard(w, IDS.mertChat).map((d) => d.slice(-1))).toEqual(['A', 'B', 'C', 'D']);
    const used = rows(w, 'quota_usage', (u) => u.student_id === IDS.mert && u.kind === 'figure')[0];
    expect(used?.used).toBe(1);
  });
});

describe('practice-set-across-midnight', () => {
  it('İstanbul gece yarısını geçen set aynı set kimliğinde kalır (yazılı cevap da)', async () => {
    const w = makeApp({ now: '2026-10-20T20:58:00Z' });
    const practice = () => rows(w, 'attempts', (a) => a.enrollment_id === IDS.mertEnrollment && a.context === 'practice');
    const seeded = practice().length;
    await w.send(w.privateText(IDS.mertChat, '/test', MERT));
    const firstData = lastKeyboard(w, IDS.mertChat);
    const setId = decodeAnswer(firstData[0] ?? '')?.session;
    expect(setId).toBeDefined();
    w.clock.advance(30_000);
    await w.send(w.callback(IDS.mertChat, firstData[0] ?? ''));
    w.clock.set('2026-10-20T21:03:00Z'); // İstanbul 00:03 — yeni kota günü
    const pending = rows(w, 'sessions', (s) => s.student_id === IDS.mert)[0]?.pending_question_id;
    const q = w.db.table('questions').find((x) => x.id === pending) as Record<string, unknown>;
    await w.send(w.privateText(IDS.mertChat, q.kind === 'numeric' ? '7' : 'B', MERT));
    const att = practice().slice(seeded);
    expect(att.length).toBe(2);
    expect(new Set(att.map((a) => a.session_id))).toEqual(new Set([setId]));
    expect(w.telegram.textsTo(IDS.mertChat).some((t) => t.includes('Soru 3/10'))).toBe(true);
  });
});

describe('diagnostic-resume-figure', () => {
  it('kaldığı yerden devam: bilgi satırı önde olsa da şekil soru parçasıyla gider', async () => {
    const figureId = '44b5c574-87c6-5477-8cd4-9461ea826c13';
    const w = makeApp({
      mutateSeed: (seed) => {
        const ds = (seed.diagnostic_sessions as Array<Record<string, unknown>>).find((d) => d.id === '5c661df7-8220-5b58-a114-d78ef1c4630e')!;
        ds.current_index = 3;
        const test = (seed.diagnostic_tests as Array<Record<string, unknown>>).find((t) => t.id === ds.test_id)!;
        const qid = (test.item_ids as string[])[3];
        (seed.questions as Array<Record<string, unknown>>).find((q) => q.id === qid)!.figure_id = figureId;
      },
    });
    await w.send(w.privateText(IDS.elifChat, '/test'));
    const photo = w.telegram.calls('sendPhoto');
    expect(photo.length).toBe(1);
    expect(String(photo[0]?.params.caption).replace(/\\/g, '')).toContain('Soru 4/20');
    expect(photo[0]?.params.photo).toBe(`http://fake-storage/figures/${figureId}.png`);
    const lead = w.telegram.outbox.filter((o) => o.method === 'sendMessage' && Number(o.params.chat_id) === IDS.elifChat).at(-1);
    expect(String(lead?.params.text)).toContain('kaldığın yerden');
  });
});

describe('diag-summary-llm', () => {
  const flag = (value: boolean) => (seed: Record<string, unknown>) => {
    (seed.runtime_flags as Array<Record<string, unknown>>).push({ key: 'diag_summary_llm', value, updated_at: '2026-10-01T00:00:00Z', updated_by: 'seed' });
  };

  it('diag_summary_llm=true → diagnostic-summary.v1 ile LLM anlatımı; güvenilir olmayan kazanıma yüzde gitmez', async () => {
    const w = makeApp({ mutateSeed: flag(true), llm: { pick: 'chat/03-pool-save.json' } });
    await runDiagnostic(w, new Set(['tyt.mat.temel.rasyonel-sayilar']));
    expect(w.llm.okCalls.length).toBe(1);
    const prompt = String(w.llm.okCalls[0]?.promptText);
    expect(prompt.startsWith("Sen Öğrenmen'sin")).toBe(true);
    expect(prompt).toContain('reliable=false');
    expect(prompt).not.toContain('"yuzde"');
    const br = rows(w, 'bot_responses').at(-1) as Record<string, unknown>;
    expect(br.prompt_version).toBe('diagnostic-summary.v1');
    expect(br.schema_valid).toBe(true);
    const out = w.telegram.textsTo(IDS.elifChat);
    expect(out.some((t) => t.includes('Teşhis testi bitti'))).toBe(false);
    expect(out.at(-1)).toContain('Pratik için /test');
  });

  it('LLM düşerse şablon özet gider', async () => {
    const w = makeApp({ mutateSeed: flag(true), llm: { providerStatus: { 'gemini-paid': 503, 'gemini-free': 503, groq: 503, 'cf-ai': 503, openrouter: 503 } } });
    await runDiagnostic(w, new Set());
    expect(w.telegram.textsTo(IDS.elifChat).filter((t) => t.includes('Teşhis testi bitti')).length).toBe(1);
  });

  it('bayrak kapalı (varsayılan) → LLM çağrısı yok', async () => {
    const w = makeApp({ mutateSeed: flag(false) });
    await runDiagnostic(w, new Set());
    expect(w.llm.calls.length).toBe(0);
  });
});
