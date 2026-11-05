/**
 * Veli raporu üretimi (`report.generate` {document_id}; kuyruğa `parent_request_report` atar, supabase 0043):
 *   belge (generated_documents kind=report, queued) → generating → veri + grafik verisi (data.ts, deterministik)
 *   → `report` rotası (Sonnet 5.5 · medium, report-ast, akış; okuma araçları bant düzeyinde, p yok)
 *   → temizlik (bilinmeyen grafikler atılır, başlık ve meta hattın) → kural dışıysa (anahtar kalıbı, yüzde, ilk blok
 *   paragraf değil) ya da model düşerse deterministik rapor → doc-render rapor şablonu → PDF (Playwright, A4)
 *   → Storage `documents/reports/<öğrenci>/<belge>.pdf` → register_generated_document (rendered; veli Raporlar'da
 *   görür) → `report_ready` bildirimi isteyen veliye (emit_notification; push/e-posta kanalları kuraldan).
 *
 * Belge `document_set_status('ready')` yerine `rendered` olur: o yol öğrenci belgelerinin yayın kapısıdır (doğrulama
 * merdiveni, Bugün kartı); veli raporu öğrencinin Bugün ekranına düşmemelidir. `parent_reports` rendered'ı hazır sayar.
 */
import type { ReportAst } from '@ogrenmen/contracts';
import { renderHtml, renderPdf } from '@ogrenmen/doc-render';
import { buildPromptSystem, classifyError, MaxTokensError, ParseError, RefusalError, type ToolRunners } from '@ogrenmen/llm';
import { reportUserText } from '@ogrenmen/prompts';
import type { Db } from '../db.js';
import { leaksKey } from '../exam/report.js';
import { PermanentJobError } from '../jobs/errors.js';
import type { JobContext } from '../jobs/types.js';
import { emitNotification } from '../notifications/engine.js';
import { systemPrompt } from '../prompts.js';
import { BAND_TR, gatherReportData, loadReportDoc, type ReportData, type ReportDoc } from './data.js';

export interface ParentReportOutcome {
  documentId: string;
  status: 'rendered' | 'failed' | 'skipped';
  fallback?: boolean;
  pdfPath?: string | null;
  notificationId?: string | null;
  reason?: string;
}

/** Rapor rotasının araçları (veli verisi düzeyinde: bant ve kanıt sayısı, deneme skorları; p ve soru yok). */
export function parentReportRunners(db: Db, studentId: string, courseId: string | null): ToolRunners {
  return {
    get_mastery: async (input) => {
      const r = await db.query('select public.parent_mastery_overview($1::uuid, $2::uuid) as o', [studentId, courseId]);
      const courses = Array.isArray((r.rows[0]?.o as { courses?: unknown })?.courses) ? ((r.rows[0]!.o as { courses: Record<string, unknown>[] }).courses) : [];
      const codes = new Set(input.skill_codes ?? []);
      const skills = courses
        .flatMap((c) => (Array.isArray(c.skills) ? (c.skills as Record<string, unknown>[]) : []))
        .filter((s) => codes.size === 0 || codes.has(String(s.skill_id)))
        .slice(0, 30)
        .map((s) => ({ code: String(s.skill_id), name: String(s.name), band: typeof s.band === 'string' ? BAND_TR[s.band] : 'az veri', evidence_count: Number(s.evidence_count ?? 0) }));
      return JSON.stringify({ skills });
    },
    get_recent_exams: async (input) => {
      const r = await db.query('select public.parent_exam_sessions($1::uuid, $2) as e', [studentId, Math.min(5, Math.max(1, input.limit ?? 3))]);
      return JSON.stringify({ exams: r.rows[0]?.e ?? [] });
    },
  };
}

const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;

function texts(ast: Pick<ReportAst, 'blocks' | 'title'>): string[] {
  const out: string[] = [ast.title];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'id' && k !== 'data_ref' && k !== 'type' && k !== 'chart_kind') walk(x);
  };
  walk(ast.blocks);
  return out;
}

/**
 * Model raporunu hattın kurallarına indirger: başlık ve meta hattın; izinsiz ya da türü uymayan grafik atılır; anahtar
 * kalıbı, yüzde, ünlem ya da emoji varsa, ilk metin bloğu paragraf değilse null (deterministik rapora düşülür).
 */
