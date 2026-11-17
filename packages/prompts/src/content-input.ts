/**
 * İçerik stüdyosu rotalarının kullanıcı turu metinleri (P3, PLAN-v2 Akış 5 ve §7): notes_generation,
 * exam_generation, personalization_check, figure_check. Prompt gövdeleri bu biçimi anlatır; hat (apps/worker) metni
 * burada kurar ki prompt ile girdi ayrışmasın. Görsel blokları (figür PNG'si) çağıran ekler.
 *
 * Öğrencinin serbest metni (koç sohbetindeki not isteği) yalnız `<student_request>` bloğunda, satır sonu ve açılı ayraç
 * temizlenerek gider; JSON blokları `<` `>` kaçışlıdır: veri bloğu kapatılamaz. Kişisel bilgi (ad, okul) girmez.
 */
import { DIFFICULTY_BANDS, type PatternSource } from '@ogrenmen/contracts';

/** JSON'a giren alanlar: satır sonları tek boşluk, kırp, kes. `<` `>` korunur (KaTeX eşitsizlikleri); `jsonBlock` kaçırır. */
function oneLine(s: string, max = 300): string {
  return s.replace(/[\r\n]+/g, ' ').trim().slice(0, max);
}

/** JSON dışı serbest metin (`<student_request>`): ayrıca açılı ayraçlar etkisizleştirilir. */
function clean(s: string, max = 300): string {
  return s.replace(/[\r\n]+/g, ' ').replace(/</g, '‹').replace(/>/g, '›').trim().slice(0, max);
}

function jsonBlock(v: unknown): string {
  return JSON.stringify(v, null, 1).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

/** Öğrencinin gerçek bir örüntüsü (patterns.md satırı, açık yanılgı ya da analiz). Kimliği worker verir. */
export interface PatternInput {
  source: PatternSource;
  /** patterns.md için `patterns.md:<satır>`, yanılgı için etiket kodu, analiz için kayıt kimliği. */
  id: string;
  /** Gözlendiği günler (YYYY-AA-GG, eskiden yeniye). */
  dates: string[];
  skill_code: string | null;
  /** Örüntünün kısa tanımı (kişisel bilgi içermez). */
  summary: string;
  /** Kaç kez görüldü. */
  count: number;
  /** Varsa somut bir örnek (öğrencinin yazdığı ve doğrusu), KaTeX. */
  example?: string | null;
}

export interface NotesRequest {
  /** Konu adı (ör. Rasyonel sayılar). */
  topic: string;
  /** Hedef yaprak kazanımlar (ders bloğundaki kod ve ad). */
  skills: { code: string; name: string }[];
  /** Hedef sayfa sayısı (A4, kapak hariç). */
  pages: number;
  /** "Hatalarımı dahil et" (varsayılan açık). */
  include_mistakes: boolean;
  /** Kendini sına soru sayısı (varsayılan 5). */
  self_check_count?: number;
  /** Öğrencinin gerçek örüntüleri; boşsa not kişiselleştirilmez. */
  patterns: PatternInput[];
  /** Koç sohbetindeki istek cümlesi (isteğe bağlı; veri olarak gider). */
  student_request?: string | null;
}

function assertDates(p: PatternInput): void {
  if (p.dates.length === 0 || p.dates.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d))) throw new RangeError(`örüntü tarihleri YYYY-AA-GG olmalı: ${p.id}`);
}

function patternBlock(patterns: readonly PatternInput[]): string {
  patterns.forEach(assertDates);
  return jsonBlock(
    patterns.map((p) => ({
      source: p.source,
      id: oneLine(p.id, 120),
      dates: p.dates,
      skill_code: p.skill_code,
      summary: oneLine(p.summary, 300),
      count: p.count,
      example: p.example ? oneLine(p.example, 300) : null,
    })),
  );
}

/** Not kişiselleştirilir mi: hatalar dahil ve en az bir gerçek örüntü var. */
export function notesPersonalized(r: Pick<NotesRequest, 'include_mistakes' | 'patterns'>): boolean {
  return r.include_mistakes && r.patterns.length > 0;
}

export function notesGenerationUserText(r: NotesRequest): string {
  if (r.skills.length === 0) throw new RangeError('not isteğinde en az bir hedef kazanım olmalı');
  if (!Number.isInteger(r.pages) || r.pages < 1 || r.pages > 12) throw new RangeError(`sayfa sayısı 1-12: ${r.pages}`);
  const selfCheck = r.self_check_count ?? 5;
  if (!Number.isInteger(selfCheck) || selfCheck < 1 || selfCheck > 10) throw new RangeError(`kendini sına sayısı 1-10: ${selfCheck}`);
  const personalized = notesPersonalized(r);
  const req = {
    topic: oneLine(r.topic, 120),
    skills: r.skills.map((s) => ({ code: s.code, name: oneLine(s.name, 120) })),
    pages: r.pages,
    self_check_count: selfCheck,
    include_mistakes: r.include_mistakes,
    personalized,
  };
  const lines = ['Not isteği:', `<note_request>${jsonBlock(req)}</note_request>`];
  lines.push(
    personalized
      ? 'Öğrencinin örüntüleri (hata kutuları yalnız bunlara başvurur):'
      : 'Öğrencinin örüntüleri: bu notta kullanılmaz (kişiselleştirilmemiş not).',
  );
  lines.push(`<patterns>${personalized ? patternBlock(r.patterns) : '[]'}</patterns>`);
  if (r.student_request) lines.push(`<student_request>${clean(r.student_request, 400)}</student_request>`);
  lines.push('Bu isteğe göre notu yaz.');
  return lines.join('\n');
}

