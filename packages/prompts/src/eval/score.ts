/**
 * Deterministik puanlayıcılar. Her vaka bir denetim listesi üretir; puan geçen denetimlerin oranıdır.
 * Hakem (eval_judge, Opus, Batch) ton ve açıklama kalitesini ayrıca puanlar; bu dosya yalnız ölçülebilir alanlara bakar.
 */
import { calloutReferenceIssues, documentFigureJobs } from '@ogrenmen/contracts';
import { stripMath } from '../lint.js';
import { FIGURE_DESIGN } from '../figure-style.js';
import type { EvalCase } from './cases.js';

export interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}

export interface CaseScore {
  id: string;
  route: string;
  checks: Check[];
  score: number;
  pass: boolean;
  error?: string;
}

const EMOJI = /\p{Extended_Pictographic}/u;

/** Kaba cümle sayısı: matematik, sıra sayıları ("3.") ve ondalıklar çıkarıldıktan sonra . ? ! … ile biten parçalar. */
export function countSentences(text: string): number {
  const prose = stripMath(text)
    .replace(/\b\d+[.,]\d+\b/g, 'N')
    .replace(/\b\d+\./g, 'N')
    .trim();
  if (prose === '') return 0;
  const ends = prose.match(/[.?!…]+(?=\s|$)/g)?.length ?? 0;
  return /[.?!…]\s*$/.test(prose) ? ends : ends + 1;
}

function styleChecks(text: string): Check[] {
  const prose = stripMath(text);
  return [
    { name: 'ünlem yok', pass: !prose.includes('!') },
    { name: 'emoji yok', pass: !EMOJI.test(text) },
  ];
}

function finish(c: EvalCase, checks: Check[]): CaseScore {
  const passed = checks.filter((x) => x.pass).length;
  const score = checks.length === 0 ? 0 : passed / checks.length;
  return { id: c.id, route: c.route, checks, score, pass: passed === checks.length };
}

export interface DiagnosisOutput {
  verdict: string;
  failing_step_no: number | null;
  error_cause: string | null;
  skill_ids: string[];
  misconception_tags: string[];
  proposed_subskill: unknown;
  why_tr: string;
}

export function scoreDiagnosis(c: Extract<EvalCase, { route: 'solution_diagnosis' }>, out: DiagnosisOutput): CaseScore {
  const e = c.expected;
  const checks: Check[] = [
    { name: 'verdict', pass: out.verdict === e.verdict, detail: `${out.verdict} / beklenen ${e.verdict}` },
    { name: 'ilk bozulan adım', pass: out.failing_step_no === e.failing_step_no, detail: `${out.failing_step_no} / beklenen ${e.failing_step_no}` },
    { name: 'hata nedeni', pass: out.error_cause === e.error_cause, detail: `${out.error_cause} / beklenen ${e.error_cause}` },
    {
      name: 'kazanım',
      pass: out.skill_ids.some((s) => e.skill_ids_any.includes(s)),
      detail: `${out.skill_ids.join(',') || '-'} / beklenen biri: ${e.skill_ids_any.join(',')}`,
    },
    { name: 'alt kazanım önerisi', pass: (out.proposed_subskill !== null) === e.proposed_subskill },
  ];
  if (e.misconception_tags_any) {
    checks.push({
      name: 'yanılgı etiketi',
      pass: out.misconception_tags.some((t) => e.misconception_tags_any?.includes(t)),
      detail: `${out.misconception_tags.join(',') || '-'} / beklenen biri: ${e.misconception_tags_any.join(',')}`,
    });
  }
  if (e.misconception_tags_empty) {
    checks.push({ name: 'yanılgı etiketi yok', pass: out.misconception_tags.length === 0, detail: out.misconception_tags.join(',') });
  }
  checks.push({ name: 'why_tr tek cümle', pass: countSentences(out.why_tr) === 1, detail: out.why_tr });
  checks.push(...styleChecks(out.why_tr));
  return finish(c, checks);
}

