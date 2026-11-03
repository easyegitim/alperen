/**
 * `practice.generate` ve `practice.prewarm` — alıştırma soru bankası (README "Nerede kaldık": ilk Başla çıkmazı).
 *
 * practice.generate {set_id, enrollment_id, curriculum_id, skill_ids[], count, template_ids[]}: start_practice bankada
 * uygun soru bulamayınca kuyruğa atar (set 'needs_generation'; istemci yoklar). Akış:
 *   1. Set artık bekliyor değilse (doldu, kapandı) iş biter.
 *   2. Hedef yaprakların bankası (public.practice_bank_status) ve ihtiyaç: set.target_count yapraklara sırayla.
 *   3. Şablon yolu (practice/bank.ts) → bankaya yazılır. Şablon + mevcut soru en az yarıyı karşılıyorsa set hemen
 *      doldurulur (öğrenci beklemesin; kalan ön ısıtmayla gelir).
 *   4. Yetmezse LLM yolu (rota question_generation; gerçek taşımada check_spend) → SymPy anahtar denetimi
 *      (py/key_verify.py; çelişen madde atılır) → bankaya yazılır ve set doldurulur
 *      (register_practice_questions: practice_fill_items + 'in_progress').
 *   5. Set hâlâ boşsa: geçici hata pg-boss ile yeniden denenir; son denemede public.fail_practice_generation seti
 *      'abandoned' (generation_failed) kapatır, istemci tek cümle + Bugün'e dön gösterir.
 * Hedef süre: sahte LLM ile < 5 sn, şablonla < 10 sn.
 *
 * practice.prewarm {enrollment_id, skill_ids?, per_skill?, reason?}: ilk öneri için bankayı önceden ısıtır
 * (curriculum.draft bitişi ve suggestions.refresh'in ilk 'practice' kartı kuyruğa atar). Yapraklar: verilen kodlar ya da
 * en zayıf iki yaprak; her yaprakta `per_skill` (8) kullanılabilir teşhis dışı soruya tamamlar (teşhis soruları
 * alıştırmada son çaredir; banka doldukça çekilir) (önce şablon, sonra yaprak başına bir
 * LLM çağrısı). Alıştırması açılamayan müfredatta (otopilotsuz taslak) ücretli üretim yapmaz. Bitince bu kaydın bekleyen
 * (needs_generation) setleri bankadan doldurulur.
 */
import { z } from 'zod';
import { classifyError, type Gateway } from '@ogrenmen/llm';
import type { Db } from '../db.js';
import {
  bankStatus,
  distribute,
  llmPhase,
  LLM_MAX_PER_CALL,
  paidAllowed,
  registerItems,
  templatePhase,
  type BankItem,
  type KeyVerifier,
  type LeafStatus,
  type LlmPhaseResult,
  type TemplateRunner,
} from '../practice/bank.js';
import type { StorageLike } from '../storage.js';
import { PermanentJobError } from './errors.js';
import { acceptCamelAliases, uuid } from './schemas.js';
import type { JobContext, JobDefinition } from './types.js';

const skillCode = z.string().min(1).max(200);

const generatePayload = acceptCamelAliases(
  { setId: 'set_id', enrollmentId: 'enrollment_id', curriculumId: 'curriculum_id', skillIds: 'skill_ids', templateIds: 'template_ids' },
  z
    .object({
      set_id: uuid,
      enrollment_id: uuid,
      curriculum_id: uuid.nullish(),
      skill_ids: z.array(skillCode).max(20).default([]),
      count: z.number().int().min(1).max(10).default(8),
      template_ids: z.array(z.string().max(200)).max(50).default([]),
    })
    .passthrough(),
);
export type PracticeGeneratePayload = z.infer<typeof generatePayload>;

