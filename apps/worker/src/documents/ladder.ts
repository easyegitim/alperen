/**
 * Doğrulama merdiveni (docs/PLAN-v2.md §7; supabase 0035 `app.document_ladder_steps`):
 *   schema → sympy (anahtar ↔ canonical_expr, py/key_verify.py) → figures (çiz → boş/boyut → figure_check) →
 *   duplicates (belge içi ve banka: questions.content_hash / kök) → personalization (calloutReferenceIssues +
 *   personalization_check). İnceleme (review) ayrı bir insan kapısıdır (review_document).
 *
 * Hata → yalnız o blok yeniden üretilir: her turda bütün basamaklar koşar, sorunlu bloklar tek bir yeniden üretim
 * çağrısında istenir (blok başına sınır `document_block_regen_note` / settings.documents_block_regen_max). Haklar
 * bitince güvenli geri dönüş: hatalı soru (anahtar, şekil, kopya) belgeden çıkar ve sorular yeniden numaralanır, şekli
 * çizilemeyen figür bloğu çıkar ("figürsüz + verification notu"), kaynaksız/uydurma hata kutusu çıkar. Deneme sorusuz
 * kalırsa basamak `fail` olur ve belge üretilemez.
 *
 * verification jsonb (generated_documents.verification; her basamak `{status: pass|fail|skipped, …}`; DB `at` ekler):
 *   schema          {status, route, repaired, rounds}
 *   sympy           {status, checked, verified, inferred, dropped: [{no, reason}], details: [{no, status}]}
 *                   (öğrenci verification'ı okuyabilir: anahtar, doğru şık ya da canonical_expr YAZILMAZ; ayrıntı yalnız
 *                   modele giden yeniden üretim isteğinde ve worker günlüğünde. Doğrulayıcı çalışmazsa `skipped` ve
 *                   deneme/soru seti incelemeye düşer.)
 *   figures         {status, mode, count, rendered: [{block_id, via, width_px, height_px, bytes, check}], removed: [{block_id, reason}]}
 *   duplicates      {status, checked, dropped: [{no, reason}], bank_matches: [no]}
 *   personalization {status, personalized, callouts, model_check: ok|issues|error|skipped, removed: [{block_id, reason}]}
 *                   (kişisel notta hiç hata kutusu yoksa belge düzeyinde `@callout` sorunu yeniden istenir; sonunda kutu
 *                   kalmazsa not kişisel sayılmaz: meta.personalized = false)
 *   regen           [{block_id, step, reason, attempt, at}]  (document_block_regen_note yazar)
 */
import { calloutReferenceIssues, type DocumentAst, type KnownPattern, type PersonalizationCheck } from '@ogrenmen/contracts';
import { classifyError, type Gateway } from '@ogrenmen/llm';
import { personalizationCheckUserText, type PatternInput } from '@ogrenmen/prompts';
import type { Db } from '../db.js';
import type { Logger } from '../log.js';
import { llmContentHash, type KeyCheckResult, type KeyVerifier } from '../practice/bank.js';
import { astIssues, CALLOUT_SLOT, dropBlocks, figureTasks, latexToPlain, setFigureSvg, type Draft } from './draft.js';
import { FigureCache, renderAndCheckFigures, sha, type FigureEnv, type FigureResult } from './figures.js';

export { CALLOUT_SLOT };

export const LADDER_STEPS = ['schema', 'sympy', 'figures', 'duplicates', 'personalization'] as const;
export type LadderStep = (typeof LADDER_STEPS)[number];

export interface Issue {
  block_id: string;
  step: LadderStep;
  /** Saklanabilir neden (verification.regen / dropped; öğrenci okuyabilir: anahtar ya da cevap içermez). */
  reason: string;
  /** Yalnız modele giden ayrıntı (yeniden üretim isteği); yoksa reason. */
  detail?: string;
  /** Soru bloğuysa numarası. */
  no?: number;
}

export type StepReport = { status: 'pass' | 'fail' | 'skipped' } & Record<string, unknown>;

export interface RegenOutcome {
  draft: Draft;
  replaced: string[];
  /** Yalnız bu merdivenin kendi ek maliyeti. Yeniden üretim çağrısının maliyeti gateway'de zaten sayılır: 0 bildirilir. */
  costUsd: number;
}

