/**
 * Eval komutu (PLAN-v2 §6). Sahte kipte de gerçek anahtarla da aynı komut:
 *
 *   OGRENMEN_LLM=fake bun scripts/eval.ts                 boru hattı + puanlayıcı (betik yanıtlarla; hepsi geçmeli)
 *   ANTHROPIC_API_KEY=… bun scripts/eval.ts               gerçek model (ücretli; vakalar sırayla)
 *
 *   --route <rota>      yalnız bu rota (solution_diagnosis | coach_chat | exam_page_items | notes_generation)
 *   --version <rota=vN> rota için prompt sürümü (birden çok verilebilir); yoksa en yüksek sürüm
 *   --out <dosya>       raporu JSON olarak yaz
 *   --min-score <0..1>  ortalama puan bunun altındaysa çıkış 1 (sahte kipte varsayılan 1, gerçek kipte 0)
 *
 * Henüz yok (P1 sonrası): eval_judge (Opus hakem, Batch) puanı ve eval_runs tablosuna yazım; aktivasyon kapısı
 * (yeni sürüm hakem puanında belirgin düşerse prompt_versions.active açılmaz).
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGateway, InMemoryLedger } from '@ogrenmen/llm';
import { loadEvalCases, runEval, type EvalMode } from '../src/eval/index.js';

function arg(argv: string[], name: string): string[] {
  const out: string[] = [];
  argv.forEach((a, i) => {
    if (a === name && argv[i + 1] !== undefined) out.push(argv[i + 1] as string);
    else if (a.startsWith(`${name}=`)) out.push(a.slice(name.length + 1));
  });
  return out;
}

async function main(argv: string[]): Promise<number> {
  const mode: EvalMode = process.env.OGRENMEN_LLM === 'fake' ? 'fake' : 'anthropic';
  if (mode === 'anthropic' && !process.env.ANTHROPIC_API_KEY) {
    console.error('HATA: ANTHROPIC_API_KEY yok; sahte kip için OGRENMEN_LLM=fake ile çalıştırın');
    return 2;
  }
  const route = arg(argv, '--route')[0];
  const versions = Object.fromEntries(arg(argv, '--version').map((v) => v.split('=') as [string, string]));
  const minRaw = arg(argv, '--min-score')[0];
  const minScore = minRaw !== undefined ? Number(minRaw) : mode === 'fake' ? 1 : 0;
  const cases = loadEvalCases(route ? { route } : {});
  if (cases.length === 0) {
    console.error(`HATA: vaka yok${route ? ` (${route})` : ''}`);
    return 2;
  }
  // Gerçek kipte defter bellek içidir (eval maliyeti raporda); llm_calls'a yazım eval_runs ile birlikte gelecek.
  const gateway = mode === 'anthropic' ? await createGateway({ ledger: new InMemoryLedger() }) : undefined;
  const report = await runEval({ cases, mode, gateway, versions });
  for (const r of report.results) {
    const failed = r.checks.filter((c) => !c.pass).map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ''}`);
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.score.toFixed(2)}  ${r.route}/${r.id} @${r.promptVersion}${failed.length ? `  — ${failed.join('; ')}` : ''}`);
  }
  for (const [rt, b] of Object.entries(report.byRoute)) console.log(`${rt}: ${b.passed}/${b.cases} geçti, ortalama ${b.meanScore}`);
  const cost = report.results.reduce((s, r) => s + r.costUsd, 0);
  console.log(`kip: ${mode}; ortalama puan ${report.meanScore}; maliyet ${cost.toFixed(4)} $`);
  const out = arg(argv, '--out')[0];
  if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  if (report.meanScore < minScore) {
    console.error(`HATA: ortalama puan ${report.meanScore} < ${minScore}`);
    return 1;
  }
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main(process.argv.slice(2)));
