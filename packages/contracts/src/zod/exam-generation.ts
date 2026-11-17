/**
 * exam-generation — Opus 5.5 deneme/soru seti üretimi (PLAN-v2 Akış 5, §7): sorular ve ayrı anahtar.
 *
 * P3 ekleri (strict kipte zorunlu, loose kipte isteğe bağlı: eski veri ve alıştırma setleri alansız geçerli):
 *   - `items[].figure` {kind, figure_code, alt} | null: figür koddan (matplotlib ya da SVG metni); worker çalıştırıp
 *     `figure_svg`'yi doldurur. Model çıktısında figure dolu iken figure_svg null'dır.
 *   - `blueprint` {sections[{name, count}], difficulty{easy, medium, hard}} | null: istenen bölüm ve zorluk dağılımı;
 *     verilirse bölüm adları dağılımla uyuşur (parse kuralı); sayımlar ve kopyanın istekle eşitliği `examBlueprintIssues` ile
 *     (worker, istekteki dağılıma karşı) denetlenir; düşürmez. Alıştırma üretiminde (question_generation) null.
 */
import { z } from 'zod';
import {
  DIFFICULTY_BANDS,
  FIGURE_CODE_KINDS,
  exactlyOneKeyValue,
  figureFileFromCode,
  figureFileName,
  keyEntryShape,
  optionKey5,
  skillCode,
  type FigureCodeKind,
} from './common.js';
import { type Ctx, addIssue, defineContract, optionalAdded } from './kit.js';

/** Kodla üretilen soru şekli: dil, kod ve düz anlatım. */
export function generatedFigure(c: Ctx) {
  return z
    .strictObject({
      kind: z.enum(FIGURE_CODE_KINDS),
      figure_code: c.str({ min: 20, max: 20000, desc: 'kind=matplotlib: figure_<n>.svg yazan Python (matplotlib/numpy); kind=svg: SVG metni' }),
      alt: c.str({ min: 5, max: 400, desc: 'Şekli kelimelerle anlatır' }),
    })
    .nullable()
    .describe('Kodla üretilen soru şekli; şekilsiz soruda null');
}

/**
 * Üretilen soru: `exam-generation` ve `question-generation` aynı biçimi paylaşır. `style_id` denemede null olabilir,
 * tarza özel üretimde zorunludur. `difficulty` bandı `exam_questions.difficulty` sayısına `DIFFICULTY_BAND_VALUE` ile çevrilir.
 */
export function generatedItem(c: Ctx, opts: { styleRequired: boolean }) {
  return z.strictObject({
    no: c.int({ min: 1, max: 500 }),
    section: c.str({ max: 80 }),
    kind: z.enum(['mcq', 'numeric']),
    stem: c.str({ min: 10, max: 2500 }),
    options: c.arr(z.strictObject({ key: optionKey5, text: c.str({ min: 1, max: 600 }) }), { max: 5 }),
    figure_svg: c.str({ max: 60000 }).nullable().describe('Soru şekli satır içi SVG (worker figure kodundan üretir); model figure verdiyse null'),
    figure: optionalAdded(c, generatedFigure(c)),
    skill_ids: c.arr(skillCode(c), { min: 1, max: 3 }),
    style_id: (opts.styleRequired ? c.uuid('question_styles.id') : c.uuid('question_styles.id').nullable()) as z.ZodType<string | null>,
    difficulty: z.enum(DIFFICULTY_BANDS),
  });
}

/** Üretilen soru için ayrı doğrulanacak anahtar satırı (çözüm dahil). */
export function generatedKey(c: Ctx) {
  return z.strictObject({ ...keyEntryShape(c), solution: c.str({ min: 10, max: 2000, desc: 'Adım adım çözüm' }) });
}

/** İstenen dağılım: bölüm başına soru sayısı ve zorluk bandı sayıları. */
export function examBlueprint(c: Ctx) {
  return z
    .strictObject({
      sections: c.arr(z.strictObject({ name: c.str({ min: 1, max: 80 }), count: c.int({ min: 1, max: 200 }) }), { min: 1, max: 12 }),
      difficulty: z.strictObject({ easy: c.int({ min: 0, max: 200 }), medium: c.int({ min: 0, max: 200 }), hard: c.int({ min: 0, max: 200 }) }),
    })
    .nullable()
    .describe('İstekteki bölüm ve zorluk dağılımı (sorular buna birebir uyar); alıştırma setinde null');
}

