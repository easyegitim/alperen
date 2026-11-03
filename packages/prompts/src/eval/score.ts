/**
 * Deterministik puanlayıcılar. Her vaka bir denetim listesi üretir; puan geçen denetimlerin oranıdır.
 * Hakem (eval_judge, Opus, Batch) ton ve açıklama kalitesini ayrıca puanlar; bu dosya yalnız ölçülebilir alanlara bakar.
 */
import { stripMath } from '../lint.js';
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

export function errorScore(c: EvalCase, err: unknown): CaseScore {
  const msg = err instanceof Error ? err.message : String(err);
  return { id: c.id, route: c.route, checks: [{ name: 'çağrı', pass: false, detail: msg }], score: 0, pass: false, error: msg };
}
