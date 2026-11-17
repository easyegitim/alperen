/**
 * Tarz kütüphanesi (P4, docs/PLAN-v2.md §11) kullanıcı turu metinleri:
 *   - çıkmış sınav sayfası OCR'ı: exam_page_items rotası + `archivePageUserText` (yükleme sırası + arşiv satırı)
 *   - madde sınıflandırma: exam_item_extract + `examItemExtractUserText` (`<exam_item>` JSON + `Madde no: N.`)
 *   - tarz adlandırma: style_definition + `styleDefinitionUserText` (`<clusters>` JSON)
 *   - tarza özel üretim: style_question_gen + `styleQuestionGenUserText` (`<style_request>` JSON)
 *
 * Sahte taşımanın (OGRENMEN_LLM=fake) eşleme anahtarları buradaki satırlardır: `archiveMatch(yıl)` ("arşivi: 2024"),
 * `examItemMatch(no)` ("madde no: 3."), `STYLE_CLUSTERS_MARK`, `STYLE_REQUEST_MARK`.
 *
 * Çıkmış soru metni telifli olabilir: yalnız worker'ın kümeleme ve adlandırma çağrılarına girer, öğrenciye giden hiçbir
 * çıktıya kopyalanmaz. Tarza özel üretimde örnek maddenin metni gönderilmez; yalnız yapısı (konu, biçim, tuzak, zorluk).
 * Kullanıcı verisi tek satırda `clean()`, JSON bloklarında `jsonBlock()` ile yazılır (veri bloğu kapatılamaz).
 */
import { examPageItemsUserText, type ExamPageItemsInput } from './exam-input.js';

function clean(s: string, max = 300): string {
  return s.replace(/[\r\n]+/g, ' ').replace(/</g, '‹').replace(/>/g, '›').trim().slice(0, max);
}