const prewarmPayload = acceptCamelAliases(
  { enrollmentId: 'enrollment_id', skillIds: 'skill_ids', perSkill: 'per_skill' },
  z
    .object({
      enrollment_id: uuid,
      skill_ids: z.array(skillCode).max(20).nullish(),
      per_skill: z.number().int().min(1).max(20).default(8),
      reason: z.string().max(80).nullish(),
    })
    .passthrough(),
);
export type PracticePrewarmPayload = z.infer<typeof prewarmPayload>;

/** Testler şablon çalıştırıcısını ve anahtar doğrulayıcısını değiştirir (Python'suz birim testleri). */
export interface PracticeHooks {
  templateRunner?: TemplateRunner;
  keyVerifier?: KeyVerifier;
}
export const practiceHooks: PracticeHooks = {};

function logVerify(ctx: JobContext, scope: string, ref: string, res: LlmPhaseResult): void {
  const v = res.verify;
  if (v.error) ctx.log.warn(`${scope}: anahtar doğrulayıcı çalışmadı; LLM maddeleri inferred`, { ref, error: v.error });
  if (v.dropped > 0 || v.inferred > 0) {
    ctx.log.warn(`${scope}: LLM anahtar denetimi`, {
      ref, verified: v.verified, inferred: v.inferred, dropped: v.dropped,
      rejected: v.details.filter((d) => d.status === 'mismatch' || d.status === 'ambiguous').slice(0, 5),
    });
  }
}

interface SetRow {
  id: string;
  status: string;
  enrollment_id: string;
  curriculum_id: string;
  skill_ids: string[];
  target_count: number;
  items: number;
  course_title: string;
  student_ref: string | null;
}

async function loadSet(db: Db, setId: string): Promise<SetRow | null> {
  const r = await db.query(
    `select ps.id, ps.status, ps.enrollment_id, e.curriculum_id, ps.skill_ids, ps.target_count,
            (select count(*)::int from public.practice_set_items i where i.set_id = ps.id) as items,
            coalesce(co.title, c.label) as course_title, st.public_ref as student_ref
       from public.practice_sets ps
       join public.enrollments e on e.id = ps.enrollment_id
       join public.curricula c on c.id = e.curriculum_id
       left join public.courses co on co.id = e.course_id
       left join public.students st on st.id = e.student_id
      where ps.id = $1::uuid`,
    [setId],
  );
  return (r.rows[0] as SetRow | undefined) ?? null;
}

function safeStorage(ctx: JobContext): StorageLike | null {
  try {
    return ctx.storage();
  } catch {
    return null;
  }
}

/** Gerçek taşımada ücretli çağrı izni yoksa ya da geçit kurulamıyorsa (anahtar yok) LLM yolu atlanır (null). */
async function llmGateway(ctx: JobContext): Promise<Gateway | null> {
  let gateway: Gateway;
  try {
    gateway = await ctx.gateway();
  } catch (err) {
    ctx.log.warn('practice: LLM geçidi kurulamadı; yalnız şablon yolu', { error: (err as Error).message });
    return null;
  }
  if (gateway.transport.kind !== 'fake') {
    const spend = await paidAllowed(ctx.db);
    if (!spend.ok) {
      ctx.log.warn('practice: ücretli LLM çağrısı kapalı; yalnız şablon yolu', { state: spend.state });
      return null;
    }
  }
  return gateway;
}

function seedOf(id: string, retry: number): number {
  return (parseInt(id.replace(/-/g, '').slice(0, 8), 16) + retry * 7919) % 2_147_483_647;
}

function remaining(need: Map<string, number>, got: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [s, n] of need) out.set(s, Math.max(0, n - (got.get(s) ?? 0)));
  return out;
}

const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

export interface PracticeGenerateResult {
  set_id: string;
  status: string;
  reason?: string;
  template_items?: number;
  llm_items?: number;
  inserted?: number;
  reused?: number;
  filled?: number;
  cost_usd?: number;
  ms?: number;
}

