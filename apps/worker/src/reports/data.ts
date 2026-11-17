/**
 * Veli raporunun verisi (report.generate). Kaynak velinin zaten görebildiği bilgidir: supabase 0043 `parent_*` RPC'leri
 * (worker güvenilir çağıran) ve `app.child_study_stats`. Ad, ham olasılık (p), soru metni, cevap ve anahtar yoktur.
 *
 * Grafik verisi (chart_spec) deterministiktir: rapor türüne göre sabit `data_ref` adları ve doc-render `ChartData`
 * biçimleri; aynı veri aynı grafiği verir. Model yalnız bu listeden seçer (`charts`), sayı yazmaz.
 *
 *   daily_time   time_per_question  dönemin günlerine göre tahmini çalışma süresi (weekly, custom)
 *   weekly_time  time_per_question  haftalara göre tahmini çalışma süresi (trend)
 *   skill_bands  style_coverage     kazanımların bandı (düşük/orta/yüksek; kanıt yetersiz olanlar yok)
 *   section_nets score_by_section   denemenin bölüm netleri (exam)
 *   exam_nets    score_by_section   son denemelerin netleri (trend)
 */
import type { ChartData, ChartDataMap } from '@ogrenmen/doc-render';
import type { ReportChartRef, ReportKind } from '@ogrenmen/prompts';
import type { Db } from '../db.js';
import { addDays, localParts, trMinutes, trNum, validTz } from '../notifications/rules.js';
import { trShortDate, weekRange } from '../notifications/summary.js';

export interface ReportDoc {
  id: string;
  studentId: string;
  courseId: string | null;
  title: string;
  status: string;
  reportKind: ReportKind;
  params: Record<string, unknown>;
  requestedBy: string | null;
}