function jsonBlock(v: unknown): string {
  return JSON.stringify(v, null, 1).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

export const ARCHIVE_TERMS = ['vize', 'final', 'but', 'deneme', 'osym', 'meb', 'diger'] as const;
export type ArchiveTerm = (typeof ARCHIVE_TERMS)[number];

const TERM_TR: Record<ArchiveTerm, string> = {
  vize: 'vize',
  final: 'final',
  but: 'bütünleme',
  deneme: 'deneme',
  osym: 'ÖSYM',
  meb: 'MEB',
  diger: 'sınav',
};

export interface ArchiveTag {
  year: number;
  term: ArchiveTerm | string | null;
}

function assertYear(year: number): void {
  if (!Number.isInteger(year) || year < 1950 || year > 2100) throw new RangeError(`geçersiz yıl: ${year}`);
}

/** `Çıkmış sınav arşivi: 2024 final.` */
export function archiveLine(a: ArchiveTag): string {
  assertYear(a.year);
  const t = a.term && (ARCHIVE_TERMS as readonly string[]).includes(a.term) ? TERM_TR[a.term as ArchiveTerm] : 'sınav';
  return `Çıkmış sınav arşivi: ${a.year} ${t}.`;
}

/** Sahte taşıma eşleme anahtarı: `arşivi: 2024` */
export function archiveMatch(year: number): string {
  assertYear(year);
  return `arşivi: ${year}`;
}

/** Çıkmış sınav sayfası (exam_page_items rotası): deneme kitapçığı metnine arşiv satırı ve açık uçlu soru notu eklenir. */
export function archivePageUserText(i: ExamPageItemsInput & ArchiveTag): string {
  return [
    examPageItemsUserText({ order: i.order, total: i.total, sectionHint: i.sectionHint ?? null, previous: i.previous ?? null }),
    archiveLine(i),
    'Bu sayfa bir okul ya da kurum sınavından; şıksız sorular (hesap, ispat, kısa cevap) open olarak yazılır, alt maddeler (a, b, c) sorunun kökünde kalır.',
  ].join('\n');
}

export interface ExamItemExtractInput extends ArchiveTag {
  sourceId: string;
  itemNo: number;
  section: string | null;
  /** OCR türü (mcq | numeric | open). */
  kindHint: string;
  text: string;
  options: readonly { key: string; text: string }[];
  figures: readonly string[];
  legibility: string | null;
}

/** Sahte taşıma eşleme anahtarı: `madde no: 3.` */
export function examItemMatch(itemNo: number): string {
  return `madde no: ${itemNo}.`;
}

/** exam_item_extract: tek madde. Metin yalnız sınıflandırma içindir; ocr_text alanına aynen geri yazılır. */
export function examItemExtractUserText(i: ExamItemExtractInput): string {
  if (!Number.isInteger(i.itemNo) || i.itemNo < 1) throw new RangeError(`geçersiz madde numarası: ${i.itemNo}`);
  const data = {
    source_id: i.sourceId,
    item_no: i.itemNo,
    year: i.year,
    term: i.term,
    section: i.section,
    kind_hint: i.kindHint,
    legibility: i.legibility,
    text: i.text.slice(0, 6000),
    options: i.options.map((o) => ({ key: o.key, text: o.text.slice(0, 600) })),
    figures: i.figures.map((f) => f.slice(0, 200)),
  };
  return [archiveLine(i), `Madde no: ${i.itemNo}.`, '<exam_item>', jsonBlock(data), '</exam_item>', 'Bu maddeyi sınıflandır.'].join('\n');
}

/** style_definition isteğinin işareti (sahte taşıma eşlemesi). */
export const STYLE_CLUSTERS_MARK = 'Adlandırılacak tarz kümeleri';

export interface ClusterMemberInput {
  year: number | null;
  term: string | null;
  item_no: number;
  topic: string | null;
  kind: string;
  format: string | null;
  trick: string | null;
  difficulty: number | null;
  skill_ids: string[];
  /** Kümeleme ve adlandırma için madde metninin başı (alıntı yapılmaz). */
  excerpt: string;
}

export interface ClusterInput {
  cluster_id: string;
  size: number;
  years: number[];
  skill_ids: string[];
  members: ClusterMemberInput[];
}

export interface StyleDefinitionInput {
  courseCode: string | null;
  courseTitle: string | null;
  clusters: readonly ClusterInput[];
  /** Dersin var olan tarz kodları (yeni kod bunlarla çakışmaz). */
  takenCodes: readonly string[];
}

export function styleDefinitionUserText(i: StyleDefinitionInput): string {
  const lines = [`${STYLE_CLUSTERS_MARK}: ${i.clusters.length}.`];
  if (i.courseCode || i.courseTitle) lines.push(`Ders: ${clean([i.courseCode, i.courseTitle].filter(Boolean).join(' · '), 160)}`);
  if (i.takenCodes.length > 0) lines.push(`Kullanılmış tarz kodları (yeni kodlar bunlardan farklı olur): ${i.takenCodes.slice(0, 120).map((c) => clean(c, 60)).join(', ')}`);
  lines.push(
    '<clusters>',
    jsonBlock(
      i.clusters.map((c) => ({
        ...c,
        members: c.members.slice(0, 6).map((m) => ({ ...m, excerpt: m.excerpt.slice(0, 400) })),
      })),
    ),
    '</clusters>',
    'Her küme için bir tarz yaz.',
  );
  return lines.join('\n');
}

/** style_question_gen isteğinin işareti (sahte taşıma eşlemesi). */
export const STYLE_REQUEST_MARK = 'Tarza özel soru isteği';

export interface StyleRequestInput {
  style: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    format: string | null;
    trick: string | null;
    difficulty_band: string | null;
  };
  count: number;
  skills: readonly { id: string; name: string; description?: string | null }[];
  /** Arşivdeki örneklerin yapısı (metin yok). */
  exemplars: readonly { year: number | null; kind: string; format: string | null; topic: string | null; trick: string | null; difficulty: number | null; points: number | null }[];
  /** Bankada bu tarzın kökleri (yinelenmesin; en çok 20, kısaltılmış). */
  avoidStems: readonly string[];
  courseTitle: string | null;
}

export function styleQuestionGenUserText(i: StyleRequestInput): string {
  if (!Number.isInteger(i.count) || i.count < 1 || i.count > 10) throw new RangeError(`soru sayısı 1–10 olmalı: ${i.count}`);
  const data = {
    course: i.courseTitle,
    style: i.style,
    count: i.count,
    skills: i.skills.map((s) => ({ id: s.id, name: s.name, ...(s.description ? { description: s.description } : {}) })),
    exemplars: i.exemplars.slice(0, 6),
    avoid_stems: i.avoidStems.slice(0, 20).map((s) => s.slice(0, 200)),
  };
  return [`${STYLE_REQUEST_MARK}: ${i.count} soru.`, '<style_request>', jsonBlock(data), '</style_request>', 'Bu tarzda özgün sorular yaz.'].join('\n');
}