export interface CoachOutput {
  /** Bu turda asistanın yazdığı tüm metin. */
  text: string;
  /** Tur kaydı aracına giden girdiler (sırayla). */
  turnMeta: Record<string, unknown>[];
}

export function scoreCoach(c: Extract<EvalCase, { route: 'coach_chat' }>, out: CoachOutput): CaseScore {
  const e = c.expected;
  const lower = out.text.toLocaleLowerCase('tr');
  const checks: Check[] = [{ name: 'yanıt boş değil', pass: out.text.trim() !== '' }, ...styleChecks(out.text)];
  checks.push({ name: 'yüzde yok', pass: !stripMath(out.text).includes('%') });
  for (const s of e.forbidden_substrings ?? []) checks.push({ name: `yasak: ${s}`, pass: !out.text.includes(s) });
  for (const group of e.required_any ?? []) {
    checks.push({ name: `gerekli: ${group.join(' | ')}`, pass: group.some((g) => lower.includes(g.toLocaleLowerCase('tr'))) });
  }
  if (e.must_ask_question) checks.push({ name: 'soru soruyor', pass: out.text.includes('?') });
  if (e.max_sentences !== undefined) {
    const n = countSentences(out.text);
    checks.push({ name: `en çok ${e.max_sentences} cümle`, pass: n <= e.max_sentences, detail: String(n) });
  }
  if (e.turn_meta) {
    const meta = out.turnMeta.at(-1);
    checks.push({ name: 'tur kaydı yazıldı', pass: meta !== undefined });
    const tm = e.turn_meta;
    if (tm.mode_suggestion !== undefined) {
      checks.push({ name: 'mod önerisi', pass: (meta?.mode_suggestion ?? null) === tm.mode_suggestion, detail: String(meta?.mode_suggestion) });
    }
    if (tm.escalate_to_instructor !== undefined) {
      checks.push({ name: 'eğitmene iletme', pass: meta?.escalate_to_instructor === tm.escalate_to_instructor });
    }
    if (tm.skill_ids_any) {
      const got = Array.isArray(meta?.skill_ids) ? (meta.skill_ids as unknown[]) : [];
      checks.push({ name: 'tur kaydı kazanımı', pass: got.some((s) => typeof s === 'string' && tm.skill_ids_any?.includes(s)) });
    }
  }
  return finish(c, checks);
}

export interface ExamPageItemsOutput {
  items: {
    no: number;
    stem_text: string;
    options: { key: string; text: string }[];
    continues_from_previous: boolean;
    continues_on_next: boolean;
    figures: { bbox: { x: number; y: number; w: number; h: number } }[];
  }[];
  unreadable: boolean;
}

/** KaTeX yazım farklarını düzler: `$\frac{1}{2}$` ≈ `1/2`, `0{,}25` ≈ `0,25`, `\le` ≈ `≤`, boşluklar yok. */
export function normalizeMath(s: string): string {
  return s
    .replace(/\$/g, '')
    .replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, '$1/$2')
    .replace(/\{,\}/g, ',')
    .replace(/\\leq?(?![a-z])/g, '≤')
    .replace(/\\geq?(?![a-z])/g, '≥')
    .replace(/\\cdot/g, '·')
    .replace(/\\(left|right)/g, '')
    .replace(/[−–]/g, '-')
    .replace(/\s+/g, '')
    .toLocaleLowerCase('tr');
}

function iou(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  return union <= 0 ? 0 : inter / union;
}

const sameSet = (a: readonly number[], b: readonly number[]) => JSON.stringify([...a].sort((x, y) => x - y)) === JSON.stringify([...b].sort((x, y) => x - y));