export interface LadderEnv {
  db: Db;
  log: Logger;
  gateway: Gateway;
  docId: string;
  curriculumId: string;
  ref: { table: string; id: string };
  studentRef: string | null;
  signal?: AbortSignal;
  verifier: KeyVerifier;
  figures: FigureEnv;
  /** code_execution figür çıktıları: kod özeti → SVG (ilk çağrı ve yeniden üretim turları ekler). */
  remoteFigures: Map<string, string>;
  /** Not kişiselleştirildi mi (hatalar dahil ve gerçek örüntü var). */
  personalized: boolean;
  known: readonly KnownPattern[];
  patterns: readonly PatternInput[];
  personalizationPrompt: { text: string; version: string } | null;
  /** En çok yeniden üretim turu. */
  maxRounds: number;
  /** Bloğun yeniden üretim hakkını yazar ve kalan hakkı döner (document_block_regen_note). */
  noteRegen(issue: Issue, attempt: number): Promise<{ allowed: boolean }>;
  /** Sorunlu blokları tek çağrıda yeniden ürettirir. */
  regenerate(draft: Draft, issues: readonly Issue[]): Promise<RegenOutcome>;
}

export interface LadderResult {
  ok: boolean;
  /** Başarısızsa öğrenciye/istek satırına yazılacak Türkçe neden. */
  error: string | null;
  draft: Draft;
  /** SVG'leri yazılmış, düşen blokları çıkarılmış son AST (anahtarlar keys[]'te). */
  final: DocumentAst;
  verification: Record<LadderStep, StepReport>;
  /** Anahtarlar denetlenemedi (doğrulayıcı çalışmadı): deneme/soru seti eğitmen incelemesine gider. */
  reviewRequired: boolean;
  rounds: number;
  costUsd: number;
}

const norm = (s: string) => s.split(/\s+/).filter(Boolean).join(' ').toLocaleLowerCase('tr');

// ------------------------------------------------------------------------------------------------ basamaklar

interface SympyOut {
  issues: Issue[];
  /** Saklanır: yalnız numara ve durum (ayrıntı anahtarı ele verir). */
  details: { no: number; status: KeyCheckResult['status'] }[];
  /** Doğrulayıcı çalışmadıysa nedeni (anahtarlar denetlenmedi). */
  unavailable?: string;
}

export async function sympyStep(ast: DocumentAst, verifier: KeyVerifier, signal?: AbortSignal, log?: Logger): Promise<SympyOut> {
  const qs = ast.blocks.filter((b): b is Extract<typeof b, { type: 'question' }> => b.type === 'question');
  if (qs.length === 0) return { issues: [], details: [] };
  const items = qs.map((q) => {
    const k = ast.keys.find((x) => x.question_no === q.no);
    return {
      id: q.id,
      kind: q.options.length > 0 ? ('mcq' as const) : ('numeric' as const),
      canonical_expr: k?.canonical_expr ? latexToPlain(k.canonical_expr) : null,
      numeric_value: k?.numeric_value != null ? String(k.numeric_value) : null,
      correct_option: k?.correct_option ?? null,
      options: q.options.map((o) => ({ key: o.key, text: latexToPlain(o.text) })),
    };
  });
  let results: KeyCheckResult[];
  try {
    results = await verifier(items, signal);
  } catch (e) {
    // doğrulayıcı çalışmadı: anahtarlar denetlenemedi; basamak `skipped`, deneme/soru seti incelemeye düşer
    log?.warn('document.generate: anahtar doğrulayıcı çalışmadı', { error: (e as Error).message.slice(0, 300) });
    return { issues: [], details: [], unavailable: 'doğrulayıcı çalışmadı' };
  }
  const byId = new Map(results.map((r) => [r.id, r]));
  const issues: Issue[] = [];
  const details: SympyOut['details'] = [];
  for (const q of qs) {
    const r = byId.get(q.id) ?? { id: q.id, status: 'inferred' as const, detail: 'sonuç yok' };
    details.push({ no: q.no, status: r.status });
    if (r.status === 'mismatch' || r.status === 'ambiguous') {
      issues.push({ block_id: q.id, no: q.no, step: 'sympy', reason: `soru ${q.no} anahtarı doğrulanamadı`, detail: `soru ${q.no} anahtarı tutmuyor: ${r.detail}`.slice(0, 500) });
    }
  }
  if (issues.length > 0) log?.info('document.generate: anahtar uyuşmazlığı', { issues: issues.map((i) => i.detail) });
  return { issues, details };
}

