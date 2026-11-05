/**
 * Deneme raporu üretimi (exam.analyse'ın report aşaması ve uygulama içi deneme için exam.report işi):
 *   exam_session_view + soru satırları → exam_report (Sonnet, akış, get_mastery/get_recent_exams araçları; çıktı stash'e)
 *   → özet cümlesi neti taşımıyorsa ya da model düşerse deterministik rapor (fallbackReport) → doc-render HTML → PDF
 *   (Playwright) → Storage `documents/reports/<öğrenci>/<oturum>.pdf` → register_generated_document(kind='report',
 *   exam_session_id) → oturum done. PDF üretilemez ya da Storage yoksa belge 'failed', oturum yine done (sonuç ekranı
 *   rapordan bağımsızdır; progress.report_status = failed).
 */
import type { ExamReport } from '@ogrenmen/contracts';
import { renderHtml, renderPdf } from '@ogrenmen/doc-render';
import { buildPromptSystem, classifyError, MaxTokensError, ParseError, RefusalError, type ToolRunners } from '@ogrenmen/llm';
import { examReportUserText } from '@ogrenmen/prompts';
import type { Db } from '../db.js';
import { PermanentJobError } from '../jobs/errors.js';
import type { JobContext } from '../jobs/types.js';
import { systemPrompt } from '../prompts.js';
import type { StorageLike } from '../storage.js';
import { loadReportData, type SessionRow } from './db.js';
import { trNet } from './grading.js';
import { chartDataFor, examCardLine, examParentLine, fallbackReport, leaksKey, reportUserInput, type ReportData } from './report.js';
import { stashGet, stashPut } from './stash.js';

export interface ReportOutcome {
  documentId: string | null;
  pdfPath: string | null;
  status: 'rendered' | 'failed';
  fallback: boolean;
  /** Bugün kartı (öğrenciye). */
  line: string;
  /** Veli bildirimi (üçüncü kişi). */
  parentLine: string;
  data: ReportData;
  costUsd: number;
}

export function tryStorage(ctx: Pick<JobContext, 'storage'>): StorageLike | null {
  try {
    return ctx.storage();
  } catch {
    return null;
  }
}