type GeneratedSet = {
  items: z.output<ReturnType<typeof generatedItem>>[];
  keys: z.output<ReturnType<typeof generatedKey>>[];
  blueprint?: z.output<ReturnType<typeof examBlueprint>> | undefined;
};

/** Soru ↔ anahtar çapraz kuralları (iki sözleşme için ortak). */
export function refineGeneratedSet(v: GeneratedSet, ctx: z.RefinementCtx): void {
  const nos = new Set<number>();
  v.items.forEach((it, i) => {
    if (nos.has(it.no)) addIssue(ctx, ['items', i, 'no'], `yinelenen soru numarası: ${it.no}`);
    nos.add(it.no);
    if (it.kind === 'mcq') {
      if (it.options.length < 4) addIssue(ctx, ['items', i, 'options'], 'çoktan seçmelide en az dört şık gerekir');
      it.options.forEach((o, j) => {
        if (o.key !== 'ABCDE'[j]) addIssue(ctx, ['items', i, 'options', j, 'key'], 'şık anahtarları A, B, C, D, E sırasında olmalı');
      });
    } else if (it.options.length > 0) addIssue(ctx, ['items', i, 'options'], 'sayısal soruda şık olmaz');
    if (it.figure && it.figure_svg !== null) addIssue(ctx, ['items', i, 'figure_svg'], 'figure verilen soruda figure_svg null kalır (worker üretir)');
  });
  if (v.blueprint) refineBlueprint(v.blueprint, v.items, ctx);
  const keyNos = new Set<number>();
  v.keys.forEach((k, i) => {
    if (keyNos.has(k.question_no)) addIssue(ctx, ['keys', i, 'question_no'], `yinelenen anahtar: ${k.question_no}`);
    keyNos.add(k.question_no);
    const item = v.items.find((it) => it.no === k.question_no);
    if (!item) return addIssue(ctx, ['keys', i, 'question_no'], `anahtarın sorusu yok: ${k.question_no}`);
    if (!exactlyOneKeyValue(k)) return addIssue(ctx, ['keys', i], 'correct_option ile numeric_value\'dan tam biri dolu olmalı');
    if (item.kind === 'mcq' && (k.correct_option === null || !item.options.some((o) => o.key === k.correct_option))) {
      addIssue(ctx, ['keys', i, 'correct_option'], 'doğru şık seçeneklerden biri olmalı');
    }
    if (item.kind === 'numeric' && k.numeric_value === null) addIssue(ctx, ['keys', i, 'numeric_value'], 'sayısal soruda numeric_value zorunlu');
  });
  for (const no of nos) if (!keyNos.has(no)) addIssue(ctx, ['keys'], `soru ${no} için anahtar yok`);
}

export const examGeneration = defineContract({
  name: 'exam-generation',
  title: 'ExamGeneration',
  description: 'Üretilen deneme/soru seti: sorular (items) ve doğrulanacak cevap anahtarı (keys) ayrı döner.',
  llmOutput: true,
  build: (c) =>
    z.strictObject({
      title: c.str({ min: 1, max: 200 }),
      blueprint: optionalAdded(c, examBlueprint(c)),
      items: c.arr(generatedItem(c, { styleRequired: false }), { min: 1, max: 200 }),
      keys: c.arr(generatedKey(c), { min: 1, max: 200 }),
    }),
  refine: (v, ctx) => refineGeneratedSet(v, ctx),
});

export type ExamGeneration = z.output<typeof examGeneration.strict>;

/** Dağılım şekil kuralı (parse'ı düşürür): yinelenen bölüm adı, dağılımda olmayan bölüm. Sayımlar `blueprintIssues`'tadır. */
function refineBlueprint(
  bp: NonNullable<GeneratedSet['blueprint']>,
  items: GeneratedSet['items'],
  ctx: z.RefinementCtx,
): void {
  const names = new Set<string>();
  bp.sections.forEach((sec, i) => {
    if (names.has(sec.name)) addIssue(ctx, ['blueprint', 'sections', i, 'name'], `yinelenen bölüm: ${sec.name}`);
    names.add(sec.name);
  });
  items.forEach((it, i) => {
    if (!names.has(it.section)) addIssue(ctx, ['items', i, 'section'], `dağılımda olmayan bölüm: ${it.section}`);
  });
}

