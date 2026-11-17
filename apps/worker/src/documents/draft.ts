/**
 * Üretim taslağı: model çıktısı (not: document-ast; deneme/soru seti: exam-generation) ve onun belge AST'si.
 * Doğrulama merdiveni AST üzerinde çalışır; blok yeniden üretimi model biçiminde (raw) birleştirilir ve AST yeniden kurulur.
 * Deneme sorularının blok kimliği `q<no>`'dur.
 */
import {
  documentAst,
  documentFigureJobs,
  type DocumentAst,
  type DocumentBlock,
  type DocumentKey,
  type ExamGeneration,
} from '@ogrenmen/contracts';
import type { GeneratedKind } from './context.js';
import type { FigureTask } from './figures.js';

export interface Draft {
  kind: GeneratedKind;
  /** Model biçimi (yeniden üretim turunun geçmişi ve birleştirme hedefi). */
  raw: DocumentAst | ExamGeneration;
  /** Belge AST'si (anahtarlar keys[]'te; kodlu figürler henüz SVG'siz). */
  ast: DocumentAst;
}

/** Belge düzeyi sorun kimliği: kişisel notta "Senin sık yaptığın hata" kutusu yok (yeniden üretim yeni kutu ekler). */
export const CALLOUT_SLOT = '@callout';

export interface AstMeta {
  title: string;
  courseTitle: string;
  generatedOn: string;
  personalized: boolean;
  durationMin: number | null;
}

type QuestionBlock = Extract<DocumentBlock, { type: 'question' }>;

const questionId = (no: number) => `q${no}`;

/** exam-generation → document-ast (bölümler blueprint'ten ya da soru bölümlerinden; deneme sonunda optik form + anahtar sayfası). */
export function examToAst(kind: 'mock_exam' | 'question_set', exam: ExamGeneration, meta: AstMeta): DocumentAst {
  const names: string[] = [];
  for (const s of exam.blueprint?.sections ?? []) if (!names.includes(s.name)) names.push(s.name);
  for (const it of exam.items) if (!names.includes(it.section)) names.push(it.section);
  const sectionNo = new Map(names.map((n, i) => [n, i + 1]));
  const items = [...exam.items].sort((a, b) => a.no - b.no);
  const blocks: DocumentBlock[] = items.map((it) => {
    const q: QuestionBlock = {
      type: 'question',
      id: questionId(it.no),
      section_no: sectionNo.get(it.section) ?? 1,
      no: it.no,
      stem: it.stem,
      options: it.options.map((o) => ({ key: o.key, text: o.text })),
      skill_ids: it.skill_ids.slice(0, 3),
      ...(it.style_id ? { style_id: it.style_id } : {}),
    };
    if (it.figure) q.figure = { source: 'svg', figure_code: it.figure.figure_code, kind: it.figure.kind, alt: it.figure.alt };
    else if (it.figure_svg) q.figure = { source: 'svg', svg: it.figure_svg, alt: 'Soru şekli' };
    return q;
  });
  const last = blocks.length > 0 ? blocks[blocks.length - 1]!.section_no : 1;
  const opts = Math.max(2, Math.min(5, ...items.filter((i) => i.kind === 'mcq').map((i) => i.options.length), 5));
  if (kind === 'mock_exam') {
    blocks.push({ type: 'page_break', id: 'pb1', section_no: last });
    blocks.push({ type: 'answer_sheet', id: 'optik', section_no: last, title: 'Optik form', question_count: Math.max(1, items.length), options_per_question: opts });
  }
  blocks.push({ type: 'answer_key_page', id: 'anahtar', section_no: last, title: 'Cevap anahtarı' });
  return {
    kind,
    title: meta.title.slice(0, 200),
    meta: {
      course_title: meta.courseTitle.slice(0, 160),
      subtitle: `${items.length} soru${meta.durationMin ? ` · ${meta.durationMin} dakika` : ''}`,
      generated_on: meta.generatedOn,
      language: 'tr',
      personalized: meta.personalized,
      duration_min: meta.durationMin,
    },
    sections: names.map((n, i) => ({ no: i + 1, title: n.slice(0, 160) })),
    blocks,
    keys: exam.keys.map((k) => ({ question_no: k.question_no, correct_option: k.correct_option, numeric_value: k.numeric_value, canonical_expr: k.canonical_expr })),
  };
}