export async function runPracticeGenerate(p: PracticeGeneratePayload, ctx: JobContext): Promise<PracticeGenerateResult> {
  const t0 = Date.now();
  const set = await loadSet(ctx.db, p.set_id);
  if (!set) throw new PermanentJobError(`set yok: ${p.set_id}`, 'OGR-JOB-120');
  if (set.status !== 'needs_generation' || set.items > 0) return { set_id: set.id, status: set.status, reason: 'not_waiting' };

  const bank = await bankStatus(ctx.db, set.enrollment_id, set.skill_ids);
  const leaves: LeafStatus[] = bank.leaves;
  if (leaves.length === 0) throw new PermanentJobError('setin hedef yaprakları müfredatta yok', 'OGR-JOB-121');
  const count = Math.max(1, Math.min(10, set.target_count || p.count));
  const target = distribute(count, leaves.map((l) => l.skill_id));
  const have = new Map(leaves.map((l) => [l.skill_id, l.available]));
  const need = remaining(target, have);

  // yarışta banka dolmuş olabilir: yalnız doldur
  if (sum(need) === 0) {
    const r = await registerItems(ctx.db, set.curriculum_id, [], set.id);
    return { set_id: set.id, status: r.status ?? set.status, reason: 'bank_ready', filled: r.filled, ms: Date.now() - t0 };
  }

  const tpl = await templatePhase({
    db: ctx.db, log: ctx.log, curriculumId: set.curriculum_id, need, leaves, storage: safeStorage(ctx),
    ...(practiceHooks.templateRunner ? { runner: practiceHooks.templateRunner } : {}),
    seed: seedOf(set.id, ctx.job.retryCount), signal: ctx.signal,
  }).catch((e: unknown) => {
    ctx.log.warn('practice.generate: şablon yolu düştü; LLM yoluna geçiliyor', { set: set.id, error: (e as Error).message });
    return { items: [] as BankItem[], perSkill: new Map<string, number>(), errors: [(e as Error).message] };
  });
  if (tpl.errors.length > 0) ctx.log.warn('practice.generate: şablon uyarıları', { set: set.id, errors: tpl.errors.slice(0, 5) });
  const afterTpl = remaining(need, tpl.perSkill);
  const covered = count - sum(afterTpl);
  const enoughNow = covered >= Math.ceil(count / 2);

  const reg1 = await registerItems(ctx.db, set.curriculum_id, tpl.items, enoughNow || sum(afterTpl) === 0 ? set.id : null);
  if (reg1.status === 'in_progress') {
    ctx.log.info('practice.generate: set şablonla doldu', { set: set.id, templates: tpl.items.length, filled: reg1.filled, ms: Date.now() - t0 });
    return { set_id: set.id, status: 'in_progress', template_items: tpl.items.length, inserted: reg1.inserted, reused: reg1.reused, filled: reg1.filled, ms: Date.now() - t0 };
  }

  let llmItems = 0;
  let cost = 0;
  const gateway = await llmGateway(ctx);
  if (gateway && sum(afterTpl) > 0) {
    const llmNeed = new Map([...afterTpl].map(([s, n]) => [s, Math.min(n, LLM_MAX_PER_CALL)]));
    const res = await llmPhase(
      { db: ctx.db, gateway, curriculumId: set.curriculum_id, courseTitle: set.course_title, need: llmNeed, leaves, ref: { table: 'practice_sets', id: set.id }, studentRef: set.student_ref, signal: ctx.signal,
        ...(practiceHooks.keyVerifier ? { verifier: practiceHooks.keyVerifier } : {}) },
      `practice.generate:${ctx.job.id}`,
    );
    logVerify(ctx, 'practice.generate', set.id, res);
    llmItems = res.items.length;
    cost = res.costUsd;
    if (res.dropped > 0) ctx.log.warn('practice.generate: LLM maddelerinin bir kısmı atıldı', { set: set.id, dropped: res.dropped });
    const reg2 = await registerItems(ctx.db, set.curriculum_id, res.items, set.id);
    if (reg2.status === 'in_progress') {
      ctx.log.info('practice.generate: set doldu', { set: set.id, templates: tpl.items.length, llm: llmItems, filled: reg2.filled, costUsd: cost, ms: Date.now() - t0 });
      return { set_id: set.id, status: 'in_progress', template_items: tpl.items.length, llm_items: llmItems, inserted: reg1.inserted + reg2.inserted, reused: reg1.reused + reg2.reused, filled: reg2.filled, cost_usd: cost, ms: Date.now() - t0 };
    }
  }
  // şablon yarıyı karşılamadı ve LLM yok/boş döndü: elde ne varsa onunla doldur
  const reg3 = await registerItems(ctx.db, set.curriculum_id, [], set.id);
  if (reg3.status === 'in_progress') return { set_id: set.id, status: 'in_progress', template_items: tpl.items.length, llm_items: llmItems, filled: reg3.filled, cost_usd: cost, ms: Date.now() - t0 };
  throw new Error(`soru üretilemedi (şablon ${tpl.items.length}, LLM ${llmItems})`);
}