export async function duplicatesStep(db: Db, ast: DocumentAst, curriculumId: string): Promise<{ issues: Issue[]; bankMatches: number[]; checked: number }> {
  const qs = ast.blocks.filter((b): b is Extract<typeof b, { type: 'question' }> => b.type === 'question');
  const issues: Issue[] = [];
  const seen = new Map<string, number>();
  for (const q of qs) {
    const key = `${norm(q.stem)}|${q.options.map((o) => norm(o.text)).join('|')}`;
    const first = seen.get(key);
    if (first !== undefined) issues.push({ block_id: q.id, no: q.no, step: 'duplicates', reason: `soru ${q.no}, soru ${first} ile aynı` });
    else seen.set(key, q.no);
  }
  if (qs.length === 0) return { issues, bankMatches: [], checked: 0 };
  const hashes = qs.map((q) => llmContentHash(curriculumId, q.skill_ids, q.stem, q.options));
  const stems = qs.map((q) => norm(q.stem));
  const r = await db.query(
    `select q.content_hash, lower(regexp_replace(btrim(q.stem), '\\s+', ' ', 'g')) as stem from public.questions q
      where q.content_hash = any($1::text[]) or (q.curriculum_id = $2::uuid and lower(regexp_replace(btrim(q.stem), '\\s+', ' ', 'g')) = any($3::text[]))
      limit 200`,
    [hashes, curriculumId, stems],
  );
  const hit = new Set(r.rows.flatMap((x) => [String(x.content_hash), `stem:${String(x.stem)}`]));
  const bankMatches = qs.filter((q, i) => hit.has(hashes[i]!) || hit.has(`stem:${stems[i]}`)).map((q) => q.no);
  return { issues, bankMatches, checked: qs.length };
}

const CALLOUT_PROBLEM: Record<string, string> = {
  missing_ref: 'kişisel hata kutusu kaynak (pattern_ref) taşımıyor',
  unknown_pattern: 'hata kutusu öğrencinin örüntülerinde olmayan bir kayda başvuruyor',
  date_mismatch: 'hata kutusunun tarihi örüntünün gözlendiği günlerden biri değil',
  ref_in_generic_note: 'kişiselleştirilmemiş notta kişisel başvurulu hata kutusu',
  text_mismatch: 'kutu metni başvurduğu örüntüyü anlatmıyor',
  generic: 'kutu kişisel değil, genel bir uyarı',
};

export interface PersonalizationOut {
  issues: Issue[];
  callouts: number;
  modelCheck: 'ok' | 'issues' | 'error' | 'skipped';
  costUsd: number;
}

export async function personalizationStep(env: LadderEnv, ast: DocumentAst, cache: Map<string, PersonalizationCheck | 'error'>): Promise<PersonalizationOut> {
  const callouts = ast.blocks.filter((b): b is Extract<typeof b, { type: 'common_mistake_callout' }> => b.type === 'common_mistake_callout');
  if (ast.kind === 'notes' && env.personalized && callouts.length === 0) {
    return {
      issues: [
        {
          block_id: CALLOUT_SLOT,
          step: 'personalization',
          reason: 'kişisel notta "Senin sık yaptığın hata" kutusu yok',
          detail:
            'Kişisel notta öğrencinin örüntülerinden en az birine pattern_ref ile başvuran bir common_mistake_callout bloğu olmalı. Uygun bölüme yeni bir kutu ekle (yeni, benzersiz bir blok kimliğiyle); öteki blokları değiştirme.',
        },
      ],
      callouts: 0,
      modelCheck: 'skipped',
      costUsd: 0,
    };
  }
  if (ast.kind !== 'notes' || callouts.length === 0) return { issues: [], callouts: callouts.length, modelCheck: 'skipped', costUsd: 0 };
  const issues: Issue[] = calloutReferenceIssues({ kind: ast.kind, meta: { personalized: env.personalized }, blocks: ast.blocks }, env.known).map((x) => ({
    block_id: x.block_id,
    step: 'personalization' as const,
    reason: CALLOUT_PROBLEM[x.problem] ?? x.problem,
  }));
  const bad = new Set(issues.map((i) => i.block_id));
  const toCheck = callouts.filter((c) => c.pattern_ref && !bad.has(c.id));
  if (!env.personalized || toCheck.length === 0 || !env.personalizationPrompt || env.patterns.length === 0) {
    return { issues, callouts: callouts.length, modelCheck: 'skipped', costUsd: 0 };
  }
  const input = { callouts: toCheck.map((c) => ({ block_id: c.id, pattern_ref: c.pattern_ref ?? null, text: c.text })), patterns: [...env.patterns] };
  const key = sha(JSON.stringify(input));
  let res = cache.get(key);
  let cost = 0;
  if (!res) {
    try {
      const call = await env.gateway.call('personalization_check', {
        system: { product: env.personalizationPrompt.text },
        user: personalizationCheckUserText(input),
        promptVersion: env.personalizationPrompt.version,
        ref: env.ref,
        studentRef: env.studentRef,
        purpose: 'document.generate',
        ...(env.signal ? { signal: env.signal } : {}),
      });
      res = call.data as PersonalizationCheck;
      cost = call.costUsd;
    } catch (err) {
      if (classifyError(err).retryable) throw err;
      env.log.warn('document.generate: personalization_check düştü; yalnız deterministik denetim', { document: env.docId, error: (err as Error).message });
      res = 'error';
    }
    cache.set(key, res);
  }
  if (res === 'error') return { issues, callouts: callouts.length, modelCheck: 'error', costUsd: cost };
  const known = new Set(toCheck.map((c) => c.id));
  for (const f of res.findings) {
    if (!known.has(f.block_id) || issues.some((i) => i.block_id === f.block_id)) continue;
    issues.push({ block_id: f.block_id, step: 'personalization', reason: `${CALLOUT_PROBLEM[f.problem] ?? f.problem}: ${f.note}`.slice(0, 300) });
  }
  for (const id of res.offending_block_ids) {
    if (known.has(id) && !issues.some((i) => i.block_id === id)) issues.push({ block_id: id, step: 'personalization', reason: CALLOUT_PROBLEM.generic! });
  }
  return { issues, callouts: callouts.length, modelCheck: res.ok ? 'ok' : 'issues', costUsd: cost };
}

