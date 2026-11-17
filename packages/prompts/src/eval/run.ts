/**
 * Eval koşucusu: vakaları geçitten (packages/llm) geçirir ve puanlar. Sahte kipte (OGRENMEN_LLM=fake) her vaka kendi
 * sahte taşımasıyla ve `fake_reply` betiğiyle koşar; gerçek kipte aynı kod Anthropic'e gider. Prompt metni her zaman
 * bu paketten (`loadPrompt`) gelir; ders bloğu eval bağlamından, dossier vakadan.
 */
import { readFileSync } from 'node:fs';
import type { BetaContentBlockParam, BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import {
  createGateway,
  FakeTransport,
  InMemoryLedger,
  InMemoryStore,
  type FakeReply,
  type Gateway,
  type ToolRunners,
} from '@ogrenmen/llm';
import { loadPrompt } from '../index.js';
import { loadCourseContext, type EvalCase } from './cases.js';
import { errorScore, scoreCoach, scoreDiagnosis, scoreExamPageItems, scoreNotes, type CaseScore, type NotesOutput } from './score.js';

/** Depo kökü (eval görselleri `fixtures/...` yoluyla verilir). */
const REPO_ROOT = new URL('../../../../', import.meta.url);

/** Kullanıcı turu: görseller (base64) + metin. Görselsiz vakada düz metin. */
function userContent(c: EvalCase): string | BetaContentBlockParam[] {
  const images = c.input.images ?? [];
  if (images.length === 0) return c.input.user;
  return [
    ...images.map((p): BetaContentBlockParam => ({
      type: 'image',
      source: { type: 'base64', media_type: p.endsWith('.png') ? 'image/png' : 'image/jpeg', data: readFileSync(new URL(p, REPO_ROOT)).toString('base64') },
    })),
    { type: 'text', text: c.input.user },
  ];
}

export type EvalMode = 'fake' | 'anthropic';

export interface CaseResult extends CaseScore {
  promptVersion: string;
  promptHash: string;
  model: string | null;
  costUsd: number;
}

export interface EvalReport {
  mode: EvalMode;
  startedAt: string;
  finishedAt: string;
  results: CaseResult[];
  byRoute: Record<string, { cases: number; passed: number; meanScore: number }>;
  meanScore: number;
}

export interface RunEvalOptions {
  cases: readonly EvalCase[];
  mode: EvalMode;
  /** Gerçek kipte kullanılacak geçit (defter dahil). Sahte kipte her vaka için yeni sahte geçit kurulur. */
  gateway?: Gateway;
  /** Rota başına açık prompt sürümü; verilmezse en yüksek sürüm. */
  versions?: Readonly<Record<string, string>>;
  now?: () => Date;
}

/** Eval öğrencisinin hafıza kimliği (bellek içi depo; gerçek öğrenci değildir). */
const EVAL_STUDENT_ID = '00000000-0000-4000-8000-0000000000e1';

function historyMessages(c: EvalCase): BetaMessageParam[] {
  return (c.input.history ?? []).map((h) => ({ role: h.role, content: h.text }));
}

/** Bu çağrıda asistanın yazdığı tüm metin (araç turlarından önceki ve sonraki). */
function assistantText(transcript: readonly BetaMessageParam[], skip: number): string {
  return transcript
    .slice(skip)
    .filter((m) => m.role === 'assistant')
    .flatMap((m) =>
      typeof m.content === 'string'
        ? [m.content]
        : m.content.flatMap((b) => (b.type === 'text' && typeof b.text === 'string' ? [b.text] : [])),
    )
    .join('\n')
    .trim();
}

async function gatewayFor(c: EvalCase, opts: RunEvalOptions): Promise<Gateway> {
  if (opts.mode === 'anthropic') {
    if (!opts.gateway) throw new Error('gerçek kipte gateway verilmeli');
    return opts.gateway;
  }
  const fake = new FakeTransport();
  if (c.fake_reply.length > 0) fake.enqueue(c.route, ...(c.fake_reply as FakeReply[]));
  return createGateway({ transport: fake, ledger: new InMemoryLedger() });
}

async function runCase(c: EvalCase, opts: RunEvalOptions): Promise<CaseResult> {
  const prompt = loadPrompt(c.route, opts.versions?.[c.route] ? { version: opts.versions[c.route] } : {});
  const meta = { promptVersion: prompt.meta.version, promptHash: prompt.hash };
  const system = {
    product: prompt.text,
    course: c.input.course ? loadCourseContext(c.input.course) : null,
    dossier: c.input.dossier ?? null,
  };
  const turn = { date: c.input.turn.date, mode: c.input.turn.mode, exam: c.input.turn.exam ?? null };
  try {
    const gateway = await gatewayFor(c, opts);
    if (c.route === 'solution_diagnosis') {
      const res = await gateway.call('solution_diagnosis', {
        system,
        user: userContent(c),
        turn,
        promptVersion: prompt.meta.version,
        purpose: 'eval',
      });
      return { ...scoreDiagnosis(c, res.data), ...meta, model: res.model, costUsd: res.costUsd };
    }
    if (c.route === 'exam_page_items') {
      const res = await gateway.call('exam_page_items', {
        system,
        user: userContent(c),
        turn,
        promptVersion: prompt.meta.version,
        purpose: 'eval',
      });
      return { ...scoreExamPageItems(c, res.data), ...meta, model: res.model, costUsd: res.costUsd };
    }
    if (c.route === 'notes_generation') {
      // Figür kipi: sahte kipte ve OGRENMEN_FIGURES=local'da araçsız (kod yazılır, çalıştırılmaz); gerçek yolda
      // OGRENMEN_FIGURES=code_execution ile model kodu konteynerde çalıştırır.
      const codeExecution = opts.mode === 'anthropic' && process.env.OGRENMEN_FIGURES === 'code_execution';
      const res = await gateway.call('notes_generation', {
        system,
        user: userContent(c),
        turn,
        promptVersion: prompt.meta.version,
        purpose: 'eval',
        ...(codeExecution ? {} : { disableTools: ['code_execution'] as const }),
      });
      return { ...scoreNotes(c, res.data as unknown as NotesOutput), ...meta, model: res.model, costUsd: res.costUsd };
    }
    const results = c.input.tool_results ?? {};
    const turnMeta: Record<string, unknown>[] = [];
    const stub = (name: string) => () => JSON.stringify(results[name] ?? { sonuc: [] });
    const runners: ToolRunners = {
      search_evidence: stub('search_evidence'),
      get_mastery: stub('get_mastery'),
      get_recent_exams: stub('get_recent_exams'),
      record_turn_meta: (input) => {
        turnMeta.push(input as Record<string, unknown>);
        return 'kaydedildi';
      },
    };
    const store = new InMemoryStore(() => opts.now?.() ?? new Date());
    for (const [path, content] of Object.entries(c.input.memory ?? {})) {
      await store.write(EVAL_STUDENT_ID, path, content, 'create', 'eval');
    }
    const history = historyMessages(c);
    const res = await gateway.call('coach_chat', {
      system,
      history,
      user: c.input.user,
      turn,
      promptVersion: prompt.meta.version,
      purpose: 'eval',
      tools: { runners, memory: { store, studentId: EVAL_STUDENT_ID, actor: 'coach' } },
    });
    const text = assistantText(res.transcript, history.length);
    return { ...scoreCoach(c, { text, turnMeta }), ...meta, model: res.model, costUsd: res.costUsd };
  } catch (err) {
    return { ...errorScore(c, err), ...meta, model: null, costUsd: 0 };
  }
}

export async function runEval(opts: RunEvalOptions): Promise<EvalReport> {
  const now = opts.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const results: CaseResult[] = [];
  // Sırayla: gerçek kipte hız sınırına takılmamak ve sonuçların sırası deterministik olsun diye.
  for (const c of opts.cases) results.push(await runCase(c, opts));
  const byRoute: EvalReport['byRoute'] = {};
  for (const r of results) {
    const b = (byRoute[r.route] ??= { cases: 0, passed: 0, meanScore: 0 });
    b.cases += 1;
    b.passed += r.pass ? 1 : 0;
    b.meanScore += r.score;
  }
  for (const b of Object.values(byRoute)) b.meanScore = Math.round((b.meanScore / b.cases) * 1000) / 1000;
  const meanScore = results.length === 0 ? 0 : Math.round((results.reduce((s, r) => s + r.score, 0) / results.length) * 1000) / 1000;
  return { mode: opts.mode, startedAt, finishedAt: now().toISOString(), results, byRoute, meanScore };
}