/** Notun model çıktısına worker'ın bildiği meta yazılır (tarih, ders, kişiselleştirme bayrağı). */
export function notesAst(doc: DocumentAst, meta: AstMeta): DocumentAst {
  return {
    ...doc,
    kind: 'notes',
    meta: { ...doc.meta, course_title: meta.courseTitle.slice(0, 160), generated_on: meta.generatedOn, language: 'tr', personalized: meta.personalized, duration_min: null },
    blocks: doc.blocks.map((b) => (b.type === 'common_mistake_callout' ? normalizeCallout(b) : b)),
  };
}

function normalizeCallout(b: Extract<DocumentBlock, { type: 'common_mistake_callout' }>): DocumentBlock {
  const fix = (id: string) => id.replace(/^patterns\.md#(\d+)$/, 'patterns.md:$1');
  return { ...b, pattern_id: fix(b.pattern_id), ...(b.pattern_ref ? { pattern_ref: { ...b.pattern_ref, id: fix(b.pattern_ref.id) } } : {}) };
}

export function buildDraft(kind: GeneratedKind, raw: DocumentAst | ExamGeneration, meta: AstMeta): Draft {
  if (kind === 'notes') return { kind, raw, ast: notesAst(raw as DocumentAst, meta) };
  return { kind, raw, ast: examToAst(kind, raw as ExamGeneration, meta) };
}

/** AST şema doğrulaması (loose + çapraz kurallar); sorun metinleri ya da boş dizi. */
export function astIssues(ast: DocumentAst): string[] {
  const r = documentAst.safeParse(ast);
  return r.success ? [] : r.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`);
}

/** Bloğun düz metni (figür bağlamı, kişiselleştirme). */
export function blockText(b: DocumentBlock): string {
  switch (b.type) {
    case 'heading':
    case 'paragraph':
      return b.text;
    case 'definition_box':
      return `${b.term}: ${b.body}`;
    case 'summary_box':
      return `${b.title}: ${b.bullets.join(' ')}`;
    case 'worked_example':
      return `${b.title}: ${b.problem}`;
    case 'common_mistake_callout':
      return b.text;
    case 'check_yourself':
      return b.question;
    case 'question':
      return `${b.stem} ${b.options.map((o) => `${o.key}) ${o.text}`).join(' ')}`;
    default:
      return '';
  }
}

/** Basit LaTeX → SymPy/şık sözdizimi (`\frac{a}{b}` → `((a)/(b))`, `\sqrt`, `^`, `\cdot`; `$` atılır). Çeviremezse girdiyi döner. */
export function latexToPlain(input: string): string {
  let s = input.trim().replace(/^\$+|\$+$/g, '').replace(/\\[(]|\\[)]/g, '').trim();
  s = s.replace(/\\left|\\right/g, '').replace(/\\[,;!: ]/g, '').replace(/−/g, '-').replace(/\\cdot|\\times/g, '*').replace(/\\div/g, '/').replace(/\\pi/g, 'pi');
  const group = (str: string, at: number): [string, number] | null => {
    if (str[at] !== '{') return null;
    let depth = 0;
    for (let i = at; i < str.length; i++) {
      if (str[i] === '{') depth++;
      else if (str[i] === '}' && --depth === 0) return [str.slice(at + 1, i), i + 1];
    }
    return null;
  };
  for (let guard = 0; guard < 50; guard++) {
    const m = /\\[dt]?frac\s*/.exec(s);
    if (!m) break;
    const a = group(s, m.index + m[0].length);
    if (!a) return input;
    const b = group(s, a[1]);
    if (!b) return input;
    s = `${s.slice(0, m.index)}((${a[0]})/(${b[0]}))${s.slice(b[1])}`;
  }
  for (let guard = 0; guard < 50; guard++) {
    const m = /\\sqrt\s*(\[[^\]]+\])?\s*/.exec(s);
    if (!m) break;
    const a = group(s, m.index + m[0].length);
    if (!a) return input;
    const rep = m[1] ? `((${a[0]})**(1/(${m[1].slice(1, -1)})))` : `sqrt(${a[0]})`;
    s = `${s.slice(0, m.index)}${rep}${s.slice(a[1])}`;
  }
  s = s.replace(/\^\{/g, '**{').replace(/\^/g, '**').replace(/\{/g, '(').replace(/\}/g, ')');
  return /\\/.test(s) ? input : s.trim();
}

/** Kodlu figürler (+ satır içi SVG'li figürler) → figür görevleri (bağlam ve gizli değerlerle). */
export function figureTasks(ast: DocumentAst): FigureTask[] {
  const tasks: FigureTask[] = documentFigureJobs(ast).map((j) => ({ ...j, context: '', hidden: [] }));
  const index = new Map(ast.blocks.map((b, i) => [b.id, i]));
  for (const b of ast.blocks) {
    const f = b.type === 'figure' ? b : b.type === 'question' ? b.figure : undefined;
    if (f && !f.figure_code && f.source === 'svg' && f.svg) {
      tasks.push({ block_id: b.id, question_no: b.type === 'question' ? b.no : null, kind: 'svg', code: f.svg, file_name: 'figure_0.svg', alt: f.alt, context: '', hidden: [] });
    }
  }
  for (const t of tasks) {
    const i = index.get(t.block_id) ?? 0;
    const b = ast.blocks[i]!;
    if (b.type === 'question') {
      t.context = blockText(b).slice(0, 2500);
      const key = ast.keys.find((k) => k.question_no === b.no);
      const answer = key?.correct_option ? b.options.find((o) => o.key === key.correct_option)?.text : key?.numeric_value != null ? String(key.numeric_value) : null;
      const plain = answer ? latexToPlain(answer).replace(/[()]/g, '') : null;
      // sayı ve kesir cevapları (11/12): figürde görünürse cevabı ele verir; kesrin ham yazımı (\frac{11}{12}) da gizlenir
      if (plain && /^-?\d+([.,]\d+)?(\/\d+)?$/.test(plain)) {
        const context = `${b.stem} ${t.alt}`;
        const raw = answer?.trim() ?? '';
        const fraction = plain.includes('/');
        t.hidden = [plain, ...(fraction && raw && raw !== plain ? [raw] : [])].filter((v) => !context.includes(v));
      }
    } else {
      const around = [ast.blocks[i - 1], ast.blocks[i + 1]].filter(Boolean).map((x) => blockText(x!)).join(' ');
      t.context = (around || t.alt).slice(0, 2500);
    }
  }
  return tasks;
}

/** Figür SVG'sini bloğa yazar: kod ve tür çıkar, source=svg. */
export function setFigureSvg(ast: DocumentAst, blockId: string, svg: string): DocumentAst {
  const fix = <F extends { figure_code?: string | undefined; kind?: string | undefined; alt: string }>(f: F) => {
    const { figure_code: _c, kind: _k, ...rest } = f as F & Record<string, unknown>;
    return { ...rest, source: 'svg' as const, svg };
  };
  return {
    ...ast,
    blocks: ast.blocks.map((b) => {
      if (b.id !== blockId) return b;
      if (b.type === 'figure') return fix(b) as DocumentBlock;
      if (b.type === 'question' && b.figure) return { ...b, figure: fix(b.figure) } as DocumentBlock;
      return b;
    }),
  };
}

/** Blokları çıkarır; soru çıkarsa anahtarı da gider ve sorular 1'den yeniden numaralanır (anahtar ve optik form dahil). */
export function dropBlocks(ast: DocumentAst, ids: ReadonlySet<string>): { ast: DocumentAst; renumber: Map<number, number> } {
  const kept = ast.blocks.filter((b) => !ids.has(b.id));
  const renumber = new Map<number, number>();
  let n = 0;
  for (const b of kept) if (b.type === 'question') renumber.set(b.no, ++n);
  const blocks = kept.map((b) => {
    if (b.type === 'question') return { ...b, no: renumber.get(b.no)! };
    if (b.type === 'answer_sheet') return { ...b, question_count: Math.max(1, n) };
    return b;
  });
  const keys: DocumentKey[] = ast.keys.filter((k) => renumber.has(k.question_no)).map((k) => ({ ...k, question_no: renumber.get(k.question_no)! }));
  const hasQuestions = n > 0;
  return {
    ast: { ...ast, blocks: hasQuestions ? blocks : blocks.filter((b) => b.type !== 'answer_sheet' && b.type !== 'answer_key_page'), keys },
    renumber,
  };
}

/**
 * Yeniden üretilen notun hedef bloklarını eskisinin yerine koyar (soru numarası korunur, anahtarı birlikte gelir).
 * `CALLOUT_SLOT` istendiyse yeni notta olup eskisinde olmayan hata kutuları, yeni nottaki öncül bloğunun ardına eklenir.
 */
export function mergeNotes(current: DocumentAst, next: DocumentAst, ids: ReadonlySet<string>): { doc: DocumentAst; replaced: string[] } {
  const replaced: string[] = [];
  let keys = [...current.keys];
  let blocks = current.blocks.map((b) => {
    if (!ids.has(b.id)) return b;
    const nb = next.blocks.find((x) => x.id === b.id);
    if (!nb) return b;
    replaced.push(b.id);
    if (b.type === 'question' && nb.type === 'question') {
      const nk = next.keys.find((k) => k.question_no === nb.no);
      keys = keys.filter((k) => k.question_no !== b.no);
      if (nk) keys.push({ ...nk, question_no: b.no });
      return { ...nb, no: b.no };
    }
    return nb;
  });
  if (ids.has(CALLOUT_SLOT)) {
    const have = new Set(blocks.map((b) => b.id));
    const sections = new Set(current.sections.map((s) => s.no));
    next.blocks.forEach((nb, i) => {
      if (nb.type !== 'common_mistake_callout' || have.has(nb.id) || !sections.has(nb.section_no)) return;
      const prev = next.blocks.slice(0, i).reverse().find((x) => have.has(x.id));
      const at = prev ? blocks.findIndex((x) => x.id === prev.id) + 1 : blocks.findIndex((x) => x.section_no === nb.section_no);
      blocks = [...blocks.slice(0, Math.max(0, at)), nb, ...blocks.slice(Math.max(0, at))];
      have.add(nb.id);
      if (!replaced.includes(CALLOUT_SLOT)) replaced.push(CALLOUT_SLOT);
    });
  }
  keys.sort((a, b) => a.question_no - b.question_no);
  return { doc: { ...current, blocks, keys }, replaced };
}

/** Yeniden üretilen denemenin hedef sorularını (q<no>) eskisinin yerine koyar. */
export function mergeExam(current: ExamGeneration, next: ExamGeneration, ids: ReadonlySet<string>): { exam: ExamGeneration; replaced: string[] } {
  const replaced: string[] = [];
  let keys = [...current.keys];
  const items = current.items.map((it) => {
    if (!ids.has(questionId(it.no))) return it;
    const ni = next.items.find((x) => x.no === it.no);
    const nk = next.keys.find((k) => k.question_no === it.no);
    if (!ni || !nk) return it;
    replaced.push(questionId(it.no));
    keys = keys.filter((k) => k.question_no !== it.no).concat([nk]);
    return { ...ni, section: it.section, no: it.no };
  });
  keys.sort((a, b) => a.question_no - b.question_no);
  return { exam: { ...current, items, keys }, replaced };
}