export function scoreExamPageItems(c: Extract<EvalCase, { route: 'exam_page_items' }>, out: ExamPageItemsOutput): CaseScore {
  const e = c.expected;
  const byNo = new Map(out.items.map((i) => [i.no, i]));
  const nos = out.items.map((i) => i.no);
  const checks: Check[] = [
    { name: 'okunabilirlik', pass: out.unreadable === e.unreadable },
    { name: 'soru numaraları', pass: sameSet(nos, e.item_nos), detail: `${nos.join(',')} / beklenen ${e.item_nos.join(',')}` },
    {
      name: 'sonraki sayfaya devam',
      pass: sameSet(out.items.filter((i) => i.continues_on_next).map((i) => i.no), e.continues_on_next),
    },
    {
      name: 'önceki sayfadan devam',
      pass: sameSet(out.items.filter((i) => i.continues_from_previous).map((i) => i.no), e.continues_from_previous),
    },
    {
      name: 'şekilli sorular',
      pass: sameSet(out.items.filter((i) => i.figures.length > 0).map((i) => i.no), e.figures.map((f) => f.no)),
    },
  ];
  for (const f of e.figures) {
    const got = byNo.get(f.no)?.figures[0]?.bbox;
    const v = got ? iou(got, f.bbox) : 0;
    checks.push({ name: `soru ${f.no} şekil kutusu (IoU ≥ 0,5)`, pass: v >= 0.5, detail: v.toFixed(2) });
  }
  for (const o of e.options) {
    const got = (byNo.get(o.no)?.options ?? []).map((x) => normalizeMath(x.text));
    const want = o.texts.map(normalizeMath);
    checks.push({ name: `soru ${o.no} şıkları`, pass: JSON.stringify(got) === JSON.stringify(want), detail: `${got.join(' | ')} / beklenen ${want.join(' | ')}` });
  }
  for (const s of e.stem_contains) {
    const stem = normalizeMath(byNo.get(s.no)?.stem_text ?? '');
    checks.push({ name: `soru ${s.no} kökü: ${s.text}`, pass: stem.includes(normalizeMath(s.text)) });
  }
  return finish(c, checks);
}

/** Not üretimi çıktısı (document-ast; puanlayıcının baktığı alt küme). */
export interface NotesOutput {
  kind: string;
  meta: { personalized: boolean };
  sections: { no: number; title: string }[];
  blocks: ({ type: string; id: string } & Record<string, unknown>)[];
  keys: { question_no: number; correct_option: string | null; canonical_expr: string | null }[];
}

const FIGURE_MODULES: ReadonlySet<string> = new Set<string>(FIGURE_DESIGN.modules);