export function sanitizeReport(ast: ReportAst, d: ReportData): ReportAst | null {
  const allowed = new Map(d.charts.map((c) => [c.data_ref, c.chart_kind] as const));
  const blocks = ast.blocks.filter((b) => b.type !== 'chart' || allowed.get(b.data_ref) === b.chart_kind);
  const out: ReportAst = {
    ...ast,
    kind: 'report',
    title: d.title,
    meta: { course_title: d.courseTitle, subtitle: d.period, generated_on: d.generatedOn, language: 'tr', personalized: true, duration_min: null },
    blocks,
    keys: [],
  };
  const first = out.blocks.find((b) => b.type !== 'heading');
  if (!first || first.type !== 'paragraph') return null;
  if (leaksKey(out as never)) return null;
  if (texts(out).some((t) => /[%!]/.test(t) || PICTOGRAPHIC.test(t))) return null;
  return out;
}

/** Deterministik rapor (model düşerse ya da çıktı kurala uymazsa): üç bölüm, tek cümle özet, izinli grafikler. */
export function fallbackParentReport(d: ReportData): ReportAst {
  const blocks: ReportAst['blocks'] = [];
  let n = 0;
  const id = (p: string) => `${p}${++n}`;
  blocks.push({ type: 'heading', id: id('h'), section_no: 1, level: 1, text: 'Genel görünüm' });
  blocks.push({ type: 'paragraph', id: id('p'), section_no: 1, text: d.headline });
  if (d.question) blocks.push({ type: 'paragraph', id: id('p'), section_no: 1, text: `Sorunuz: ${d.question.slice(0, 400)}` });
  const first = d.charts[0];
  if (first) blocks.push({ type: 'chart', id: id('c'), section_no: 1, chart_kind: first.chart_kind as never, title: capitalize(first.about), data_ref: first.data_ref });
  blocks.push({ type: 'heading', id: id('h'), section_no: 2, level: 1, text: 'Ayrıntı' });
  for (const t of d.details.slice(0, 8)) blocks.push({ type: 'paragraph', id: id('p'), section_no: 2, text: t });
  if (d.details.length === 0) blocks.push({ type: 'paragraph', id: id('p'), section_no: 2, text: 'Bu dönem için ayrıntı verecek kadar kayıt yok.' });
  for (const c of d.charts.slice(1)) blocks.push({ type: 'chart', id: id('c'), section_no: 2, chart_kind: c.chart_kind as never, title: capitalize(c.about), data_ref: c.data_ref });
  blocks.push({ type: 'heading', id: id('h'), section_no: 3, level: 1, text: 'Bu hafta yapılabilecekler' });
  blocks.push({ type: 'summary_box', id: id('s'), section_no: 3, title: 'Küçük adımlar', bullets: d.steps.slice(0, 3) });
  return {
    kind: 'report',
    title: d.title,
    meta: { course_title: d.courseTitle, subtitle: d.period, generated_on: d.generatedOn, language: 'tr', personalized: true, duration_min: null },
    sections: [
      { no: 1, title: 'Genel görünüm' },
      { no: 2, title: 'Ayrıntı' },
      { no: 3, title: 'Bu hafta yapılabilecekler' },
    ],
    blocks,
    keys: [],
  } as ReportAst;
}

function capitalize(s: string): string {
  return s.charAt(0).toLocaleUpperCase('tr') + s.slice(1);
}

function fallbackWorthy(err: unknown): boolean {
  if (err instanceof RefusalError || err instanceof ParseError || err instanceof MaxTokensError || err instanceof PermanentJobError) return true;
  const c = classifyError(err);
  return !c.retryable && c.code !== 'unknown';
}