/** İstenen dağılımın tipi (`examBlueprint` çıktısının dolu hali). */
export type ExamBlueprint = NonNullable<z.output<ReturnType<typeof examBlueprint>>>;

/** Dağılım sayım uyuşmazlığı: bölüm bazında eksik/fazla soru ve zorluk bandı sayıları (parse'ı düşürmez).
 * `copy`: modelin yazdığı blueprint kopyası istekteki dağılımla birebir aynı değil (expected/actual 0). */
export interface BlueprintIssue {
  kind: 'section' | 'difficulty' | 'copy';
  /** Bölüm adı, zorluk bandı ya da 'blueprint' (kopya). */
  name: string;
  expected: number;
  actual: number;
}

/** Blueprint sayımlarını sorularla karşılaştırır; uyuşmayanları verir (blueprint yoksa boş). Worker yalnız o bölümü yeniden ister. */
export function blueprintIssues(exam: {
  blueprint?: { sections: readonly { name: string; count: number }[]; difficulty: Readonly<Record<(typeof DIFFICULTY_BANDS)[number], number>> } | null | undefined;
  items: readonly { section: string; difficulty: string }[];
}): BlueprintIssue[] {
  const bp = exam.blueprint;
  if (!bp) return [];
  const out: BlueprintIssue[] = [];
  for (const sec of bp.sections) {
    const actual = exam.items.filter((it) => it.section === sec.name).length;
    if (actual !== sec.count) out.push({ kind: 'section', name: sec.name, expected: sec.count, actual });
  }
  for (const band of DIFFICULTY_BANDS) {
    const actual = exam.items.filter((it) => it.difficulty === band).length;
    if (actual !== bp.difficulty[band]) out.push({ kind: 'difficulty', name: band, expected: bp.difficulty[band], actual });
  }
  return out;
}

/** Kopyanın istekle birebir aynı olup olmadığı (bölüm sırası, adı, sayısı ve zorluk bantları). */
export function sameBlueprint(a: ExamBlueprint, b: ExamBlueprint): boolean {
  return (
    a.sections.length === b.sections.length &&
    a.sections.every((s, i) => s.name === b.sections[i]!.name && s.count === b.sections[i]!.count) &&
    DIFFICULTY_BANDS.every((band) => a.difficulty[band] === b.difficulty[band])
  );
}

/**
 * Worker'ın kullandığı denetim: `requested` istekteki dağılımdır (kaynak). Çıktının blueprint kopyası istekle aynı değilse
 * ya da sorular istekteki sayımlarla tutmuyorsa sorunları döner. Model kopyası güvenilir kaynak değildir; denetim isteğe bakar.
 */
export function examBlueprintIssues(
  requested: ExamBlueprint,
  exam: { blueprint?: ExamBlueprint | null | undefined; items: readonly { section: string; difficulty: string }[] },
): BlueprintIssue[] {
  const copy: BlueprintIssue[] =
    exam.blueprint && sameBlueprint(exam.blueprint, requested) ? [] : [{ kind: 'copy', name: 'blueprint', expected: 0, actual: 0 }];
  return [...copy, ...blueprintIssues({ blueprint: requested, items: exam.items })];
}

/** Denemedeki kodlu soru şekilleri (soru sırasıyla; n 1'den başlar). */
export interface ExamFigureJob {
  question_no: number;
  n: number;
  kind: FigureCodeKind;
  code: string;
  file_name: string;
  alt: string;
}

export function examFigureJobs(exam: { items: readonly { no: number; figure?: { kind: FigureCodeKind; figure_code: string; alt: string } | null }[] }): ExamFigureJob[] {
  const jobs: ExamFigureJob[] = [];
  for (const it of exam.items) {
    if (!it.figure) continue;
    const n = jobs.length + 1;
    const f = it.figure;
    jobs.push({
      question_no: it.no,
      n,
      kind: f.kind,
      code: f.figure_code,
      file_name: (f.kind === 'matplotlib' ? figureFileFromCode(f.figure_code) : null) ?? figureFileName(n),
      alt: f.alt,
    });
  }
  return jobs;
}
