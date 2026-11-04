// Deneme sonuç ekranının saf metinleri ve hesapları (test/exam-result.test.ts). Öğrenciye yüzde gösterilmez: sayılar
// "doğru/toplam" ve kelime bandıdır. Ünlem ve emoji yok.
import { BAND_WORDS, formatNet } from '@/server/progress/present';
import type { ExamHeatCell, ExamProgress, ExamResultItem, ExamSection, ExamSessionView } from './types';

export const examHref = (sessionId: string): string => `/ogrenci/deneme/${sessionId}`;
export const examDetailHref = (sessionId: string): string => `${examHref(sessionId)}?detay=1`;
export const howFarHref = (sessionId: string, responseId: string): string => `${examHref(sessionId)}/soru/${responseId}`;
export const examStatusHref = (sessionId: string): string => `${examHref(sessionId)}/durum`;

/** Büyük sayı: "27,5 net". */
export function netText(net: number): string {
  return `${formatNet(net)} net`;
}

/** Tek cümle sonuç (h1): en zayıf konu varsa onu söyler, yoksa sayıları. */
export function resultSentence(view: Pick<ExamSessionView, 'title' | 'summary'>): string {
  const s = view.summary;
  if (!s) return `${view.title} bitti.`;
  const blank = s.blank + s.unfinished;
  if (s.weakest?.name) return `${view.title}: en çok ${s.weakest.name} konusunda zorlandın.`;
  if (s.wrong + blank === 0) return `${view.title}: hepsi doğru.`;
  return `${view.title}: ${s.correct} doğru, ${s.wrong} yanlış, ${blank} boş.`;
}

/** "40 soruda 28 doğru, 8 yanlış, 4 boş." (Detay'ın ilk satırı). */
export function countsLine(view: Pick<ExamSessionView, 'summary'>): string | null {
  const s = view.summary;
  if (!s) return null;
  return `${s.total} soruda ${s.correct} doğru, ${s.wrong} yanlış, ${s.blank + s.unfinished} boş.`;
}

/** Anahtar güveni düşükse tek satır not; güvenliyse null. */
export function keyNote(view: Pick<ExamSessionView, 'summary' | 'answer_key_source'>): string | null {
  const unverified = view.summary?.unverified_keys ?? 0;
  if (unverified > 0) return unverified === 1 ? '1 sorunun cevap anahtarını doğrulayamadım; net bu yüzden değişebilir.' : `${unverified} sorunun cevap anahtarını doğrulayamadım; net bu yüzden değişebilir.`;
  const src = view.answer_key_source;
  if (src === 'inferred' || src === 'generated' || src === 'mixed') return 'Cevap anahtarını yayıncıdan değil, soruları çözerek çıkardım; resmî anahtarla farklı çıkarsa net değişebilir.';
  return null;
}

export interface SectionBar {
  section: string;
  title: string;
  netText: string;
  /** 0..1: net / toplam (negatif netler 0). Çubuk genişliği için; ekranda sayı olarak yazılmaz. */
  fill: number;
  detail: string;
}

export function sectionBars(sections: ExamSection[]): SectionBar[] {
  return sections.map((s) => ({
    section: s.section,
    title: s.title,
    netText: netText(s.net),
    fill: s.total > 0 ? Math.max(0, Math.min(1, s.net / s.total)) : 0,
    detail: `${s.correct} doğru · ${s.wrong} yanlış · ${s.blank + s.unfinished} boş`,
  }));
}

export interface HeatRow {
  id: string;
  label: string;
  /** "3/4" (doğru/soru). */
  ratio: string;
  /** zayıf · orta · iyi. */
  word: string;
  band: 'low' | 'mid' | 'high';
  /** Sıralı rampa basamağı 0..6 (doğru oranı). */
  value: number;
  /** Ekran okuyucu metni. */
  sr: string;
}

/** Isı haritası satırları, en zayıf konu üstte (düşük bant, çok yanlış+boş önce). */
export function heatRows(cells: ExamHeatCell[]): HeatRow[] {
  const order = { low: 0, mid: 1, high: 2 } as const;
  return [...cells]
    .sort((a, b) => order[a.band] - order[b.band] || b.wrong + b.blank - (a.wrong + a.blank) || a.name.localeCompare(b.name, 'tr'))
    .map((c) => ({
      id: c.skill_id,
      label: c.name,
      ratio: `${c.correct}/${c.total}`,
      word: BAND_WORDS[c.band],
      band: c.band,
      value: c.total > 0 ? c.correct / c.total : 0,
      sr: `${c.name}: ${c.total} sorudan ${c.correct} doğru, ${BAND_WORDS[c.band]}`,
    }));
}

const OUTCOME_WORDS = { wrong: 'Yanlış', blank: 'Boş', unfinished: 'Yetişmedi' } as const;
const REASON_WORDS = { not_started: 'Hiç başlayamadım', time: 'Süre yetmedi' } as const;

export interface ItemLine {
  responseId: string;
  title: string;
  /** Sağdaki kısa durum: "Nereye kadar geldim?" ya da verilen yanıt. */
  action: string;
  actionable: boolean;
  note: string | null;
}

