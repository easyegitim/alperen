/**
 * Gerçek Claude duman testi (elle tetiklenen GitHub Actions işi; ANTHROPIC_API_KEY gerekir).
 * Dört çağrı: Haiku (önbellek isabeti), Sonnet (serbest metin koç yanıtı), Opus (çözüm teşhisi, yapılandırılmış çıktı),
 * Opus (kısa not üretimi, belge AST'si). Harcama OGRENMEN_LIVE_BUDGET_USD'yi (varsayılan 1,50) aşarsa kalanlar atlanır.
 * Çıktı: konsola ve GITHUB_STEP_SUMMARY'ye tablo. Anahtar hiçbir yere yazılmaz.
 */
import { appendFileSync } from 'node:fs';
import { contractRegistry, type Contract } from '@ogrenmen/contracts';
import { AnthropicTransport } from '../src/client.js';
import { Gateway } from '../src/gateway.js';
import { InMemoryLedger } from '../src/ledger.js';

const PRODUCT = [
  'Sen Öğrenmen koçusun. Öğrenciyle "sen" diliyle, sıcak ve kısa konuşursun; bir fikir, bir balon.',
  'Ustalık iddialarını kanıt sayısıyla söylersin. Türkçe sayı biçimi kullanırsın. Matematiği KaTeX $…$ ile yazarsın.',
  'Ünlem ve emoji kullanmazsın. Yapay zekâ olduğunu gizlemezsin.',
  ...Array.from({ length: 60 }, (_, i) => `Kural ${i + 1}: öğrencinin çözümündeki ilk bozulan adımı bul, nedenini tek cümleyle söyle.`),
].join('\n');

const BUDGET = Number(process.env.OGRENMEN_LIVE_BUDGET_USD ?? '1.5');
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY tanımlı değil (Actions › Secrets). Çıkılıyor.');
  process.exit(2);
}

const ledger = new InMemoryLedger();
const gateway = new Gateway({ transport: new AnthropicTransport(), ledger });
const total = () => ledger.rows.reduce((s, r) => s + r.cost_usd, 0);

interface Row { step: string; ok: boolean; model: string; tokensIn: number; tokensOut: number; cacheRead: number; costUsd: number; ms: number; note: string }
const rows: Row[] = [];

async function step(name: string, fn: () => Promise<{ note: string }>) {
  if (total() >= BUDGET) {
    rows.push({ step: name, ok: false, model: '-', tokensIn: 0, tokensOut: 0, cacheRead: 0, costUsd: 0, ms: 0, note: `atlandı: bütçe ${BUDGET} $ doldu` });
    return;
  }
  const before = ledger.rows.length;
  const t0 = Date.now();
  try {
    const { note } = await fn();
    const mine = ledger.rows.slice(before);
    rows.push({
      step: name, ok: true, model: [...new Set(mine.map((r) => r.model))].join(', '),
      tokensIn: mine.reduce((s, r) => s + r.tokens_in, 0), tokensOut: mine.reduce((s, r) => s + r.tokens_out, 0),
      cacheRead: mine.reduce((s, r) => s + r.cache_read_tokens, 0), costUsd: mine.reduce((s, r) => s + r.cost_usd, 0), ms: Date.now() - t0, note,
    });
  } catch (e) {
    const mine = ledger.rows.slice(before);
    rows.push({
      step: name, ok: false, model: [...new Set(mine.map((r) => r.model))].join(', ') || '-', tokensIn: 0, tokensOut: 0, cacheRead: 0,
      costUsd: mine.reduce((s, r) => s + r.cost_usd, 0), ms: Date.now() - t0, note: `${(e as Error).name}: ${(e as Error).message}`.slice(0, 300),
    });
  }
}

const valid = (name: keyof typeof contractRegistry, data: unknown) => (contractRegistry[name] as Contract).isValid(data);