async function modelReport(ctx: JobContext, doc: ReportDoc, d: ReportData): Promise<{ ast: ReportAst; costUsd: number; model: string }> {
  const gateway = await ctx.gateway();
  const prompt = await systemPrompt(ctx.db, 'report');
  // Ders bloğu (müfredat) önbellekli; dossier (koç hafızası) veli raporuna girmez.
  const system = doc.courseId ? { product: prompt.text, course: (await buildPromptSystem(ctx.db, { product: prompt.text, studentId: doc.studentId, courseId: doc.courseId })).system.course ?? null } : { product: prompt.text };
  const ref = await ctx.db.query('select public_ref from public.students where id = $1::uuid', [doc.studentId]);
  const res = await gateway.call('report', {
    system,
    user: reportUserText({ kind: d.kind, title: d.title, period: d.period, course_title: d.courseTitle, generated_on: d.generatedOn, charts: d.charts, data: d.data, question: d.question }),
    turn: { now: ctx.now() },
    promptVersion: prompt.version,
    studentRef: ref.rows[0]?.public_ref ? String(ref.rows[0].public_ref) : null,
    ref: { table: 'generated_documents', id: doc.id },
    purpose: 'report.generate',
    tools: { runners: parentReportRunners(ctx.db, doc.studentId, doc.courseId) },
    signal: ctx.signal,
  });
  return { ast: res.data as ReportAst, costUsd: res.costUsd, model: res.model };
}

async function register(db: Db, doc: ReportDoc, patch: Record<string, unknown>): Promise<void> {
  await db.query('select public.register_generated_document($1::jsonb) as id', [JSON.stringify({ id: doc.id, kind: 'report', ...patch })]);
}

export async function produceParentReport(ctx: JobContext, documentId: string, opts: { lastAttempt: boolean }): Promise<ParentReportOutcome> {
  const doc = await loadReportDoc(ctx.db, documentId);
  if (!doc) throw new PermanentJobError(`rapor belgesi bulunamadı: ${documentId}`, 'OGR-REPORT-101');
  if (['rendered', 'published', 'failed'].includes(doc.status)) return { documentId, status: 'skipped', reason: doc.status };
  await register(ctx.db, doc, { status: 'generating' });

  const data = await gatherReportData(ctx.db, doc, ctx.now());
  let ast: ReportAst;
  let fallback = false;
  let costUsd = 0;
  let model = 'deterministic';
  try {
    const m = await modelReport(ctx, doc, data);
    costUsd = m.costUsd;
    const clean = sanitizeReport(m.ast, data);
    if (clean) {
      ast = clean;
      model = m.model;
    } else {
      ctx.log.warn('rapor çıktısı kurala uymadı; deterministik rapor', { document: doc.id });
      ast = fallbackParentReport(data);
      fallback = true;
    }
  } catch (err) {
    if (!fallbackWorthy(err) && !opts.lastAttempt) throw err;
    ctx.log.warn('rapor modeli düştü; deterministik rapor', { document: doc.id, error: (err as Error).message });
    ast = fallbackParentReport(data);
    fallback = true;
  }

  let storage;
  try {
    storage = ctx.storage();
  } catch (err) {
    await register(ctx.db, doc, { status: 'failed', verification: { render_error: (err as Error).message.slice(0, 300) } });
    return { documentId, status: 'failed', reason: 'storage' };
  }
  let pdfPath: string;
  try {
    const html = renderHtml(ast, { theme: 'print', chartData: data.chartData });
    const pdf = await renderPdf(html, { headerTitle: ast.title });
    pdfPath = `reports/${doc.studentId}/${doc.id}.pdf`;
    await storage.upload(ctx.config.documentsBucket, pdfPath, Buffer.from(pdf), 'application/pdf');
  } catch (err) {
    if (!opts.lastAttempt && !(err instanceof PermanentJobError)) throw err;
    await register(ctx.db, doc, { status: 'failed', verification: { render_error: (err as Error).message.slice(0, 300) } });
    return { documentId, status: 'failed', reason: 'render' };
  }

  await register(ctx.db, doc, {
    title: ast.title,
    content: ast,
    pdf_path: pdfPath,
    status: 'rendered',
    personalization: { fallback },
    verification: { charts: data.charts.map((c) => c.data_ref), report_kind: data.kind },
    model: fallback ? 'deterministic' : model,
    cost_usd: costUsd,
  });
  let notificationId: string | null = null;
  if (doc.requestedBy) {
    try {
      notificationId = await emitNotification(ctx, doc.requestedBy, 'report_ready', {
        student_id: doc.studentId,
        document_id: doc.id,
        report_kind: doc.reportKind,
        url: `/veli/rapor/${doc.id}`,
      });
    } catch (err) {
      ctx.log.warn('report_ready bildirimi yazılamadı', { document: doc.id, error: (err as Error).message });
    }
  }
  return { documentId, status: 'rendered', fallback, pdfPath, notificationId };
}