export interface ReportData {
  kind: ReportKind;
  title: string;
  period: string;
  courseTitle: string;
  generatedOn: string;
  charts: ReportChartRef[];
  chartData: ChartDataMap;
  /** Modele giden veri (ve deterministik raporun kaynağı). */
  data: Record<string, unknown>;
  question: string | null;
  /** Genel görünümün deterministik tek cümlesi (yedek rapor ve özet denetimi). */
  headline: string;
  /** Yedek raporun ayrıntı paragrafları. */
  details: string[];
  /** Yedek raporun "bu hafta yapılabilecekler" maddeleri (≤ 3). */
  steps: string[];
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const KINDS: readonly ReportKind[] = ['weekly', 'exam', 'topic', 'trend', 'custom'];

export const BAND_VALUE: Record<string, number> = { low: 0.25, mid: 0.55, high: 0.85 };
export const BAND_TR: Record<string, string> = { low: 'düşük', mid: 'orta', high: 'yüksek' };
const DAY_TR = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

export async function loadReportDoc(db: Db, id: string): Promise<ReportDoc | null> {
  const r = await db.query(
    `select gd.id, gd.student_id, gd.course_id, gd.kind, gd.title, gd.status, gd.spec, gd.created_by from public.generated_documents gd where gd.id = $1::uuid`,
    [id],
  );
  const row = r.rows[0];
  if (!row || row.kind !== 'report' || !row.student_id) return null;
  const spec = obj(row.spec);
  const kind = KINDS.includes(spec.report_kind as ReportKind) ? (spec.report_kind as ReportKind) : 'weekly';
  return {
    id: String(row.id),
    studentId: String(row.student_id),
    courseId: row.course_id ? String(row.course_id) : null,
    title: String(row.title),
    status: String(row.status),
    reportKind: kind,
    params: obj(spec.params),
    requestedBy: spec.requested_by ? String(spec.requested_by) : row.created_by ? String(row.created_by) : null,
  };
}

interface Stats {
  minutes: number;
  questions: number;
  active_days: number;
  exams: number;
  practice_sets: number;
}

async function stats(db: Db, studentId: string, fromDate: string, days: number, tz: string): Promise<Stats> {
  const r = await db.query(
    `select app.child_study_stats($1::uuid, ($2::date)::timestamp at time zone $4, ($2::date + $3::int)::timestamp at time zone $4, $4) as s`,
    [studentId, fromDate, days, tz],
  );
  const s = obj(r.rows[0]?.s);
  return { minutes: num(s.minutes), questions: num(s.questions), active_days: num(s.active_days), exams: num(s.exams), practice_sets: num(s.practice_sets) };
}

interface SkillBand {
  skill_id: string;
  name: string;
  unit: string | null;
  band: 'low' | 'mid' | 'high' | null;
  evidence_count: number;
}

interface CourseOverview {
  course_id: string | null;
  title: string;
  bands: { low: number; mid: number; high: number; insufficient: number };
  trend: string | null;
  skills: SkillBand[];
}

async function overview(db: Db, studentId: string, courseId: string | null): Promise<CourseOverview[]> {
  const r = await db.query('select public.parent_mastery_overview($1::uuid, $2::uuid) as o', [studentId, courseId]);
  return arr(obj(r.rows[0]?.o).courses).map((c) => {
    const x = obj(c);
    const b = obj(x.bands);
    return {
      course_id: x.course_id ? String(x.course_id) : null,
      title: String(x.title ?? 'Ders'),
      bands: { low: num(b.low), mid: num(b.mid), high: num(b.high), insufficient: num(b.insufficient) },
      trend: typeof x.trend === 'string' ? x.trend : null,
      skills: arr(x.skills).map((s) => {
        const k = obj(s);
        const band = k.band === 'low' || k.band === 'mid' || k.band === 'high' ? k.band : null;
        return { skill_id: String(k.skill_id), name: String(k.name), unit: k.unit ? String(k.unit) : null, band, evidence_count: num(k.evidence_count) };
      }),
    };
  });
}

interface ExamRow {
  session_id: string;
  title: string;
  finished_at: string | null;
  net: number | null;
  total: number | null;
  correct: number | null;
  wrong: number | null;
  blank: number | null;
  sections: { section: string; total: number; net: number }[];
}

async function exams(db: Db, studentId: string, limit: number): Promise<ExamRow[]> {
  const r = await db.query('select public.parent_exam_sessions($1::uuid, $2) as e', [studentId, limit]);
  return arr(r.rows[0]?.e)
    .map((e) => {
      const x = obj(e);
      const s = x.score ? obj(x.score) : null;
      const n = (v: unknown) => (v === null || v === undefined ? null : num(v));
      return {
        session_id: String(x.session_id),
        title: String(x.title ?? 'Deneme'),
        finished_at: x.finished_at ? String(x.finished_at) : null,
        net: s ? n(s.net) : null,
        total: s ? n(s.total) : null,
        correct: s ? n(s.correct) : null,
        wrong: s ? n(s.wrong) : null,
        blank: s ? n(s.blank) : null,
        sections: s ? arr(s.sections).map((q) => ({ section: String(obj(q).section ?? 'Genel'), total: num(obj(q).total), net: num(obj(q).net) })) : [],
      };
    })
    .filter((e) => e.net !== null);
}

/** Kazanım bantları grafiği (kanıtı yeterli olanlar; ≤ 12, önce düşükler). */
function skillBandsChart(skills: readonly SkillBand[]): ChartData | null {
  const rows = skills
    .filter((s) => s.band !== null)
    .slice(0, 12)
    .map((s) => ({ label: s.name, value: BAND_VALUE[s.band!]! }));
  return rows.length > 0 ? { kind: 'style_coverage', rows } : null;
}

function bandsLine(c: CourseOverview): string {
  const b = c.bands;
  const parts = [b.high > 0 ? `${b.high} kazanım yüksek` : null, b.mid > 0 ? `${b.mid} orta` : null, b.low > 0 ? `${b.low} düşük` : null].filter(Boolean);
  return parts.length > 0 ? `${c.title} dersinde ${parts.join(', ')} bantta` : `${c.title} dersinde bant için henüz yeterli veri yok`;
}

function skillView(s: SkillBand) {
  return { name: s.name, unit: s.unit, band: s.band ? BAND_TR[s.band] : 'az veri', evidence: s.evidence_count };
}

async function courseTitle(db: Db, courseId: string | null): Promise<string> {
  if (!courseId) return 'Genel';
  const r = await db.query('select title from public.courses where id = $1::uuid', [courseId]);
  return r.rows[0]?.title ? String(r.rows[0].title) : 'Genel';
}

async function requesterTz(db: Db, profileId: string | null): Promise<string> {
  if (!profileId) return 'Europe/Istanbul';
  const r = await db.query('select tz from public.profiles where id = $1::uuid', [profileId]);
  return validTz(r.rows[0]?.tz ? String(r.rows[0].tz) : null);
}

function dailyChart(days: { date: string; minutes: number }[]): ChartData | null {
  if (days.every((d) => d.minutes <= 0)) return null;
  return {
    kind: 'time_per_question',
    rows: days.map((d) => ({ label: `${DAY_TR[new Date(`${d.date}T12:00:00Z`).getUTCDay()]} ${trShortDate(d.date)}`, seconds: Math.round(d.minutes * 60) })),
  };
}

const CHART_ABOUT: Record<string, { chart_kind: ChartData['kind']; about: string }> = {
  daily_time: { chart_kind: 'time_per_question', about: 'günlere göre tahmini çalışma süresi' },
  weekly_time: { chart_kind: 'time_per_question', about: 'haftalara göre tahmini çalışma süresi' },
  skill_bands: { chart_kind: 'style_coverage', about: 'kazanımların bandı (düşük, orta, yüksek)' },
  section_nets: { chart_kind: 'score_by_section', about: 'denemenin bölüm netleri' },
  exam_nets: { chart_kind: 'score_by_section', about: 'son denemelerin netleri' },
};

function chartList(map: Record<string, ChartData | null>): { charts: ReportChartRef[]; chartData: ChartDataMap } {
  const charts: ReportChartRef[] = [];
  const chartData: Record<string, ChartData> = {};
  for (const [ref, data] of Object.entries(map)) {
    if (!data) continue;
    const meta = CHART_ABOUT[ref]!;
    charts.push({ data_ref: ref, chart_kind: meta.chart_kind, about: meta.about });
    chartData[ref] = data;
  }
  return { charts, chartData };
}

function dayDate(iso: string | null, tz: string): string | null {
  return iso ? localParts(new Date(iso), tz).date : null;
}

/** Rapor türüne göre veri, grafik verisi ve deterministik metin parçaları. */
export async function gatherReportData(db: Db, doc: ReportDoc, now: Date): Promise<ReportData> {
  const tz = await requesterTz(db, doc.requestedBy);
  const today = localParts(now, tz);
  const course = await courseTitle(db, doc.courseId);
  const base = { kind: doc.reportKind, title: doc.title, courseTitle: course, generatedOn: today.date, question: null as string | null };
  const courses = await overview(db, doc.studentId, doc.courseId);
  const allSkills = courses.flatMap((c) => c.skills);
  const bandsText = courses.map(bandsLine);

  if (doc.reportKind === 'weekly' || doc.reportKind === 'custom') {
    const weekStart = doc.reportKind === 'weekly' && typeof doc.params.week_start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(doc.params.week_start) ? doc.params.week_start : today.weekStart;
    const week = await stats(db, doc.studentId, weekStart, 7, tz);
    const prev = await stats(db, doc.studentId, addDays(weekStart, -7), 7, tz);
    const days: { date: string; minutes: number; questions: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(weekStart, i);
      if (d > today.date) break;
      const s = await stats(db, doc.studentId, d, 1, tz);
      days.push({ date: d, minutes: s.minutes, questions: s.questions });
    }
    const weekEnd = addDays(weekStart, 7);
    const weekExams = (await exams(db, doc.studentId, 20)).filter((e) => {
      const d = dayDate(e.finished_at, tz);
      return d !== null && d >= weekStart && d < weekEnd;
    });
    const { charts, chartData } = chartList({ daily_time: dailyChart(days), skill_bands: skillBandsChart(allSkills) });
    const studied = week.minutes > 0 || week.questions > 0;
    const headline = studied
      ? `Bu hafta ${trMinutes(week.minutes)} çalışıp ${week.questions} soru çözdü ve ${week.active_days} gün etkin oldu.`
      : 'Bu hafta kayıtlı bir çalışma görünmüyor.';
    const details = [
      prev.minutes > 0 || prev.questions > 0 ? `Geçen hafta ${trMinutes(prev.minutes)} çalışmış ve ${prev.questions} soru çözmüştü.` : 'Geçen hafta için karşılaştırılacak kayıt yok.',
      ...weekExams.slice(0, 3).map((e) => `${e.title} denemesinde ${trNum(e.net ?? 0)} net yaptı.`),
      ...bandsText.map((t) => `${t}.`),
    ];
    const question = doc.reportKind === 'custom' && typeof doc.params.question === 'string' ? doc.params.question : null;
    return {
      ...base,
      question,
      period: weekRange(weekStart),
      charts,
      chartData,
      data: {
        week: { start: weekStart, study_time: trMinutes(week.minutes), minutes: Math.round(week.minutes), questions: week.questions, active_days: week.active_days },
        previous_week: { study_time: trMinutes(prev.minutes), minutes: Math.round(prev.minutes), questions: prev.questions },
        days: days.map((d) => ({ date: d.date, minutes: Math.round(d.minutes), questions: d.questions })),
        exams: weekExams.slice(0, 5).map((e) => ({ title: e.title, date: dayDate(e.finished_at, tz), net: e.net, total: e.total })),
        courses: courses.map((c) => ({ title: c.title, bands: c.bands, trend: c.trend })),
        skills: allSkills.slice(0, 20).map(skillView),
      },
      headline,
      details,
      steps: studied
        ? ['Ona bu hafta en çok hangi konuyu kolay bulduğunu sorabilirsiniz.', 'Zorlandığı bir soruyu size anlatmasını isteyebilirsiniz.']
        : ['Uygun bir anda nasıl gittiğini ve nereden başlamak istediğini sorabilirsiniz.'],
    };
  }

  if (doc.reportKind === 'exam') {
    const sid = typeof doc.params.session_id === 'string' ? doc.params.session_id : '';
    const all = await exams(db, doc.studentId, 50);
    const e = all.find((x) => x.session_id === sid) ?? null;
    const idx = e ? all.indexOf(e) : -1;
    const prev = idx >= 0 ? (all[idx + 1] ?? null) : null;
    const sections = e?.sections.filter((s) => s.total > 0) ?? [];
    const { charts, chartData } = chartList({
      section_nets: sections.length > 0 ? { kind: 'score_by_section', rows: sections.map((s) => ({ label: s.section, net: s.net, max: s.total })) } : null,
      skill_bands: skillBandsChart(allSkills),
    });
    const headline = e
      ? `${e.title} denemesinde ${e.total ?? 0} sorunun ${e.correct ?? 0} tanesini doğru yaparak ${trNum(e.net ?? 0)} net yaptı.`
      : 'Bu deneme için sonuç bulunamadı.';
    return {
      ...base,
      period: e?.finished_at ? trShortDate(dayDate(e.finished_at, tz) ?? '') : 'Deneme',
      charts,
      chartData,
      data: {
        exam: e ? { title: e.title, date: dayDate(e.finished_at, tz), total: e.total, correct: e.correct, wrong: e.wrong, blank: e.blank, net: e.net, sections: e.sections } : null,
        previous_exam: prev ? { title: prev.title, date: dayDate(prev.finished_at, tz), net: prev.net } : null,
        courses: courses.map((c) => ({ title: c.title, bands: c.bands, trend: c.trend })),
        weakest_skills: allSkills.filter((s) => s.band === 'low').slice(0, 6).map(skillView),
      },
      headline,
      details: [
        ...(e ? [`${e.wrong ?? 0} yanlış ve ${e.blank ?? 0} boş soru var.`] : []),
        ...(prev && e && prev.net !== null && e.net !== null ? [`Bir önceki denemede ${trNum(prev.net)} net yapmıştı.`] : []),
        ...bandsText.map((t) => `${t}.`),
      ],
      steps: ['Ona bu denemede en çok hangi soruda zorlandığını sorabilirsiniz.', 'Boş bıraktığı soruları birlikte gözden geçirmesini önerebilirsiniz.'],
    };
  }

  if (doc.reportKind === 'topic') {
    const ids = Array.isArray(doc.params.skill_ids) ? doc.params.skill_ids.map(String) : [];
    const topic = typeof doc.params.topic === 'string' ? doc.params.topic.trim() : '';
    const needle = topic.toLocaleLowerCase('tr');
    let picked = allSkills.filter((s) => ids.includes(s.skill_id) || (needle !== '' && (s.name.toLocaleLowerCase('tr').includes(needle) || (s.unit ?? '').toLocaleLowerCase('tr').includes(needle))));
    const matched = picked.length > 0;
    if (!matched) picked = allSkills.slice(0, 12);
    const { charts, chartData } = chartList({ skill_bands: skillBandsChart(picked) });
    const known = picked.filter((s) => s.band !== null);
    const headline = matched
      ? known.length > 0
        ? `${topic || picked[0]!.name} konusunda ${known.length} kazanımın bandı belli ve bunlar ${picked.reduce((n, s) => n + s.evidence_count, 0)} kanıta dayanıyor.`
        : `${topic || picked[0]!.name} konusunda henüz bant için yeterli veri yok.`
      : `${topic || 'Bu konu'} için çalışma kaydı bulunamadı; aşağıda dersin genel durumu var.`;
    return {
      ...base,
      period: topic || 'Konu',
      charts,
      chartData,
      data: { topic: topic || null, matched, skills: picked.map(skillView), courses: courses.map((c) => ({ title: c.title, bands: c.bands, trend: c.trend })) },
      headline,
      details: picked.slice(0, 8).map((s) => `${s.name}: ${s.band ? BAND_TR[s.band] : 'az veri'} (${s.evidence_count} kanıt).`),
      steps: ['Ona bu konuda neyi kolay, neyi zor bulduğunu sorabilirsiniz.'],
    };
  }

  // trend
  const weeks = Math.min(26, Math.max(2, Math.round(num(doc.params.weeks, 8))));
  const series: { start: string; minutes: number; questions: number }[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = addDays(today.weekStart, -7 * i);
    const s = await stats(db, doc.studentId, start, 7, tz);
    series.push({ start, minutes: s.minutes, questions: s.questions });
  }
  const from = series[0]!.start;
  const recent = (await exams(db, doc.studentId, 20))
    .filter((e) => {
      const d = dayDate(e.finished_at, tz);
      return d !== null && d >= from;
    })
    .reverse();
  const { charts, chartData } = chartList({
    weekly_time: series.some((w) => w.minutes > 0) ? { kind: 'time_per_question', rows: series.map((w) => ({ label: trShortDate(w.start), seconds: Math.round(w.minutes * 60) })) } : null,
    exam_nets: recent.length > 0 ? { kind: 'score_by_section', rows: recent.slice(-8).map((e) => ({ label: `${e.title.slice(0, 18)} ${trShortDate(dayDate(e.finished_at, tz) ?? '')}`, net: e.net ?? 0, max: Math.max(1, e.total ?? 1) })) } : null,
    skill_bands: skillBandsChart(allSkills),
  });
  const total = series.reduce((n, w) => n + w.minutes, 0);
  const active = series.filter((w) => w.minutes > 0).length;
  return {
    ...base,
    period: `son ${weeks} hafta`,
    charts,
    chartData,
    data: {
      weeks: series.map((w) => ({ week_start: w.start, minutes: Math.round(w.minutes), questions: w.questions })),
      exams: recent.map((e) => ({ title: e.title, date: dayDate(e.finished_at, tz), net: e.net, total: e.total })),
      courses: courses.map((c) => ({ title: c.title, bands: c.bands, trend: c.trend })),
    },
    headline: total > 0 ? `Son ${weeks} haftanın ${active} haftasında çalıştı ve toplam ${trMinutes(total)} çalışma kaydı var.` : `Son ${weeks} haftada kayıtlı bir çalışma görünmüyor.`,
    details: [
      ...(recent.length >= 2 ? [`Bu dönemde ${recent.length} deneme çözdü; netler ${trNum(recent[0]!.net ?? 0)} ile ${trNum(recent[recent.length - 1]!.net ?? 0)} arasında ilerledi.`] : []),
      ...bandsText.map((t) => `${t}.`),
    ],
    steps: ['Ona son haftalarda en çok neyin işe yaradığını sorabilirsiniz.'],
  };
}