// ------------------------------------------------------------------------------------------------ merdiven

interface RoundOut {
  issues: Issue[];
  sympy: SympyOut;
  figures: FigureResult[];
  dup: Awaited<ReturnType<typeof duplicatesStep>>;
  pers: PersonalizationOut;
}

async function checkAll(env: LadderEnv, draft: Draft, figCache: FigureCache, persCache: Map<string, PersonalizationCheck | 'error'>): Promise<RoundOut> {
  const ast = draft.ast;
  const sympy = await sympyStep(ast, env.verifier, env.signal, env.log);
  const figures = await renderAndCheckFigures(env.figures, figureTasks(ast), env.remoteFigures, figCache);
  const dup = await duplicatesStep(env.db, ast, env.curriculumId);
  const pers = await personalizationStep(env, ast, persCache);
  const qNo = new Map(ast.blocks.filter((b) => b.type === 'question').map((b) => [b.id, (b as { no: number }).no]));
  const figIssues: Issue[] = figures
    .filter((f) => !f.ok)
    .map((f) => ({ block_id: f.block_id, step: 'figures', reason: f.reason ?? 'figür üretilemedi', ...(f.detail ? { detail: f.detail } : {}), ...(qNo.has(f.block_id) ? { no: qNo.get(f.block_id)! } : {}) }));
  return { issues: [...sympy.issues, ...figIssues, ...dup.issues, ...pers.issues], sympy, figures, dup, pers };
}