await step('1 Haiku 5.5: yapılandırılmış çıktı + önbellek (2 çağrı)', async () => {
  const mk = (n: number) => ({ system: { product: PRODUCT }, user: `Öğrenci deneme ${n}'i bitirdi: 40 sorudan 27 doğru. Veliye kısa bir bildirim metni yaz.`, promptVersion: 'live-smoke' });
  const a = await gateway.call('notification_copy', mk(1));
  const b = await gateway.call('notification_copy', mk(2));
  if (!valid('notification-copy', a.data) || !valid('notification-copy', b.data)) throw new Error('şemaya uymayan çıktı');
  const hit = b.message.usage.cache_read_input_tokens ?? 0;
  if (hit <= 0) throw new Error('ikinci çağrıda cache_read_input_tokens = 0');
  return { note: `ikinci çağrıda ${hit} token önbellekten okundu` };
});

await step('2 Sonnet 5.5: koç yanıtı (serbest metin)', async () => {
  const r = await gateway.call('coach_chat', {
    system: { product: PRODUCT },
    user: '3(x − 2) açılımında −6 yerine +6 yazdım, neden yanlış oldu? İpucu ver, çözümü söyleme.',
    turn: { date: new Date().toISOString().slice(0, 10), mode: 'hint' },
    maxTokens: 1500,
    promptVersion: 'live-smoke',
  });
  if (!r.text || r.text.length < 20) throw new Error('boş yanıt');
  if (/[!]/.test(r.text)) throw new Error('yanıtta ünlem var (ürün kuralı)');
  return { note: `${r.text.length} karakter; ilk satır: ${r.text.split('\n')[0]?.slice(0, 80)}` };
});

await step('3 Opus 5.5: çözüm teşhisi (solution-diagnosis)', async () => {
  const r = await gateway.call('solution_diagnosis', {
    system: { product: PRODUCT },
    user: [
      'Soru: 4(x + 1) − 3(x − 2) = 2x + 1 denklemini çözünüz.',
      'Öğrencinin çözümü (transkripsiyon):',
      '1) 4x + 4 − 3(x − 2) = 2x + 1',
      '2) 4x + 4 − 3x − 6 = 2x + 1',
      '3) x − 2 = 2x + 1',
      '4) x = −3',
      'Kazanım listesi: tyt.mat.cebir.denklem (Birinci dereceden denklemler), tyt.mat.temel.sayilar (İşlem önceliği, işaret kuralları).',
    ].join('\n'),
    maxTokens: 6000,
    promptVersion: 'live-smoke',
  });
  if (!valid('solution-diagnosis', r.data)) throw new Error('şemaya uymayan çıktı');
  const d = r.data as { failing_step_no: number | null; error_cause: string; verdict: string };
  return { note: `bozulan adım ${d.failing_step_no}, neden ${d.error_cause}, karar ${d.verdict}` };
});

await step('4 Opus 5.5: kısa not (document-ast, code_execution açık)', async () => {
  const r = await gateway.call('notes_generation', {
    system: { product: PRODUCT },
    user: 'Rasyonel sayılarda toplama için çok kısa bir not hazırla: 1 tanım kutusu, 1 çözümlü örnek, 1 şekil (sayı doğrusu), 2 kendini sına sorusu. En çok 2 sayfa.',
    maxTokens: 16000,
    promptVersion: 'live-smoke',
  });
  if (!valid('document-ast', r.data)) throw new Error('şemaya uymayan belge');
  const blocks = (r.data as { blocks?: unknown[] }).blocks?.length ?? 0;
  return { note: `${blocks} blok; araç çağrısı ${r.toolCalls.length}` };
});

const line = (r: Row) => `| ${r.ok ? 'GEÇTİ' : 'KALDI'} | ${r.step} | ${r.model} | ${r.tokensIn}/${r.tokensOut} | ${r.cacheRead} | ${r.costUsd.toFixed(4)} | ${(r.ms / 1000).toFixed(1)} sn | ${r.note.replace(/\|/g, '/')} |`;
const md = [
  '### Gerçek Claude duman testi',
  '| Sonuç | Adım | Model | Giriş/Çıkış token | Önbellek okuma | Maliyet $ | Süre | Not |',
  '|---|---|---|---|---|---|---|---|',
  ...rows.map(line),
  '',
  `Toplam maliyet: **${total().toFixed(4)} $** (bütçe ${BUDGET} $)`,
].join('\n');
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
process.exit(rows.every((r) => r.ok) ? 0 : 1);
