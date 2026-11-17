/**
 * Deneme raporu verisi (docs/PLAN-v2.md §8 "exam-report AST → HTML/PDF"). Sayılar hattan gelir, model hesaplamaz:
 *   - `reportUserInput`: exam_report rotasının `<exam_result>` girdisi (@ogrenmen/prompts examReportUserText).
 *   - `chartDataFor`: doc-render grafik verisi (data_ref → ChartData; EXAM_REPORT_CHARTS adları).
 *   - `fallbackReport`: model düşerse (ret, şemaya uymayan çıktı, anahtar yok) aynı şablonla deterministik rapor;
 *     öğrenci yine PDF alır (progress.warnings report_fallback).
 *   - `examCardLine`: Bugün kartı cümlesi ("Örnek Deneme 1: 5,5 net. Takıldığın yer: Üslü ifadeler.").
 *   - `examParentLine`: veli bildirimi ("Örnek Deneme 1: 5,5 net. En çok zorlandığı konu: Üslü ifadeler.").
 * Soru metni rapora girmez (kitapçık yayıncının; rapor veliye de gider). Doğru cevap da modele gitmez (`key: null`):
 * rapor öğrenciye ve veliye açıktır, anahtar yalnız grade_exam_session içinde okunur (PLAN-v2-detail §2); durum ve
 * anahtar kaynağı rapora yeter. produce-report.ts ayrıca AST'de anahtar kalıbı arar (`leaksKey`).
 */
import type { ExamReport, ExamReportChartRef } from '@ogrenmen/contracts';
import type { ChartData } from '@ogrenmen/doc-render';
import type { ExamQuestionStatus, ExamReportInput, KeySource } from '@ogrenmen/prompts';
import { trNet } from './grading.js';

export interface ReportQuestion {
  no: number;
  section: string | null;
  skillId: string | null;
  skillName: string | null;
  /** exam_responses.outcome */
  outcome: 'correct' | 'wrong' | 'blank' | 'unfinished' | null;
  marked: string | null;
  /** Optik okumada çift işaret (boş sayıldı). */
  doubleMark: boolean;
  key: string | null;
  /** secure.exam_answer_keys.source */
  keySource: string | null;
  errorCause: string | null;
  seconds: number | null;
}

export interface ReportSection {
  name: string;
  questionCount: number;
  correct: number;
  wrong: number;
  blank: number;
  net: number;
}

export interface ReportHeat {
  skillId: string;
  name: string;
  total: number;
  correct: number;
}

export interface ReportData {
  examTitle: string;
  courseTitle: string;
  /** YYYY-AA-GG (Europe/Istanbul). */
  date: string;
  durationMin: number | null;
  total: number;
  correct: number;
  wrong: number;
  /** boş + yetişmeyen */
  blank: number;
  net: number;
  sections: ReportSection[];
  heatmap: ReportHeat[];
  questions: ReportQuestion[];
  weakest: { skillId: string; name: string } | null;
}

export function keySourceOf(source: string | null): KeySource {
  if (source === 'inferred') return 'inferred';
  if (source === 'instructor') return 'instructor';
  return 'publisher';
}

export function statusOf(q: Pick<ReportQuestion, 'outcome' | 'doubleMark'>): ExamQuestionStatus {
  if (q.outcome === 'correct') return 'correct';
  if (q.outcome === 'wrong') return 'wrong';
  return q.doubleMark ? 'double_mark' : 'blank';
}

/** Raporda hangi grafik verileri var (data_ref adları). */
export function chartRefs(d: ReportData): ExamReportChartRef[] {
  const refs: ExamReportChartRef[] = ['section_nets'];
  if (d.heatmap.length > 0) refs.push('skill_map');
  if (d.questions.some((q) => q.errorCause)) refs.push('error_causes');
  if (d.questions.some((q) => q.seconds !== null && q.seconds > 0)) refs.push('time_per_question');
  return refs;
}

export function reportUserInput(d: ReportData): ExamReportInput {
  return {
    examTitle: d.examTitle,
    courseTitle: d.courseTitle,
    date: d.date,
    durationMin: d.durationMin,
    sections: d.sections.map((s) => ({ name: s.name, correct: s.correct, wrong: s.wrong, blank: s.blank, net: s.net, questionCount: s.questionCount })),
    questions: d.questions
      .filter((q) => q.outcome !== null)
      .map((q) => ({
        no: q.no,
        section: q.section,
        skillId: q.skillId,
        skillName: q.skillName,
        status: statusOf(q),
        marked: q.marked,
        // anahtar modele gitmez: rapor AST'si öğrenciye/veliye açık (generated_documents, PDF)
        key: null,
        keySource: keySourceOf(q.keySource),
        errorCause: q.errorCause,
        seconds: q.seconds,
      })),
    charts: chartRefs(d),
  };
}

