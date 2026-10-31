/**
 * Çıktı ve giriş kuralları (§5.5 adım 2 ve 6): yasak konu (not, puan, devamsızlık, ödeme …),
 * enjeksiyon şüphesi, emoji/ünlem temizliği, ≤ 4 satır bölme, sınav bağlamında yasak kelimeler,
 * düşük güven → yükseltme, used_fact_ids / detected_skill_ids sunucu doğrulaması.
 * Tüm düzenli ifadeler modül yüklenirken bir kez derlenir.
 */
import { splitLines } from '../telegram/format.ts';
import { texts } from '../texts.ts';
import type { TutorReply } from './structured.ts';

export type Guard = 'forbidden_topic' | 'unsure' | 'human_requested' | 'quota' | 'consent_missing' | 'figure_unverified' | 'format_fix' | 'injection_suspect';

/**
 * Yasak konu kategorileri (§5.5 adım 2: "not, puan, devamsızlık, yoklama, ödeme, taksit, ücret, karne,
 * sınav sonucu + ek varyantları"). Her kategoride iki küme vardır:
 *  - `own`: birinci tekil/çoğul kişi ya da öğrencinin kendi durumu ("notumu", "puanım", "taksidim",
 *    "devamsızlığım", "kaç puan aldım") → her zaman yasak konu.
 *  - `any`: ekli ama kişisiz biçimler ("fizik notu", "not ortalaması", "taksit", "kurs ücreti") → yalnız
 *    metin bir matematik problemi gibi görünmüyorsa yasak konu. TYT problemlerinde "taksi ücreti km
 *    başına 5 TL", "doğru cevap 4 puan", "sınıfın not ortalaması 72" sık geçer; bunlar öğretim konusudur.
 * "not defteri", "notasyon", "nota" eşleşmez (kök "not" ancak u/lar ekiyle sayılır).
 */
const W = (body: string): RegExp => new RegExp(`(?:^|[^\\p{L}])(?:${body})(?=[^\\p{L}]|$)`, 'u');
const TOPICS: ReadonlyArray<{ name: string; own: RegExp; any: RegExp }> = [
  {
    name: 'not',
    own: W('notu[mn]\\p{L}*|(?<!(?:ders|konu|anlatım|özet) )notlar[ıi]m\\p{L}*|karnem\\p{L}*|puan[ıi][mn]\\p{L}*|ortalamam\\p{L}*|not ortalamam\\p{L}*'),
    any: W('notu\\p{L}*|(?<!(?:ders|konu|anlatım|özet) )notlar\\p{L}*|not ortalama\\p{L}*|karne\\p{L}*|puan\\p{L}*'),
  },
  {
    name: 'devamsizlik',
    own: W('devams[ıi]zl[ıi][kğ][ıi]m\\p{L}*|devamım\\p{L}*|yoklamaya (?:yazıldım|girdim|geçtim)\\p{L}*|devam durumum\\p{L}*'),
    any: W('devams[ıi]zl[ıi][kğ]\\p{L}*|yoklama\\p{L}*|devam durum\\p{L}*'),
  },
  {
    name: 'odeme',
    own: W('ödemem\\p{L}*|ödemeyi (?:ne zaman )?yapar[ıi]m\\p{L}*|taksi[td]im\\p{L}*|taksi[td]lerim\\p{L}*|ücretim\\p{L}*|faturam\\p{L}*|borcum\\p{L}*|borcu[mn]uz\\p{L}*'),
    any: W('ödeme\\p{L}*|taksit\\p{L}*|taksid[ıi]\\p{L}*|ücret\\p{L}*|fatura\\p{L}*'),
  },
  {
    name: 'sinav_sonucu',
    own: W('sınav sonu[cç]um\\p{L}*|deneme sonu[cç]um\\p{L}*|kaç (?:net|puan) (?:yaptım|aldım)|netlerim\\p{L}*'),
    any: W('sınav sonu[cç]\\p{L}*|deneme sonu[cç]\\p{L}*'),
  },
];

/** Matematik problemi görünümü: bir rakam ve bir işlem/soru kalıbı ("kaç", "bulunuz", +, =, %, TL, km …). */
const MATH_PROBLEM = /\p{N}[\s\S]*(?:[+\-*/×÷=%^√]|\bkaç|bulunuz|hesapla|\bTL\b|\bkm\b|\bsoru\p{L}*)|(?:kaç|bulunuz|hesapla)[\s\S]*\p{N}/iu;