const GENERATE_RETRY = { retryLimit: 2, retryDelay: 5, retryBackoff: true, retryDelayMax: 60, expireInSeconds: 300, deleteAfterSeconds: 7 * 86_400 };

export const practiceGenerateJob: JobDefinition<PracticeGeneratePayload, PracticeGenerateResult> = {
  name: 'practice.generate',
  description: 'Alıştırma sorusu üretimi: şablon (SymPy) → yetmezse LLM (question_generation) → banka + set doldurma; son denemede set generation_failed.',
  process: 'worker',
  payload: generatePayload,
  concurrency: 4,
  retry: GENERATE_RETRY,
  handler: async (p, ctx) => {
    try {
      return await runPracticeGenerate(p, ctx);
    } catch (err) {
      const c = classifyError(err);
      const last = err instanceof PermanentJobError || ctx.job.retryCount >= GENERATE_RETRY.retryLimit || (c.code !== 'unknown' && !c.retryable);
      if (last) {
        try {
          const st = await ctx.db.query('select public.fail_practice_generation($1::uuid, $2) as s', [p.set_id, (err as Error).message.slice(0, 200)]);
          ctx.log.error('practice.generate: üretim kalıcı olarak düştü', { set: p.set_id, status: st.rows[0]?.s, error: (err as Error).message });
          if (st.rows[0]?.s === 'in_progress') return { set_id: p.set_id, status: 'in_progress', reason: 'filled_on_failure' };
        } catch (e2) {
          ctx.log.error('practice.generate: set kapatılamadı', { set: p.set_id, error: (e2 as Error).message });
        }
        if (!(err instanceof PermanentJobError)) throw new PermanentJobError((err as Error).message.slice(0, 300), 'OGR-JOB-122');
      }
      throw err;
    }
  },
};

export interface PracticePrewarmResult {
  enrollment_id: string;
  status: 'warmed' | 'ready' | 'skipped';
  reason?: string;
  leaves?: { skill_id: string; before: number; template: number; llm: number }[];
  inserted?: number;
  filled_sets?: number;
  cost_usd?: number;
  ms?: number;
}