const CAUSE_LABEL: Record<string, string> = {
  concept: 'Kavram eksiği',
  procedure: 'İşlem hatası',
  careless: 'Dikkatsizlik',
  reading: 'Soruyu yanlış okuma',
  time: 'Süre yetmedi',
};

/**
 * Isı haritası değeri: doc-render kelime bandı (düşük < 0,4 ≤ orta < 0,7 ≤ yüksek) sonuç ekranındaki bandla (SQL
 * exam_session_view: düşük < 0,5 ≤ orta < 0,8 ≤ yüksek) aynı kalsın diye oran, sınırları birebir eşleyen tek artan
 * doğrusal eğriyle kaydırılır. Aynı öğrenciye PDF ve ekranda farklı sözcük çıkmaz.
 */
export function heatValue(ratio: number): number {
  const r = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
  const v = r < 0.5 ? (r / 0.5) * 0.4 : r < 0.8 ? 0.4 + ((r - 0.5) / 0.3) * 0.3 : 0.7 + ((r - 0.8) / 0.2) * 0.3;
  return Math.round(v * 1e6) / 1e6;
}

export function chartDataFor(d: ReportData): Record<string, ChartData> {
  const out: Record<string, ChartData> = {
    section_nets: { kind: 'score_by_section', rows: d.sections.map((s) => ({ label: s.name, net: s.net, max: s.questionCount })) },
  };
  if (d.heatmap.length > 0) {
    out.skill_map = {
      kind: 'skill_heatmap',
      rows: d.heatmap.map((h) => ({ label: h.name, value: heatValue(h.total > 0 ? h.correct / h.total : 0), correct: h.correct, total: h.total })),
    };
  }
  const causes = new Map<string, number>();
  for (const q of d.questions) if (q.errorCause) causes.set(q.errorCause, (causes.get(q.errorCause) ?? 0) + 1);
  if (causes.size > 0) {
    out.error_causes = { kind: 'error_cause_histogram', rows: [...causes].map(([c, n]) => ({ label: CAUSE_LABEL[c] ?? c, count: n })) };
  }
  const timed = d.questions.filter((q) => q.seconds !== null && q.seconds > 0);
  if (timed.length > 0) out.time_per_question = { kind: 'time_per_question', rows: timed.map((q) => ({ label: String(q.no), seconds: q.seconds! })) };
  return out;
}

function clip(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;
}

/** Kısa konu adı: "Üslü ifadeler ve özellikleri" → olduğu gibi; virgülle uzayan adın ilk parçası. */
export function shortSkillName(name: string): string {
  const first = name.split(/[,;:(]/)[0]!.trim();
  return clip(first || name, 60);
}

/** Bugün kartı cümlesi (öğrenciye; ≤ 160). */
export function examCardLine(title: string, net: number, weakest: string | null): string {
  const head = `${clip(title, 70)}: ${trNet(net)} net.`;
  return clip(weakest ? `${head} Takıldığın yer: ${shortSkillName(weakest)}.` : head, 160);
}

/** Veli bildirimi cümlesi (üçüncü kişi; ≤ 160). */
export function examParentLine(title: string, net: number, weakest: string | null): string {
  const head = `${clip(title, 70)}: ${trNet(net)} net.`;
  return clip(weakest ? `${head} En çok zorlandığı konu: ${shortSkillName(weakest)}.` : head, 160);
}

/** "Doğru cevap: C", "anahtar B", "doğru şık (D)" gibi kalıp: rapor metninde anahtar sızıntısı. */
const KEY_LEAK = /([Dd]oğru\s*([Cc]evap|[Cc]evab|[Şş]ık|[Yy]anıt)[a-zçğıöşü]*|[Cc]evap\s*[Aa]nahtar[a-zçğıöşü]*|[Aa]nahtar[a-zçğıöşü]*)\s*(:|=|-|–|olarak|ise|şu)?\s*\(?(?<![A-Za-zÇĞİÖŞÜçğıöşü])[A-E]\)?(?![A-Za-zÇĞİÖŞÜçğıöşü0-9])/u;

/** Rapor AST'sinin metin taşıyan blokları (paragraf, tablo, liste, kutu…) anahtar kalıbı içeriyor mu. */
export function leaksKey(ast: Pick<ExamReport, 'blocks' | 'title'>): boolean {
  const texts: string[] = [ast.title];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') texts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'id' && k !== 'data_ref' && k !== 'type') walk(x);
  };
  walk(ast.blocks);
  return texts.some((t) => KEY_LEAK.test(t));
}