export interface ExamSectionRequest {
  name: string;
  count: number;
  /** Bu bölümde kullanılabilecek yaprak kazanım kodları. */
  skills: string[];
}

export interface ExamRequest {
  title: string;
  /** Sınav türü (TYT, AYT, LGS, final…): soru biçimini belirler. */
  exam: string;
  sections: ExamSectionRequest[];
  difficulty: Record<(typeof DIFFICULTY_BANDS)[number], number>;
  duration_min: number | null;
  /** Şık sayısı (TYT/AYT 5, LGS 4). */
  options_per_question: 4 | 5;
  /** "Hatalarımı dahil et": zayıf yapraklar ve örüntüler çeldiricilere ve soru dağılımına yansır. */
  include_mistakes: boolean;
  focus_skills?: string[];
  patterns?: PatternInput[];
  /** Tarz kütüphanesinden seçilen tarzlar (isteğe bağlı). */
  styles?: { id: string; name: string; description: string }[];
}

/** Deneme en çok 40 soru (PLAN-v2 Akış 5). */
export const MAX_EXAM_QUESTIONS = 40;

export function examGenerationUserText(r: ExamRequest): string {
  const total = r.sections.reduce((s, x) => s + x.count, 0);
  if (r.sections.length === 0 || total < 1 || total > MAX_EXAM_QUESTIONS) throw new RangeError(`deneme 1-${MAX_EXAM_QUESTIONS} soru: ${total}`);
  if (r.sections.some((s) => !Number.isInteger(s.count) || s.count < 1 || s.skills.length === 0)) throw new RangeError('her bölümde en az bir soru ve kazanım olmalı');
  const diff = DIFFICULTY_BANDS.reduce((s, b) => s + r.difficulty[b], 0);
  if (diff !== total) throw new RangeError(`zorluk dağılımı (${diff}) soru sayısına (${total}) eşit olmalı`);
  const req = {
    title: oneLine(r.title, 160),
    exam: oneLine(r.exam, 40),
    total,
    options_per_question: r.options_per_question,
    duration_min: r.duration_min,
    blueprint: {
      sections: r.sections.map((s) => ({ name: oneLine(s.name, 80), count: s.count })),
      difficulty: { easy: r.difficulty.easy, medium: r.difficulty.medium, hard: r.difficulty.hard },
    },
    section_skills: Object.fromEntries(r.sections.map((s) => [oneLine(s.name, 80), s.skills])),
    include_mistakes: r.include_mistakes,
    focus_skills: r.include_mistakes ? (r.focus_skills ?? []) : [],
    styles: (r.styles ?? []).map((s) => ({ id: s.id, name: oneLine(s.name, 80), description: oneLine(s.description, 300) })),
  };
  const lines = ['Deneme isteği:', `<exam_request>${jsonBlock(req)}</exam_request>`];
  if (r.include_mistakes && (r.patterns?.length ?? 0) > 0) {
    lines.push('Öğrencinin örüntüleri (çeldiricilerde ve soru seçiminde kullanılır; soru metninde öğrenci anılmaz):');
    lines.push(`<patterns>${patternBlock(r.patterns ?? [])}</patterns>`);
  }
  lines.push('Bu isteğe göre denemeyi yaz.');
  return lines.join('\n');
}

export interface CalloutForCheck {
  block_id: string;
  pattern_ref: { source: string; id: string; date: string } | null;
  text: string;
}

export function personalizationCheckUserText(i: { callouts: CalloutForCheck[]; patterns: PatternInput[] }): string {
  return [
    'Öğrencinin gerçek örüntüleri:',
    `<patterns>${patternBlock(i.patterns)}</patterns>`,
    'Nottaki hata kutuları:',
    `<callouts>${jsonBlock(i.callouts.map((c) => ({ block_id: c.block_id, pattern_ref: c.pattern_ref, text: c.text })))}</callouts>`,
    'Her kutuyu denetle.',
  ].join('\n');
}

export interface FigureCheckInput {
  /** Soru kökü ya da figürün geçtiği paragraf (KaTeX). */
  context: string;
  /** Figürün düz anlatımı (alt). */
  alt: string;
  /** Figürde görünmesi gereken değerler (ad → değer). Boşsa denetim bağlamdaki ve alt metindeki değerleri kullanır. */
  expected?: Record<string, number | string>;
  /** Figürde görünmemesi gereken (cevabı ele veren) değerler. */
  hidden?: (number | string)[];
}

export function figureCheckUserText(i: FigureCheckInput): string {
  return [
    `<figure_context>${jsonBlock({ context: i.context.slice(0, 2500), alt: oneLine(i.alt, 400), expected: i.expected ?? {}, hidden: i.hidden ?? [] })}</figure_context>`,
    'Görseldeki figürü bu bağlamla karşılaştır.',
  ].join('\n');
}
