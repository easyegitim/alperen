/**
 * Deneme rotalarının kullanıcı turu metinleri (page_class, exam_page_items, answer_sheet, inferred_keys, exam_report,
 * solution_diagnosis deneme bağlamı). Prompt gövdeleri bu biçimi anlatır; hat (apps/worker) metni burada kurar ki
 * prompt ile girdi ayrışmasın. Görsel blokları çağıran ekler (image/document), bu işlevler yalnız metin bloğunu verir.
 *
 * Yükleme sırası işareti (`Yükleme sırası: sayfa 2/3.`) sahte taşımanın (OGRENMEN_LLM=fake) fikstür eşlemesinde de
 * kullanılır: packages/llm/fixtures/<rota>/*.json `fake_match` ["sayfa 2/3."] gibi.
 *
 * Kullanıcı verisi (öğrencinin notu, deneme adı) sistem metnine girmez. Tek satırlık alanlar `clean()` ile (satır sonu ve
 * açılı ayraç `‹ ›` olur), JSON bloklarındaki alanlar `jsonBlock()` ile (`<` `>` kaçışlanır) yazılır: veri bloğu kapatılamaz.
 */

import type { ExamReportChartRef } from '@ogrenmen/contracts';

export interface UploadOrder {
  /** 1'den başlayan yükleme sırası. */
  order: number;
  /** Bu denemedeki toplam yükleme (sayfa) sayısı. */
  total: number;
}

function assertOrder(p: UploadOrder): void {
  if (!Number.isInteger(p.order) || !Number.isInteger(p.total) || p.order < 1 || p.order > p.total) {
    throw new RangeError(`geçersiz yükleme sırası: ${p.order}/${p.total}`);
  }
}

/**
 * Satır sonlarını temizler ve `<` `>` karakterlerini `‹ ›` yapar: tek geçişli etiket silme `<</a>/x>` ya da `</x >` ile
 * aşılabilir; karakterin kendisini değiştirmek hiçbir birleşimde etiket bırakmaz.
 */
function clean(s: string, max = 300): string {
  return s.replace(/[\r\n]+/g, ' ').replace(/</g, '‹').replace(/>/g, '›').trim().slice(0, max);
}