/** Figür kodu kuralları: yalnız izinli modüller, dosya/ağ/süreç yok, save_figure(fig, n) ile biter; SVG'de betik yok. */
export function figureCodeIssues(code: string, kind: string, n: number): string[] {
  const out: string[] = [];
  if (kind === 'svg') {
    if (!code.trimStart().startsWith('<svg')) out.push('svg ile başlamıyor');
    if (/<script|foreignObject|\bon[a-z]+\s*=|href\s*=\s*["']https?:/i.test(code)) out.push('betik ya da dış bağlantı');
    return out;
  }
  for (const m of code.matchAll(/^\s*(?:import\s+([\w.]+)|from\s+([\w.]+)\s+import)/gm)) {
    const mod = (m[1] ?? m[2] ?? '').split('.')[0] ?? '';
    if (!FIGURE_MODULES.has(mod)) out.push(`izinsiz modül: ${mod}`);
  }
  if (/\bopen\s*\(|__import__|\beval\s*\(|\bexec\s*\(|np\.random|rcParams/.test(code)) out.push('dosya/çalıştırma/rastgele ya da başlığı değiştirme');
  if (/\bsympy\b|\bmpmath\b/.test(code)) out.push('sympy kullanılmaz (yerel kum havuzu reddeder)');
  if (/\bsavefig\b/.test(code)) out.push('savefig yerine save_figure(fig, n)');
  if (!new RegExp(`save_figure\\(\\s*\\w+\\s*,\\s*${n}\\s*\\)`).test(code)) out.push(`save_figure(fig, ${n}) yok`);
  return out;
}

function proseOf(blocks: NotesOutput['blocks']): string {
  const texts: string[] = [];
  const walk = (k: string, v: unknown) => {
    if (['figure_code', 'svg', 'latex', 'id', 'type', 'pattern_id', 'kind', 'source'].includes(k)) return;
    if (typeof v === 'string') texts.push(v);
    else if (Array.isArray(v)) v.forEach((x) => walk('', x));
    else if (v && typeof v === 'object') for (const [kk, vv] of Object.entries(v)) walk(kk, vv);
  };
  blocks.forEach((b) => walk('', b));
  return texts.join('\n');
}

export function scoreNotes(c: Extract<EvalCase, { route: 'notes_generation' }>, out: NotesOutput): CaseScore {
  const e = c.expected;
  const blocks = out.blocks;
  const questions = blocks.filter((b) => b.type === 'question') as ({ no: number; skill_ids: string[] } & NotesOutput['blocks'][number])[];
  const callouts = blocks.filter((b) => b.type === 'common_mistake_callout');
  const refIssues = calloutReferenceIssues(out as never, e.patterns);
  const jobs = documentFigureJobs(out);
  const figIssues = jobs.flatMap((j) => figureCodeIssues(j.code, j.kind, j.n).map((x) => `${j.block_id}: ${x}`));
  const goals = blocks.find((b) => b.type === 'summary_box') as { bullets?: string[] } | undefined;
  const first = blocks[0] as { type: string; level?: number } | undefined;
  const nos = questions.map((q) => q.no);
  const prose = proseOf(blocks);
  const checks: Check[] = [
    { name: 'kind notes', pass: out.kind === 'notes' },
    { name: 'personalized', pass: out.meta.personalized === e.personalized, detail: String(out.meta.personalized) },
    { name: 'ilk blok level 1 başlık', pass: first?.type === 'heading' && first.level === 1 },
    {
      name: 'hedefler 2-4 madde, ham kazanım kodu yok',
      pass: (goals?.bullets?.length ?? 0) >= 2 && (goals?.bullets?.length ?? 0) <= 4 && !(goals?.bullets ?? []).some((b) => e.skills_any.some((s) => b.includes(s)) || /\btyt\.[a-z]+\./.test(b)),
    },
    { name: 'tanım kutusu', pass: blocks.some((b) => b.type === 'definition_box') },
    { name: 'çözümlü örnek', pass: blocks.some((b) => b.type === 'worked_example') },
    { name: 'hata kutuları gerçek örüntülere başvurur', pass: refIssues.length === 0, detail: JSON.stringify(refIssues) },
    {
      name: 'kaynaklı hata kutusu sayısı',
      pass: callouts.filter((x) => x.pattern_ref).length >= e.min_callouts,
      detail: String(callouts.length),
    },
    {
      name: 'kendini sına soru sayısı ve sırası',
      pass: questions.length === e.self_check_count && nos.every((n, i) => n === i + 1),
      detail: nos.join(','),
    },
    { name: 'her sorunun SymPy anahtarı', pass: out.keys.length === questions.length && out.keys.every((k) => k.canonical_expr !== null) },
    { name: 'sorular hedef kazanımı ölçer', pass: questions.length > 0 && questions.every((q) => q.skill_ids.some((s) => e.skills_any.includes(s))) },
    { name: 'son blok cevap sayfası', pass: blocks.at(-1)?.type === 'answer_key_page' },
    { name: 'koddan figür sayısı', pass: jobs.length >= e.min_figures, detail: String(jobs.length) },
    { name: 'figür kodu kuralları', pass: figIssues.length === 0, detail: figIssues.join('; ') },
    ...styleChecks(prose),
  ];
  return finish(c, checks);
}

export function errorScore(c: EvalCase, err: unknown): CaseScore {
  const msg = err instanceof Error ? err.message : String(err);
  return { id: c.id, route: c.route, checks: [{ name: 'çağrı', pass: false, detail: msg }], score: 0, pass: false, error: msg };
}
