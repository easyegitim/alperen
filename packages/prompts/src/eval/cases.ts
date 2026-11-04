/**
 * Eval vakaları: `packages/prompts/eval/<rota>/*.json` (girdi + beklenen alanlar + sahte yanıt betiği).
 *
 * `fake_reply`, OGRENMEN_LLM=fake kipinde geçide sırayla verilen betik yanıtlarıdır (packages/llm FakeReply biçimi);
 * gerçek kipte yok sayılır. Böylece aynı komut sahte kipte boru hattını ve puanlayıcıyı, gerçek anahtarla modeli ölçer.
 * Ders bloğu `input.course` ile `eval/_context/<ders>.course.md` dosyasından okunur.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const EVAL_DIR = fileURLToPath(new URL('../../eval/', import.meta.url));

const turnSchema = z.strictObject({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mode: z.enum(['hint', 'explain', 'solve']).optional(),
  exam: z.string().optional(),
});

const inputSchema = z.strictObject({
  course: z.string().regex(/^[a-z0-9-]+$/).optional(),
  dossier: z.string().optional(),
  turn: turnSchema,
  history: z.array(z.strictObject({ role: z.enum(['user', 'assistant']), text: z.string().min(1) })).optional(),
  user: z.string().min(1),
  /** Hafıza dosyaları (yol → içerik); koç rotalarında bellek içi depoya yüklenir. */
  memory: z.record(z.string().regex(/^\/memories\//), z.string()).optional(),
  /** Araç çalıştırıcılarının döndüreceği sabit veriler (araç adı → JSON). */
  tool_results: z.record(z.string(), z.unknown()).optional(),
  /** Görseller: depo köküne göre yol (`fixtures/...png`); kullanıcı turunda metinden önce base64 görsel bloğu olur. */
  images: z.array(z.string().regex(/^fixtures\/[A-Za-z0-9_./-]+\.(png|jpe?g)$/)).optional(),
});

const fakeReplySchema = z.strictObject({
  text: z.string().optional(),
  json: z.unknown().optional(),
  toolUses: z.array(z.strictObject({ name: z.string(), input: z.unknown() })).optional(),
});

export const diagnosisExpected = z.strictObject({
  verdict: z.enum(['correct', 'wrong', 'incomplete', 'unreadable']),
  failing_step_no: z.number().int().positive().nullable(),
  error_cause: z.enum(['concept', 'procedure', 'careless', 'reading', 'time']).nullable(),
  skill_ids_any: z.array(z.string()).min(1),
  misconception_tags_any: z.array(z.string()).min(1).optional(),
  misconception_tags_empty: z.boolean().optional(),
  proposed_subskill: z.boolean(),
});

export const coachExpected = z.strictObject({
  forbidden_substrings: z.array(z.string()).optional(),
  /** Her grup için en az biri yanıtta geçmeli (büyük/küçük harf duyarsız). */
  required_any: z.array(z.array(z.string()).min(1)).optional(),
  must_ask_question: z.boolean().optional(),
  max_sentences: z.number().int().positive().optional(),
  turn_meta: z
    .strictObject({
      mode_suggestion: z.enum(['hint', 'explain', 'solve']).nullable().optional(),
      escalate_to_instructor: z.boolean().optional(),
      skill_ids_any: z.array(z.string()).min(1).optional(),
    })
    .optional(),
});

const bbox = z.strictObject({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });

export const examPageItemsExpected = z.strictObject({
  item_nos: z.array(z.number().int().positive()),
  continues_on_next: z.array(z.number().int().positive()),
  continues_from_previous: z.array(z.number().int().positive()),
  /** Şekilli sorular ve gerçek kutuları (IoU ≥ 0,5 beklenir). */
  figures: z.array(z.strictObject({ no: z.number().int().positive(), bbox })),
  /** Soru başına beklenen şık metinleri (KaTeX biçim farkları normalize edilir). */
  options: z.array(z.strictObject({ no: z.number().int().positive(), texts: z.array(z.string()) })),
  /** Kökte geçmesi gereken parçalar (normalize, küçük harf). */
  stem_contains: z.array(z.strictObject({ no: z.number().int().positive(), text: z.string().min(1) })),
  unreadable: z.boolean(),
});

const base = {
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(3),
  notes: z.string().optional(),
  input: inputSchema,
  fake_reply: z.array(fakeReplySchema),
};

export const evalCaseSchema = z.discriminatedUnion('route', [
  z.strictObject({ ...base, route: z.literal('solution_diagnosis'), expected: diagnosisExpected }),
  z.strictObject({ ...base, route: z.literal('coach_chat'), expected: coachExpected }),
  z.strictObject({ ...base, route: z.literal('exam_page_items'), expected: examPageItemsExpected }),
]);

export type EvalCase = z.output<typeof evalCaseSchema>;
export type EvalRoute = EvalCase['route'];
export const EVAL_ROUTES: readonly EvalRoute[] = ['coach_chat', 'exam_page_items', 'solution_diagnosis'];

/** Vakaları okur ve doğrular (dosya adına göre sıralı). `route` verilirse yalnız o rota. */
export function loadEvalCases(opts: { dir?: string; route?: string } = {}): EvalCase[] {
  const dir = opts.dir ?? EVAL_DIR;
  const routes = opts.route ? [opts.route] : [...EVAL_ROUTES];
  const out: EvalCase[] = [];
  for (const route of routes) {
    const rdir = join(dir, route);
    if (!existsSync(rdir)) continue;
    for (const f of readdirSync(rdir).filter((x) => x.endsWith('.json')).sort()) {
      const raw: unknown = JSON.parse(readFileSync(join(rdir, f), 'utf8'));
      const res = evalCaseSchema.safeParse(raw);
      if (!res.success) {
        throw new Error(`${route}/${f}: ${res.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      }
      if (res.data.route !== route) throw new Error(`${route}/${f}: route alanı dizinle aynı olmalı`);
      if (`${res.data.id}.json` !== f) throw new Error(`${route}/${f}: id dosya adıyla aynı olmalı`);
      out.push(res.data);
    }
  }
  return out;
}

/** Ders bloğu metni (`eval/_context/<ders>.course.md`). */
export function loadCourseContext(course: string, dir = EVAL_DIR): string {
  return readFileSync(join(dir, '_context', `${course}.course.md`), 'utf8').trim();
}