/** JSON metni; `<` `>` `\u003c` `\u003e` olur (geçerli JSON kalır, gömülü `</questions>` bloğu kapatamaz). */
function jsonBlock(v: unknown, space?: number): string {
  return JSON.stringify(v, null, space).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

/** `Yükleme sırası: sayfa 2/3.` (sahte fikstür eşleme anahtarı; küçük harfle `sayfa 2/3.`). */
export function uploadOrderLine(p: UploadOrder): string {
  assertOrder(p);
  return `Yükleme sırası: sayfa ${p.order}/${p.total}.`;
}

/** Sahte taşıma eşleme anahtarı (`fake_match`): `sayfa 2/3.` */
export function uploadOrderMatch(p: UploadOrder): string {
  assertOrder(p);
  return `sayfa ${p.order}/${p.total}.`;
}

export interface PageClassInput extends UploadOrder {
  examTitle?: string | null;
  courseTitle?: string | null;
}

export function pageClassUserText(i: PageClassInput): string {
  const lines = [uploadOrderLine(i)];
  if (i.examTitle) lines.push(`Deneme: ${clean(i.examTitle, 120)}`);
  if (i.courseTitle) lines.push(`Ders: ${clean(i.courseTitle, 120)}`);
  lines.push('Bu sayfanın türünü, dönüklüğünü, bölümünü ve sayfa numarasını belirle.');
  return lines.join('\n');
}

export interface ExamPageItemsInput extends UploadOrder {
  sectionHint?: string | null;
  /** Önceki kitapçık sayfasının son sorusu ve orada yarım kalıp kalmadığı. */
  previous?: { lastNo: number; continuesOnNext: boolean } | null;
}

export function examPageItemsUserText(i: ExamPageItemsInput): string {
  const lines = [uploadOrderLine(i)];
  if (i.sectionHint) lines.push(`Bölüm: ${clean(i.sectionHint, 80)}`);
  if (i.previous) {
    lines.push(`Önceki sayfanın son sorusu: ${i.previous.lastNo} (${i.previous.continuesOnNext ? 'bu sayfada devam ediyor' : 'tamamlanmış'}).`);
  } else {
    lines.push('Önceki kitapçık sayfası yok ya da bilinmiyor; numarasız devam parçası için prompttaki sayfalar arası kuralı uygulanır.');
  }
  lines.push('Bu sayfadaki soruları çıkar.');
  return lines.join('\n');
}

export interface AnswerSheetInput extends UploadOrder {
  questionCount?: number | null;
  sections?: readonly { name: string; from: number; to: number }[];
}

export function answerSheetUserText(i: AnswerSheetInput): string {
  const lines = [uploadOrderLine(i), 'Optik form.'];
  if (i.questionCount) lines.push(`Beklenen soru sayısı: ${i.questionCount}.`);
  for (const s of i.sections ?? []) lines.push(`Bölüm ${clean(s.name, 80)}: ${s.from}–${s.to}.`);
  lines.push('Formdaki kitapçık türünü ve her sorunun işaretini oku.');
  return lines.join('\n');
}

/** Cevap anahtarı sayfası (basılı harfler; optik form değil). Worker answer_key sayfalarını bu metinle okutur. */
export function answerKeyPageUserText(i: AnswerSheetInput): string {
  const lines = [uploadOrderLine(i), 'Cevap anahtarı sayfası: optik form değil; soru numaraları ve doğru şıklar harf olarak yazılı.'];
  if (i.questionCount) lines.push(`Beklenen soru sayısı: ${i.questionCount}.`);
  for (const s of i.sections ?? []) lines.push(`Bölüm ${clean(s.name, 80)}: ${s.from}–${s.to}.`);
  lines.push('Anahtardaki kitapçık türünü ve her sorunun doğru şıkkını oku.');
  return lines.join('\n');
}

export interface InferredKeysItem {
  no: number;
  section?: string | null;
  kind: 'mcq' | 'numeric' | 'open';
  stem: string;
  options: readonly { key: string; text: string }[];
  figureDescription?: string | null;
}

/** Sorular `<questions>` içinde JSON satırları olarak (öğrencinin işaretleri bu rotaya gitmez: anahtar bağımsız çözülür). */
export function inferredKeysUserText(i: { examTitle?: string | null; items: readonly InferredKeysItem[] }): string {
  const rows = i.items.map((q) =>
    jsonBlock({
      no: q.no,
      section: q.section ?? null,
      kind: q.kind,
      stem: q.stem,
      options: q.options,
      figure: q.figureDescription ?? null,
    }),
  );
  return [
    i.examTitle ? `Deneme: ${clean(i.examTitle, 120)}` : null,
    `Soru sayısı: ${i.items.length}.`,
    '<questions>',
    ...rows,
    '</questions>',
    'Her sorunun doğru cevabını çöz ve denetle.',
  ]
    .filter((x): x is string => x !== null)
    .join('\n');
}

export type ExamQuestionStatus = 'correct' | 'wrong' | 'blank' | 'double_mark';
export type KeySource = 'publisher' | 'instructor' | 'inferred';

export interface ExamReportInput {
  examTitle: string;
  courseTitle: string;
  date: string;
  durationMin: number | null;
  sections: readonly { name: string; correct: number; wrong: number; blank: number; net: number; questionCount: number }[];
  questions: readonly {
    no: number;
    section: string | null;
    skillId: string | null;
    skillName: string | null;
    status: ExamQuestionStatus;
    /** @deprecated Rapora girmez (anahtar ve işaret öğrenciye/veliye sızmasın); `examReportUserText` bu alanları yazmaz. */
    marked?: string | null;
    /** @deprecated Bkz. `marked`. */
    key?: string | null;
    keySource: KeySource;
    errorCause?: string | null;
    seconds?: number | null;
  }[];
  /** Bu denemeyle değişen ustalık bantları (zayıf/orta/iyi). */
  masteryChanges?: readonly { skillId: string; skillName: string; before: string; after: string }[];
  /** Hattın render anında dolduracağı grafik verileri (data_ref adları). */
  charts: readonly ExamReportChartRef[];
}

/**
 * Rapor verisi `<exam_result>` içinde JSON (sayılar hattan; model hesaplamaz). Rapor öğrenciye ve veliye gittiği için
 * doğru şık, anahtar ve öğrencinin işareti modele hiç verilmez: yalnız durum (doğru, yanlış, boş, çift işaret).
 */
export function examReportUserText(i: ExamReportInput): string {
  const safe = { ...i, questions: i.questions.map(({ marked: _m, key: _k, ...q }) => q) };
  return ['<exam_result>', jsonBlock(safe, 1), '</exam_result>', 'Bu denemenin raporunu yaz.'].join('\n');
}

export interface ExamContext {
  examTitle: string;
  durationMin: number | null;
  questionNo: number;
  section: string | null;
  /** Öğrencinin işaretlediği şık; boş ya da çift işaret. */
  marked: string | null;
  markStatus: 'marked' | 'blank' | 'double_mark';
  /** Çift işarette görülen şıklar. */
  marksSeen?: readonly string[];
  key: string | null;
  keySource: KeySource;
  /** Telifli kitapçık (yayıncı denemesi): soru metni öğrenci tarafına aynen çıkmamalı. */
  isCopyrighted?: boolean;
  /** Uygulama içi denemede bu soruya harcanan süre (sn) ve soruya dönüş sayısı. */
  secondsSpent?: number | null;
  visits?: number | null;
  /** Öğrencinin notu (fotoğraf / metin / hiç başlayamadım / süre yetmedi). */
  studentNote?: 'photo' | 'text' | 'not_started' | 'out_of_time' | null;
}

const NOTE_TR: Record<NonNullable<ExamContext['studentNote']>, string> = {
  photo: 'çözümünü fotoğrafla gönderdi',
  text: 'çözümünü yazarak gönderdi',
  not_started: 'hiç başlayamadım dedi',
  out_of_time: 'süre yetmedi dedi',
};

/**
 * `solution_diagnosis` v2 deneme bağlamı bloğu; kullanıcı turunun metin bloğuna eklenir. Sahte fikstür eşleme anahtarı:
 * `<exam_context>` ve `soru no: 4.` (`examContextMatch`).
 */
export function examContextText(c: ExamContext): string {
  const mark =
    c.markStatus === 'blank'
      ? 'boş'
      : c.markStatus === 'double_mark'
        ? `çift işaret (${(c.marksSeen ?? []).map((m) => clean(m, 40)).join(', ') || 'şıklar bilinmiyor'}; boş sayıldı)`
        : clean(c.marked ?? 'bilinmiyor', 40);
  const keySrc = c.keySource === 'inferred' ? 'inferred (çıkarılmış, doğrulanmadı)' : c.keySource === 'instructor' ? 'instructor (eğitmen)' : 'publisher (yayıncı)';
  const lines = [
    '<exam_context>',
    `Deneme: ${clean(c.examTitle, 120)}${c.durationMin ? ` (${c.durationMin} dakika)` : ''}`,
    `Soru no: ${c.questionNo}.`,
    ...(c.section ? [`Bölüm: ${clean(c.section, 80)}`] : []),
    `İşaretlenen şık: ${mark}`,
    `Anahtar: ${c.key == null ? 'yok' : clean(c.key, 40)} · kaynak ${keySrc}`,
  ];
  if (c.secondsSpent != null) lines.push(`Harcanan süre: ${c.secondsSpent} sn${c.visits != null ? ` · soruya ${c.visits} kez dönüldü` : ''}`);
  if (c.isCopyrighted) lines.push('Telifli kitapçık: question_text kökün kısa bir betimi olur, metin aynen yazılmaz.');
  if (c.studentNote) lines.push(`Öğrencinin notu: ${NOTE_TR[c.studentNote]}`);
  lines.push('</exam_context>');
  return lines.join('\n');
}

/** Sahte taşıma eşleme anahtarları (`fake_match`) — deneme bağlamlı teşhis. */
export function examContextMatch(questionNo: number): string[] {
  return ['<exam_context>', `soru no: ${questionNo}.`];
}
