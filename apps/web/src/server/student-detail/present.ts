// Eğitmen › Öğrenci dossier'i (/egitmen/ogrenci/[id]) için saf toplama (test/student-detail.test.ts): ustalık özeti
// (en zayıf 8, en güçlü 5; bant kelimesi Gelişim › Konular ile aynı: bandWord), açık yanılgılar, son teşhisler, son
// denemeler. Yüzde yok; p yalnız sıralamada kullanılır, ekrana çıkmaz.

import { primarySkill, readAnalysis, summarySentence, type ErrorCause, type Verdict } from '@/server/diagnosis/present';
import { bandWord, formatNet, netOf, TZ, type Band } from '@/server/progress/present';

export interface MasteryInput {
  skill_id: string;
  skill_name: string;
  band: Band;
  p: number | null;
  evidence_count: number;
}

export interface SkillLine {
  skillId: string;
  name: string;
  band: Band;
  word: string;
  evidence: number;
}

export interface MasterySummary {
  weakest: SkillLine[];
  strongest: SkillLine[];
  /** Kanıtı olan ama bant için az veri (settings.min_evidence altı) yaprak sayısı. */
  thin: number;
}

const line = (r: MasteryInput): SkillLine => ({ skillId: r.skill_id, name: r.skill_name, band: r.band, word: bandWord(r.band), evidence: r.evidence_count });

/**
 * Bandı olan yapraklar p'ye göre: en zayıf `weakN` ("iyi" olmayanlar), en güçlü `strongN` ("zayıf" olmayanlar, zayıf
 * listesindekiler hariç). Eşitlikte çok kanıtlı önce, sonra kazanım kodu.
 */
export function masterySummary(rows: readonly MasteryInput[], weakN = 8, strongN = 5): MasterySummary {
  const banded = rows.filter((r) => r.band !== null && r.p !== null && r.evidence_count > 0);
  const tie = (a: MasteryInput, b: MasteryInput) => b.evidence_count - a.evidence_count || a.skill_id.localeCompare(b.skill_id, 'tr', { numeric: true });
  const asc = [...banded].sort((a, b) => (a.p as number) - (b.p as number) || tie(a, b));
  const weak = asc.filter((r) => r.band !== 'high').slice(0, weakN);
  const taken = new Set(weak.map((r) => r.skill_id));
  const strong = [...banded]
    .sort((a, b) => (b.p as number) - (a.p as number) || tie(a, b))
    .filter((r) => r.band !== 'low' && !taken.has(r.skill_id))
    .slice(0, strongN);
  return {
    weakest: weak.map(line),
    strongest: strong.map(line),
    thin: rows.filter((r) => r.band === null && r.evidence_count > 0).length,
  };
}

export interface MisconceptionInput {
  id: string;
  tag: string | null;
  text_instructor: string;
  evidence_count: number;
  last_seen: string;
}

export interface MisconceptionLine {
  id: string;
  tag: string;
  text: string;
  evidence: number;
}

/** Açık yanılgılar: çok kanıtlı önce, sonra en son görülen; en çok `max`. */
export function misconceptionLines(rows: readonly MisconceptionInput[], max = 8): MisconceptionLine[] {
  return [...rows]
    .sort((a, b) => b.evidence_count - a.evidence_count || b.last_seen.localeCompare(a.last_seen))
    .slice(0, max)
    .map((m) => ({ id: m.id, tag: m.tag ?? 'etiketsiz', text: m.text_instructor, evidence: m.evidence_count }));
}

const CAUSE_WORD: Record<ErrorCause, string> = { concept: 'kavram', procedure: 'işlem', careless: 'dikkat', reading: 'okuma', time: 'süre' };

/** Hata nedeni tek kelime; neden yoksa hükme göre ("doğru", "okunamadı", "—"). */
export function causeWord(cause: ErrorCause | null, verdict: Verdict): string {
  if (cause) return CAUSE_WORD[cause];
  if (verdict === 'correct') return 'doğru';
  if (verdict === 'unreadable') return 'okunamadı';
  return '—';
}

export interface DiagnosisInput {
  id: string;
  created_at: string;
  verdict: Verdict;
  failing_step_no: number | null;
  error_cause: ErrorCause | null;
  skill_ids: string[];
  analysis: unknown;
}

export interface DiagnosisLine {
  id: string;
  date: string;
  skill: string | null;
  sentence: string;
  cause: string;
}

/** Son teşhisler: tarih, kazanım adı (bilinmiyorsa kod), tek cümle (Sonuç ekranıyla aynı), neden kelimesi. */
export function diagnosisLines(rows: readonly DiagnosisInput[], skillNames: ReadonlyMap<string, string>): DiagnosisLine[] {
  return rows.map((r) => {
    const analysis = readAnalysis(r.analysis);
    const skillId = primarySkill(r.skill_ids, analysis.skill_order, null);
    return {
      id: r.id,
      date: formatDay(r.created_at),
      skill: skillId ? (skillNames.get(skillId) ?? skillId) : null,
      sentence: summarySentence({ verdict: r.verdict, failing_step_no: r.failing_step_no, error_cause: r.error_cause, analysis }),
      cause: causeWord(r.error_cause, r.verdict),
    };
  });
}

export interface ExamInput {
  id: string;
  exam_id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  score: unknown;
}

export interface ExamLine {
  id: string;
  date: string;
  title: string;
  /** "net 27,5" ya da "12 doğru · 3 yanlış"; sonuç yoksa durum kelimesi. */
  result: string;
}

const STATUS_WORD: Record<string, string> = { in_progress: 'sürüyor', grading: 'puanlanıyor', analysing: 'inceleniyor', done: 'sonuç yok', failed: 'başarısız' };

export function examLines(rows: readonly ExamInput[], titles: ReadonlyMap<string, string>): ExamLine[] {
  return rows.map((s) => {
    const net = netOf(s.score);
    const sc = s.score && typeof s.score === 'object' ? (s.score as { correct?: unknown; wrong?: unknown }) : {};
    const counts = typeof sc.correct === 'number' && typeof sc.wrong === 'number' ? `${sc.correct} doğru · ${sc.wrong} yanlış` : null;
    return {
      id: s.id,
      date: formatDay(s.finished_at ?? s.started_at),
      title: titles.get(s.exam_id) ?? 'Deneme',
      result: net !== null ? `net ${formatNet(net)}` : (counts ?? STATUS_WORD[s.status] ?? s.status),
    };
  });
}

const dayFmt = new Intl.DateTimeFormat('tr-TR', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });

/** "17 Kas 2026" (İstanbul günü); 'YYYY-AA-GG' tarihleri gün olarak okunur. Geçersizse boş. */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : dayFmt.format(d);
}