const TOPIC_WORDS: Record<string, RegExp> = {
  not: /(not|karne|puan)/iu,
  devamsizlik: /(devams|yoklama|devam)/iu,
  odeme: /(ödeme|taksit|ücret|fatura)/iu,
  sinav_sonucu: /(sonuç|sonuc|net|puan)/iu,
};

export function forbiddenTopic(text: string): string | null {
  // Türkçe büyük/küçük harf (İ/I/ı) /i bayrağıyla katlanmaz; önce tr-TR küçük harf.
  const lower = text.toLocaleLowerCase('tr-TR');
  for (const t of TOPICS) if (t.own.test(lower)) return t.name;
  if (MATH_PROBLEM.test(lower)) return null;
  for (const t of TOPICS) if (t.any.test(lower)) return t.name;
  return null;
}

/** Onaylı olgu bu yasak konuyla mı ilgili (aynı kategoriden bir kelime taşıyor mu). */
export function factMatchesTopic(topic: string, factText: string): boolean {
  return TOPIC_WORDS[topic]?.test(factText) === true;
}

const INJECTION = /(kurallar[ıi] unut|önceki (talimat|kural)\p{L}* (unut|yok say)|sistem (mesaj|prompt)\p{L}*|ignore (all |the )?(previous|prior) instructions|you are now|developer mode)/iu;

export function injectionSuspect(text: string): boolean {
  return INJECTION.test(text);
}

/**
 * Emoji: sunumu emoji olan kod noktaları + bayrak (bölgesel gösterge) + ZWJ/FE0F dizileri. ©, ™, ↔, ✓,
 * ✕, ★ gibi metin sunumlu işaretler kalır (Extended_Pictographic bunları da silerdi).
 */
const EMOJI = /(?:\p{Extended_Pictographic}\u{FE0F}|\p{Emoji_Presentation}|[\u{1F1E6}-\u{1F1FF}]|\u{FE0F}|\u{200D}|\u{20E3})/gu;
/** Cümle ünlemi; faktöriyel ("5! = 120", "(n+1)!", "n!") korunur: rakam, ")" ya da tek harfli değişkenden sonra gelen "!" silinmez. */
const EXCLAIM_RUN = /(?<![\p{N})])(?<!(?:^|[^\p{L}])\p{L})!+/gu;
const YANLIS = /\bYanlış!+/gu;
const EXAM_WORDS = /(çıkacak|kesin(lik)?le|kesin|tahmin|garanti)/iu;
const EXAM_CONTEXT = /(sınav|deneme|vize|final|soru)/iu;

/** Kural dışı karakterleri temizler; değiştiyse `format_fix`. */
export function cleanText(text: string): { text: string; fixed: boolean } {
  let out = text.replace(YANLIS, '✕ Tekrar dene.').replace(EMOJI, '').replace(EXCLAIM_RUN, '.');
  out = out.replace(/\.{2,}/g, '.').replace(/[ \t]+\n/g, '\n').replace(/ {2,}/g, ' ').trim();
  return { text: out, fixed: out !== text.trim() };
}

/** Sınav bağlamında yasak kelime taşıyan satırları atar. */
export function dropExamClaims(text: string): { text: string; dropped: boolean } {
  const lines = text.split('\n');
  const kept = lines.filter((l) => !(EXAM_WORDS.test(l) && (EXAM_CONTEXT.test(l) || EXAM_CONTEXT.test(text))));
  return { text: kept.join('\n').trim(), dropped: kept.length !== lines.length };
}

export interface GuardContext {
  knownFactIds: ReadonlySet<number>;
  curriculumSkillIds: ReadonlySet<string>;
  studentText: string;
}

export interface GuardResult {
  messages: string[];
  guards: Guard[];
  escalate: boolean;
  escalateReason: 'bot_unsure' | 'grade_attendance_payment' | 'human_requested' | null;
  usedFactIds: number[];
  skillIds: string[];
  confidence: number;
}

export const CONFIDENCE_FLOOR = 0.55;