export async function runPracticePrewarm(p: PracticePrewarmPayload, ctx: JobContext): Promise<PracticePrewarmResult> {
  const t0 = Date.now();
  const bank = await bankStatus(ctx.db, p.enrollment_id, p.skill_ids ?? null);
  if (!bank.practicable) return { enrollment_id: p.enrollment_id, status: 'skipped', reason: 'not_practicable' };
  if (bank.leaves.length === 0) return { enrollment_id: p.enrollment_id, status: 'skipped', reason: 'no_leaves' };
  const need = new Map(bank.leaves.map((l) => [l.skill_id, Math.max(0, (p.per_skill ?? 8) - l.available)]));
  const summary = bank.leaves.map((l) => ({ skill_id: l.skill_id, before: l.available, template: 0, llm: 0 }));
  let inserted = 0;
  let cost = 0;
  if (sum(need) > 0) {
    const tpl = await templatePhase({
      db: ctx.db, log: ctx.log, curriculumId: bank.curriculum_id, need, leaves: bank.leaves, storage: safeStorage(ctx),
      ...(practiceHooks.templateRunner ? { runner: practiceHooks.templateRunner } : {}),
      seed: seedOf(p.enrollment_id, ctx.job.retryCount + 1), signal: ctx.signal,
    }).catch((e: unknown) => {
      ctx.log.warn('practice.prewarm: şablon yolu düştü', { enrollment: p.enrollment_id, error: (e as Error).message });
      return { items: [] as BankItem[], perSkill: new Map<string, number>(), errors: [] as string[] };
    });
    inserted += (await registerItems(ctx.db, bank.curriculum_id, tpl.items, null)).inserted;
    for (const s of summary) s.template = tpl.perSkill.get(s.skill_id) ?? 0;
    const rest = remaining(need, tpl.perSkill);
    if (sum(rest) > 0) {
      const gateway = await llmGateway(ctx);
      const title = await ctx.db.query(
        `select coalesce(co.title, c.label) as t, st.public_ref as r from public.enrollments e join public.curricula c on c.id = e.curriculum_id
           left join public.courses co on co.id = e.course_id left join public.students st on st.id = e.student_id where e.id = $1::uuid`,
        [p.enrollment_id],
      );
      for (const [skill, n] of rest) {
        if (!gateway || n <= 0) continue;
        const res = await llmPhase(
          { db: ctx.db, gateway, curriculumId: bank.curriculum_id, courseTitle: String(title.rows[0]?.t ?? ''), need: new Map([[skill, Math.min(n, LLM_MAX_PER_CALL)]]), leaves: bank.leaves, ref: { table: 'enrollments', id: p.enrollment_id }, studentRef: (title.rows[0]?.r as string | undefined) ?? null, signal: ctx.signal,
            ...(practiceHooks.keyVerifier ? { verifier: practiceHooks.keyVerifier } : {}) },
          `practice.prewarm:${ctx.job.id}`,
        );
        logVerify(ctx, 'practice.prewarm', p.enrollment_id, res);
        cost += res.costUsd;
        inserted += (await registerItems(ctx.db, bank.curriculum_id, res.items, null)).inserted;
        const s = summary.find((x) => x.skill_id === skill);
        if (s) s.llm = res.items.length;
      }
    }
  }
  // bu kaydın bekleyen setleri (ör. üretim işi düştü): bankadan doldur
  const waiting = await ctx.db.query(`select ps.id from public.practice_sets ps where ps.enrollment_id = $1::uuid and ps.status = 'needs_generation'`, [p.enrollment_id]);
  let filledSets = 0;
  for (const w of waiting.rows) {
    const r = await registerItems(ctx.db, bank.curriculum_id, [], String(w.id));
    if (r.status === 'in_progress') filledSets++;
  }
  ctx.log.info('practice.prewarm: banka ısıtıldı', { enrollment: p.enrollment_id, reason: p.reason ?? null, inserted, filledSets, costUsd: cost, ms: Date.now() - t0 });
  return { enrollment_id: p.enrollment_id, status: sum(need) === 0 ? 'ready' : 'warmed', leaves: summary, inserted, filled_sets: filledSets, cost_usd: cost, ms: Date.now() - t0 };
}

export const practicePrewarmJob: JobDefinition<PracticePrewarmPayload, PracticePrewarmResult> = {
  name: 'practice.prewarm',
  description: 'İlk öneri için soru bankasını ısıtır (en zayıf/ilk 2 yaprak için 8\'er soru; önce şablon, sonra LLM); bekleyen setleri doldurur.',
  process: 'worker',
  payload: prewarmPayload,
  concurrency: 2,
  retry: { retryLimit: 2, retryDelay: 60, retryBackoff: true, retryDelayMax: 900, expireInSeconds: 600, deleteAfterSeconds: 7 * 86_400 },
  handler: runPracticePrewarm,
};