export async function runLadder(env: LadderEnv, start: Draft, schema: { route: string; repaired: boolean }): Promise<LadderResult> {
  const figCache = new FigureCache();
  const persCache = new Map<string, PersonalizationCheck | 'error'>();
  const attempts = new Map<string, number>();
  let draft = start;
  let cost = 0;
  let rounds = 0;
  let last = await checkAll(env, draft, figCache, persCache);
  cost += last.pers.costUsd;
  while (last.issues.length > 0 && rounds < env.maxRounds) {
    const want: Issue[] = [];
    for (const issue of last.issues) {
      if (want.some((w) => w.block_id === issue.block_id)) continue;
      const n = (attempts.get(issue.block_id) ?? 0) + 1;
      const { allowed } = await env.noteRegen(issue, n);
      if (!allowed) continue;
      attempts.set(issue.block_id, n);
      want.push(issue);
    }
    if (want.length === 0) break;
    rounds++;
    const out = await env.regenerate(draft, want);
    cost += out.costUsd;
    if (out.replaced.length === 0) {
      env.log.warn('document.generate: yeniden üretim hiçbir bloğu değiştirmedi', { document: env.docId, blocks: want.map((w) => w.block_id) });
    } else {
      const bad = astIssues(out.draft.ast);
      if (bad.length > 0) env.log.warn('document.generate: yeniden üretilen bloklar şemayı bozdu; eski bloklar korunuyor', { document: env.docId, issues: bad });
      else draft = out.draft;
    }
    last = await checkAll(env, draft, figCache, persCache);
    cost += last.pers.costUsd;
  }
  cost += figCache.costUsd;

  // haklar bitti: güvenli geri dönüş (hatalı blok belgeden çıkar)
  const drop = new Set(last.issues.map((i) => i.block_id));
  const removed = (step: LadderStep) => last.issues.filter((i) => i.step === step).map((i) => ({ block_id: i.block_id, ...(i.no !== undefined ? { no: i.no } : {}), reason: i.reason }));
  let final = draft.ast;
  for (const f of last.figures) if (f.ok && f.svg && !drop.has(f.block_id)) final = setFigureSvg(final, f.block_id, f.svg);
  const hadQuestions = final.blocks.some((b) => b.type === 'question');
  if (drop.size > 0) {
    env.log.warn('document.generate: doğrulanamayan bloklar belgeden çıkarıldı', { document: env.docId, issues: last.issues.map((i) => `${i.step}:${i.block_id}`) });
    final = dropBlocks(final, drop).ast;
  }
  // çizilemeyen kodlu figür kalmamalı (kod saklanan belgeye giremez)
  const leftover = final.blocks.filter((b) => (b.type === 'figure' && b.figure_code) || (b.type === 'question' && b.figure?.figure_code)).map((b) => b.id);
  if (leftover.length > 0) final = dropBlocks(final, new Set(leftover)).ast;

  // kişisel not ama hiç hata kutusu kalmadı: not kişisel sayılmaz (kapak/rozet genel metne döner)
  const calloutsLeft = final.blocks.filter((b) => b.type === 'common_mistake_callout').length;
  if (final.kind === 'notes' && final.meta.personalized && calloutsLeft === 0) {
    env.log.warn('document.generate: kişisel notta hata kutusu kalmadı; not kişiselleştirilmemiş sayılıyor', { document: env.docId });
    final = { ...final, meta: { ...final.meta, personalized: false } };
  }

  const questions = final.blocks.filter((b) => b.type === 'question').length;
  const lostAll = hadQuestions && questions === 0 && final.kind !== 'notes';
  const shape = astIssues(final);
  const vSympy = last.sympy.details;
  const keysUnchecked = last.sympy.unavailable !== undefined;
  const verification: Record<LadderStep, StepReport> = {
    schema: shape.length > 0 ? { status: 'fail', route: schema.route, repaired: schema.repaired, rounds, issues: shape } : { status: 'pass', route: schema.route, repaired: schema.repaired, rounds },
    sympy: keysUnchecked
      ? { status: 'skipped', reason: last.sympy.unavailable!, checked: 0, dropped: removed('sympy') }
      : vSympy.length === 0
        ? { status: 'skipped', reason: 'soru yok' }
        : {
            status: lostAll ? 'fail' : 'pass',
            checked: vSympy.length,
            verified: vSympy.filter((d) => d.status === 'verified').length,
            inferred: vSympy.filter((d) => d.status === 'inferred').length,
            dropped: removed('sympy'),
            details: vSympy.slice(0, 60),
          },
    figures:
      last.figures.length === 0
        ? { status: 'skipped', reason: 'figür yok' }
        : {
            status: 'pass',
            mode: env.figures.mode,
            count: last.figures.length,
            rendered: last.figures.filter((f) => f.ok && !drop.has(f.block_id)).map((f) => ({ block_id: f.block_id, via: f.via, width_px: f.width_px, height_px: f.height_px, bytes: f.bytes, check: f.check })),
            removed: removed('figures'),
          },
    duplicates:
      last.dup.checked === 0
        ? { status: 'skipped', reason: 'soru yok' }
        : { status: lostAll ? 'fail' : 'pass', checked: last.dup.checked, dropped: removed('duplicates'), bank_matches: last.dup.bankMatches },
    personalization:
      final.kind !== 'notes' || (last.pers.callouts === 0 && !env.personalized)
        ? { status: 'skipped', reason: final.kind !== 'notes' ? 'yalnız not' : 'kişiselleştirilmemiş not' }
        : { status: 'pass', personalized: final.meta.personalized, callouts: calloutsLeft, model_check: last.pers.modelCheck, removed: removed('personalization') },
  };
  const failed = LADDER_STEPS.filter((s) => verification[s].status === 'fail');
  const error = failed.length === 0 ? null : lostAll ? 'Sorular doğrulamadan geçmedi; belge hazırlanamadı.' : 'Belge biçim denetiminden geçmedi.';
  const reviewRequired = keysUnchecked && final.kind !== 'notes' && questions > 0;
  return { ok: failed.length === 0, error, draft, final, verification, reviewRequired, rounds, costUsd: cost };
}