export function checkReply(reply: TutorReply, ctx: GuardContext): GuardResult {
  const guards: Guard[] = [];
  if (injectionSuspect(ctx.studentText)) guards.push('injection_suspect');
  const usedFactIds = reply.used_fact_ids.filter((id) => ctx.knownFactIds.has(id));
  const skillIds = reply.detected_skill_ids.filter((id) => ctx.curriculumSkillIds.has(id));
  const unsure = reply.confidence < CONFIDENCE_FLOOR || reply.escalate;
  if (unsure) {
    guards.push(reply.escalate_reason === 'grade_attendance_payment' ? 'forbidden_topic' : 'unsure');
    return {
      messages: [reply.escalate_reason === 'grade_attendance_payment' ? texts.handoff : texts.unsure],
      guards,
      escalate: true,
      escalateReason: reply.escalate_reason ?? 'bot_unsure',
      usedFactIds,
      skillIds,
      confidence: reply.confidence,
    };
  }
  const cleaned = cleanText(reply.reply);
  if (cleaned.fixed) guards.push('format_fix');
  const exam = dropExamClaims(cleaned.text);
  if (exam.dropped && guards.includes('format_fix') === false) guards.push('format_fix');
  if (exam.text === '') {
    guards.push('unsure');
    return { messages: [texts.unsure], guards, escalate: true, escalateReason: 'bot_unsure', usedFactIds, skillIds, confidence: reply.confidence };
  }
  const chunks = splitLines(exam.text, 4);
  if (chunks.length > 1) {
    const lastIdx = chunks.length - 1;
    const last = chunks[lastIdx] ?? '';
    if (last.trimEnd().endsWith('?') === false) {
      const lines = last.split('\n');
      chunks[lastIdx] = lines.length >= 4 ? last : `${last}\n${texts.continueQuestion}`;
      if (lines.length >= 4) chunks.push(texts.continueQuestion);
    }
  }
  return { messages: chunks, guards, escalate: false, escalateReason: null, usedFactIds, skillIds, confidence: reply.confidence };
}

/** `is_question` giriş sezgiseli (§5.2): soru işaretiyle biten ya da soru ekleri/kelimeleri taşıyan metin. */
const Q_END = /\?\s*$/;
const Q_WORD = /(^|\s)(mi|mı|mu|mü|nasıl|neden|niye|kaç)(\s|$|\?)/iu;
export function isQuestion(text: string): boolean {
  return Q_END.test(text) || Q_WORD.test(text);
}

/** Havuz eşlemesi tetikleyicisi (§5.5 adım 2): "anlamadım / tekrar / neden / nasıl". */
const POOL_TRIGGER = /(anlamad[ıi]m|anlayamad[ıi]m|tekrar|neden|nas[ıi]l)/iu;
export function wantsExplanation(text: string): boolean {
  return POOL_TRIGGER.test(text);
}

/** DB-önce şablon kalıpları (LLM yok). */
const PROGRESS_RE = /(ilerleme\p{L}*|ne durumday[ıi]m|ustal[ıi]k\p{L}*)/iu;
/** "kota", "kotam", "kotamı", "kotan" …; "kotanjant" (kotanjant fonksiyonu) eşleşmez. */
const QUOTA_RE = /(?:^|[^\p{L}])(?:kota(?:m|m[ıi]|n|n[ıi]|y[ıi]|s[ıi]|m[ıi]z)?(?=[^\p{L}]|$)|(?:kaç )?mesaj hakk\p{L}*|test hakk\p{L}*)/iu;
/** Yalnız sınav/teslim tarihi soruları ("f(x) ne zaman sıfır olur?" eşleşmez). */
const WHEN_RE = /(?:^|[^\p{L}])(?:(?:sınav|deneme|vize|final|teslim|ödev|proje|kayıt|tatil)\p{L}* (?:ne zaman|hangi gün|kaçta|tarihi)|yarın sınav\p{L}*|son teslim\p{L}*)/iu;
export function templateIntent(text: string): 'progress' | 'quota' | 'when' | null {
  if (QUOTA_RE.test(text)) return 'quota';
  if (PROGRESS_RE.test(text)) return 'progress';
  if (WHEN_RE.test(text)) return 'when';
  return null;
}

/** Bekleyen soruya şık/sayı cevabı mı: "B", "b şıkkı", "cevap C", "7/8", "3,5". */
const OPTION_ANSWER = /^\s*(?:(?:cevap(?:[ıi]m)?|cevab[ıi]m|cevab[ıi])\s*[:=]?\s*)?([abcdABCD])(?:\s*(?:şıkkı|şık|seçeneği))?\s*[.)]?\s*$/u;
const NUMBER_ANSWER = /^\s*(-?\d+(?:[.,]\d+)?(?:\s*\/\s*-?\d+)?)\s*$/u;
export function parseAnswer(text: string): { key: string } | { value: string } | null {
  const o = OPTION_ANSWER.exec(text);
  if (o) return { key: (o[1] ?? '').toUpperCase() };
  const n = NUMBER_ANSWER.exec(text);
  if (n) return { value: (n[1] ?? '').replace(/\s+/g, '') };
  return null;
}