export function itemLine(item: ExamResultItem): ItemLine {
  const title = `Soru ${item.no} · ${OUTCOME_WORDS[item.outcome]}`;
  switch (item.state) {
    case 'diagnosed':
      return { responseId: item.response_id, title, action: 'Teşhisi gör', actionable: true, note: item.diagnosis?.one_line ?? null };
    case 'pending':
      return { responseId: item.response_id, title, action: 'Bakıyorum', actionable: true, note: null };
    case 'reason_given':
      return { responseId: item.response_id, title, action: item.blank_reason ? REASON_WORDS[item.blank_reason] : 'Tamam', actionable: false, note: null };
    default:
      return { responseId: item.response_id, title, action: 'Nereye kadar geldim?', actionable: true, note: null };
  }
}

/** Yanlış/boş listesi: soru numarasına göre. */
export function itemLines(items: ExamResultItem[]): ItemLine[] {
  return [...items].sort((a, b) => a.no - b.no).map(itemLine);
}

/** Bekleme ekranı: ana satır sabit, alt satır aşamaya göre ("sayfa 3/12"). */
export function waitingLine(progress: ExamProgress | null | undefined): string {
  const stage = progress?.stage ?? 'classify';
  const total = progress?.pages_total;
  const done = progress?.pages_done;
  switch (stage) {
    case 'classify':
      return typeof total === 'number' && total > 0 ? `sayfa ${Math.min(done ?? 0, total)}/${total}` : 'sayfalar alınıyor';
    case 'ocr':
      return 'sorular okunuyor';
    case 'key':
      return 'cevap anahtarı hazırlanıyor';
    case 'grade':
      return 'optik form okunuyor';
    case 'analyse':
      return 'net hesaplanıyor';
    case 'report':
    case 'done':
      return 'rapor hazırlanıyor';
    default:
      return 'sayfalar alınıyor';
  }
}

export const STAGE_ORDER = ['classify', 'ocr', 'key', 'grade', 'analyse', 'report'] as const;

/** 0..1 genel ilerleme (aşama sırasına göre; çubuk için). */
export function stageFraction(progress: ExamProgress | null | undefined): number {
  const stage = progress?.stage ?? 'classify';
  const i = STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]);
  if (stage === 'done') return 1;
  if (i < 0) return 0;
  let within = 0;
  if (stage === 'classify' && progress?.pages_total) within = Math.min(1, (progress.pages_done ?? 0) / progress.pages_total);
  return (i + within) / STAGE_ORDER.length;
}

export type ExamScreen = 'failed' | 'waiting' | 'result';

/** Hangi ekran: düşmüş, bekleyen (notlanmamış) ya da sonuç. */
export function screenOf(view: Pick<ExamSessionView, 'status' | 'pending'>): ExamScreen {
  if (view.status === 'failed') return 'failed';
  return view.pending ? 'waiting' : 'result';
}

/** Rapor PDF'i hazır mı (görüntüleyiciye gidebilir)? */
export function reportReady(view: Pick<ExamSessionView, 'report'>): boolean {
  const r = view.report;
  return Boolean(r && r.pdf_path && (r.status === 'rendered' || r.status === 'published'));
}

/** Rapor üretiliyor mu (oturum notlandı, rapor henüz yok/üretimde)? */
export function reportPending(view: Pick<ExamSessionView, 'report' | 'status' | 'pending'>): boolean {
  if (view.pending || view.status === 'failed' || reportReady(view)) return false;
  return view.report?.status !== 'failed' && view.status !== 'done';
}

/** RPC hata kodu → tek cümle (Nereye kadar geldim / neden). */
export function howFarError(code: string | null | undefined): string {
  switch (code) {
    case 'OGR-EXAM-009':
      return 'Bu soru için bilgiyi zaten verdin.';
    case 'OGR-EXAM-003':
      return 'Deneme henüz notlanmadı; birazdan yeniden dene.';
    case 'OGR-EXAM-006':
    case 'OGR-UPL-003':
      return 'Fotoğraflar kullanılamadı. Yeniden çekip gönder.';
    case 'OGR-AUTH-001':
    case '42501':
      return 'Oturumun bu işlem için uygun değil. Yeniden giriş yap.';
    case 'OGR-EXAM-007':
      return 'Yazını ya da fotoğrafını kontrol edip yeniden gönder.';
    default:
      return 'Gönderemedim. Bağlantını kontrol edip yeniden dene.';
  }
}

export function submitExamError(code: string | null | undefined): string {
  switch (code) {
    case 'OGR-UPL-001':
      return 'Okul denemesi için 1 ile 40 sayfa gönderebilirsin.';
    case 'OGR-UPL-002':
      return 'Sayfalar bulunamadı. Yeniden seçip gönder.';
    case 'OGR-UPL-003':
      return 'Bu sayfaların bir kısmı önceki gönderiminde. Gönder’e yeniden basarsan yeni gönderim olarak alırım.';
    case 'OGR-UPL-004':
      return 'Önce bir ders seçmen gerekiyor; sonra yeniden yükleyebilirsin.';
    case 'OGR-AUTH-001':
    case '42501':
      return 'Bu yükleme için oturumun uygun değil. Yeniden giriş yap.';
    case 'PGRST202':
    case '42883':
      return 'Deneme yükleme şu an alınamıyor. Biraz sonra yeniden dene.';
    default:
      return 'Gönderilemedi. Bağlantını kontrol edip yeniden dene.';
  }
}