/** Rapor rotasının araçları: worker tarafı (öğrencinin kaydı üzerinden; koç RPC'leriyle aynı biçim). */
export function reportToolRunners(db: Db, s: Pick<SessionRow, 'enrollment_id' | 'student_id'>): ToolRunners {
  return {
    get_mastery: async (input) => {
      const codes = (input.skill_codes ?? []).slice(0, 50);
      const r = await db.query(
        `select coalesce(jsonb_agg(jsonb_build_object('code', x.skill_id, 'name', x.name, 'p', x.p, 'evidence_count', x.evidence_count) order by x.p, x.skill_id), '[]'::jsonb) as skills
           from (select m.skill_id, sk.name, round(m.p::numeric, 3) as p, m.evidence_count from public.mastery m
                   join public.skills sk on sk.curriculum_id = m.curriculum_id and sk.id = m.skill_id
                  where m.enrollment_id = $1::uuid and (cardinality($2::text[]) = 0 or m.skill_id = any($2::text[]))
                  order by m.p asc, m.skill_id limit 20) x`,
        [s.enrollment_id, codes],
      );
      return JSON.stringify({ skills: r.rows[0]?.skills ?? [] });
    },
    get_recent_exams: async (input) => {
      const r = await db.query(
        `select coalesce(jsonb_agg(jsonb_build_object('title', x.title, 'finished_at', x.finished_at, 'net', x.score -> 'net',
                                                      'total', x.score -> 'total', 'sections', x.score -> 'sections') order by x.finished_at desc), '[]'::jsonb) as exams
           from (select ex.title, es.finished_at, es.score from public.exam_sessions es join public.exams ex on ex.id = es.exam_id
                  join public.enrollments e on e.id = es.enrollment_id
                 where e.student_id = $1::uuid and es.status = 'done' and es.score is not null
                 order by es.finished_at desc nulls last limit $2) x`,
        [s.student_id, Math.min(5, Math.max(1, input.limit ?? 3))],
      );
      return JSON.stringify({ exams: r.rows[0]?.exams ?? [] });
    },
  };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Özet paragrafı (ilk metin bloğu) neti hattın sayısıyla taşıyor mu: sayı sınırlı ("15,5" içindeki "5,5" ya da
 * "8 doğru" içindeki "8" sayılmaz) ve "net" sözcüğüne bitişik ("5,5 net", "netin 5,5", "net: 5,5").
 */
export function summaryMatches(ast: ExamReport, net: number): boolean {
  const first = ast.blocks.find((b) => b.type !== 'heading');
  if (!first || first.type !== 'paragraph') return false;
  const forms = [...new Set([trNet(net), net.toFixed(2).replace('.', ',')])].map(escapeRe).join('|');
  const num = `(?<![\\d,.])-?(?:${forms})(?![\\d]|,\\d)`;
  const re = new RegExp(`${num}\\s*net\\b|\\bnet(?:in|i)?\\s*[:=]?\\s*${num}`, 'iu');
  return re.test(first.text);
}

/** Modelin düştüğü ama yeniden denemenin işe yaramayacağı hatalar → deterministik rapor. */
function fallbackWorthy(err: unknown): boolean {
  if (err instanceof RefusalError || err instanceof ParseError || err instanceof MaxTokensError || err instanceof PermanentJobError) return true;
  const c = classifyError(err);
  return !c.retryable && c.code !== 'unknown';
}

async function modelReport(ctx: JobContext, s: SessionRow, data: ReportData): Promise<{ ast: ExamReport; costUsd: number }> {
  const cached = await stashGet<{ ast: ExamReport }>(ctx.db, s.id, 'report');
  if (cached?.ast) return { ast: cached.ast, costUsd: 0 };
  const gateway = await ctx.gateway();
  const prompt = await systemPrompt(ctx.db, 'exam_report');
  const system = s.course_id ? (await buildPromptSystem(ctx.db, { product: prompt.text, studentId: s.student_id, courseId: s.course_id })).system : { product: prompt.text };
  const res = await gateway.call('exam_report', {
    system,
    user: examReportUserText(reportUserInput(data)),
    turn: { now: ctx.now() },
    promptVersion: prompt.version,
    studentRef: s.public_ref,
    ref: { table: 'exam_sessions', id: s.id },
    purpose: 'exam.report',
    tools: { runners: reportToolRunners(ctx.db, s) },
    signal: ctx.signal,
  });
  const ast = res.data as ExamReport;
  await stashPut(ctx.db, s.id, 'report', { ast, model: res.model, cost_usd: res.costUsd });
  return { ast, costUsd: res.costUsd };
}

export async function produceReport(
  ctx: JobContext,
  s: SessionRow,
  opts: { doubleMarks?: ReadonlySet<number>; lastAttempt: boolean },
): Promise<ReportOutcome> {
  const data = await loadReportData(ctx.db, s, opts.doubleMarks ?? new Set(), ctx.now());
  const line = examCardLine(s.exam_title, data.net, data.weakest?.name ?? null);
  const parentLine = examParentLine(s.exam_title, data.net, data.weakest?.name ?? null);
  await ctx.db.query('select public.set_exam_progress($1::uuid, $2, $3::jsonb)', [s.id, 'report', JSON.stringify({ net: data.net, card_line: line })]);

  let ast: ExamReport;
  let fallback = false;
  let costUsd = 0;
  try {
    const m = await modelReport(ctx, s, data);
    costUsd = m.costUsd;
    ast = m.ast;
    if (!summaryMatches(ast, data.net)) {
      ctx.log.warn('rapor özeti hattın netini taşımıyor; deterministik rapor', { session: s.id });
      ast = fallbackReport(data);
      fallback = true;
    } else if (leaksKey(ast)) {
      ctx.log.warn('rapor metni anahtar kalıbı taşıyor; deterministik rapor', { session: s.id });
      ast = fallbackReport(data);
      fallback = true;
    }
  } catch (err) {
    if (!fallbackWorthy(err) && !opts.lastAttempt) throw err;
    ctx.log.warn('rapor modeli düştü; deterministik rapor', { session: s.id, error: (err as Error).message });
    ast = fallbackReport(data);
    fallback = true;
  }

  let pdfPath: string | null = null;
  let status: 'rendered' | 'failed' = 'failed';
  let renderError: string | null = null;
  const storage = tryStorage(ctx);
  if (!storage) {
    renderError = 'Storage yapılandırılmadı';
  } else {
    try {
      const html = renderHtml(ast, { theme: 'print', chartData: chartDataFor(data) });
      const pdf = await renderPdf(html, { headerTitle: ast.title });
      const path = `reports/${s.student_id}/${s.id}.pdf`;
      await storage.upload(ctx.config.documentsBucket, path, Buffer.from(pdf), 'application/pdf');
      pdfPath = path;
      status = 'rendered';
    } catch (err) {
      if (!opts.lastAttempt && !(err instanceof PermanentJobError)) throw err;
      renderError = (err as Error).message.slice(0, 300);
    }
  }
  if (renderError) ctx.log.error('deneme raporu PDF olarak yazılamadı', { session: s.id, error: renderError });

  const reg = await ctx.db.query('select public.register_generated_document($1::jsonb) as id', [
    JSON.stringify({
      ...(s.report_document_id ? { id: s.report_document_id } : {}),
      kind: 'report',
      title: ast.title,
      content: { ...ast, keys: [] },
      pdf_path: pdfPath,
      status,
      exam_session_id: s.id,
      student_id: s.student_id,
      course_id: s.course_id,
      spec: { source: 'exam', session_id: s.id, exam_id: s.exam_id },
      personalization: { fallback },
      verification: { summary_net: data.net, render_error: renderError },
      model: fallback ? 'deterministic' : 'exam_report',
      cost_usd: costUsd,
    }),
  ]);
  const documentId = reg.rows[0]?.id ? String(reg.rows[0].id) : null;
  if (status === 'failed') {
    await ctx.db.query('select public.set_exam_progress($1::uuid, $2, $3::jsonb)', [s.id, 'done', JSON.stringify({ report_status: 'failed' })]);
  }
  return { documentId, pdfPath, status, fallback, line, parentLine, data, costUsd };
}