const STATUS_TR: Record<ExamQuestionStatus, string> = { correct: 'Doğru', wrong: 'Yanlış', blank: 'Boş', double_mark: 'Çift işaret' };

/** Model düşerse deterministik rapor (exam-report şablonu: 3 bölüm, tek cümle özet, ≤ 3 sonraki adım). */
export function fallbackReport(d: ReportData): ExamReport {
  const blocks: ExamReport['blocks'] = [];
  const weakName = d.weakest ? shortSkillName(d.weakest.name) : null;
  blocks.push({ type: 'heading', id: 'h1', section_no: 1, level: 1, text: 'Genel görünüm' });
  blocks.push({
    type: 'paragraph',
    id: 'p1',
    section_no: 1,
    text: `Bu denemede ${d.total} sorunun ${d.correct} tanesini doğru yaptın ve netin ${trNet(d.net)} oldu${weakName ? `; en çok kazanç ${weakName} konusunda var.` : '.'}`,
  });
  blocks.push({ type: 'chart', id: 'c1', section_no: 1, chart_kind: 'score_by_section', title: 'Bölüm neti', data_ref: 'section_nets' });
  const doubles = d.questions.filter((q) => q.doubleMark).map((q) => q.no);
  if (d.blank > 0) {
    blocks.push({
      type: 'paragraph',
      id: 'p2',
      section_no: 1,
      text:
        `${d.blank} soru boş sayıldı.` +
        (doubles.length > 0 ? ` ${doubles.join(', ')}. ${doubles.length === 1 ? 'soruda' : 'sorularda'} iki şık işaretlendiği için optik okuma boş saydı.` : ''),
    });
  }
  blocks.push({ type: 'heading', id: 'h2', section_no: 2, level: 1, text: 'Kazanımlar' });
  if (d.heatmap.length > 0) {
    blocks.push({ type: 'chart', id: 'c2', section_no: 2, chart_kind: 'skill_heatmap', title: 'Kazanım ısı haritası', data_ref: 'skill_map', caption: 'Koyu hücre güçlü, açık hücre çalışılacak konu.' });
  }
  if (d.questions.some((q) => q.errorCause)) {
    blocks.push({ type: 'chart', id: 'c3', section_no: 2, chart_kind: 'error_cause_histogram', title: 'Hata nedenleri', data_ref: 'error_causes' });
  }
  const missed = d.questions.filter((q) => q.outcome !== null && q.outcome !== 'correct');
  if (missed.length > 0) {
    blocks.push({
      type: 'table',
      id: 't1',
      section_no: 2,
      caption: 'Yanlış ve boş sorular',
      header: ['Soru', 'Kazanım', 'Durum'],
      rows: missed.slice(0, 60).map((q) => [String(q.no), clip(q.skillName ?? '-', 200), STATUS_TR[statusOf(q)]]),
    });
  } else {
    blocks.push({ type: 'paragraph', id: 'p3', section_no: 2, text: 'Bu denemede yanlış ya da boş soru yok.' });
  }
  blocks.push({ type: 'heading', id: 'h3', section_no: 3, level: 1, text: 'Sonraki adım' });
  const bullets: string[] = [];
  const weakOrder = [...d.heatmap].filter((h) => h.correct < h.total).sort((a, b) => a.correct / a.total - b.correct / b.total || b.total - a.total);
  for (const h of weakOrder.slice(0, 2)) bullets.push(`${shortSkillName(h.name)} konusunda 10 soruluk bir alıştırma yap.`);
  if (doubles.length > 0) bullets.push('Optik formu teslim etmeden her satırda tek şık işaretlediğini kontrol et.');
  if (bullets.length === 0) bullets.push('Bir sonraki denemeye kadar haftada iki kez 20 dakikalık karışık tekrar yap.');
  blocks.push({ type: 'summary_box', id: 's1', section_no: 3, title: 'Sonraki adım', bullets: bullets.slice(0, 3) });
  return {
    kind: 'report',
    title: clip(`${d.examTitle} analizi`, 200),
    meta: {
      course_title: clip(d.courseTitle, 160),
      subtitle: clip(`${d.sections.map((s) => s.name).join(', ') || 'Deneme'} · ${d.total} soru`, 200),
      generated_on: d.date,
      language: 'tr',
      personalized: true,
      duration_min: d.durationMin,
    },
    sections: [
      { no: 1, title: 'Genel görünüm' },
      { no: 2, title: 'Kazanımlar' },
      { no: 3, title: 'Sonraki adım' },
    ],
    blocks,
    keys: [],
  } as ExamReport;
}
