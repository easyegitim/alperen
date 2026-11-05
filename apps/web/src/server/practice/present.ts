// Alıştırma setinin ekran metinleri (saf; test/practice.test.ts). Kurallar (PLAN-v2 §13): tek cümle sonuç,
// sayılar kelimeyle ("8 soruda 6 doğru"), yüzde yok, ünlem yok; ayrıntı Detay arkasında.
import type { FinishSummary, PlayerItem, PracticeSet } from './types';

/** İçerikte satır içi formül ters tırnakla yazılır (content/tyt-matematik); MathText dolar sınırlayıcısı bekler. */
export function toMathText(text: string): string {
  return text.replace(/`([^`\n]+)`/g, (_m, tex: string) => `$${tex}$`);
}

/**
 * Şeklin herkese açık adresi: 'figures' kovası (0015_storage.sql, public). figures.png_path içerikte 'figures/x.png'
 * biçimindedir; kova adı yolun başındaysa bir kez atılır.
 */
export function figureUrl(supabaseUrl: string, path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  const key = path.replace(/^\/+/, '').replace(/^figures\//, '');
  const enc = key.split('/').map(encodeURIComponent).join('/');
  return `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/figures/${enc}`;
}

export function playerItems(set: PracticeSet, supabaseUrl: string): PlayerItem[] {
  return [...set.items]
    .sort((a, b) => a.no - b.no)
    .map((it) => {
      const src = figureUrl(supabaseUrl, it.figure?.png_path ?? it.figure?.svg_path ?? null);
      return {
        no: it.no,
        questionId: it.question_id,
        kind: it.kind,
        stem: toMathText(it.stem),
        options: (it.options ?? []).map((o) => ({ key: o.key, text: toMathText(o.text) })),
        figure: src ? { src, alt: it.figure?.alt_text?.trim() || 'Soru şekli' } : null,
        answered: it.answered,
        correct: it.correct ?? null,
      };
    });
}

export interface ResultView {
  correct: number;
  total: number;
  /** Ekran okuyucu metni: "8 sorudan 6 doğru". */
  scoreLabel: string;
  /** Soru sırasıyla doğru mu (cevapsız: null). */
  dots: Array<boolean | null>;
  sentence: string;
  /** "Neyi öğrendik" tek satır (en sık yanılgının öğrenci metni). */
  learned: string | null;
  detail: {
    misconception: { text: string; count: number } | null;
    skills: Array<{ name: string; line: string }>;
  };
}

function lead(correct: number, answered: number): string {
  if (answered === 0) return 'Bu sette soru cevaplamadın.';
  if (correct === answered) return 'Hepsi doğru.';
  const r = correct / answered;
  if (r >= 0.75) return 'İyi gidiyorsun.';
  if (r >= 0.5) return 'Yarı yoldasın.';
  return 'Bu konu biraz daha çalışma istiyor.';
}

function stripDot(s: string): string {
  return s.trim().replace(/[.]+$/, '');
}

/** finish_practice özeti → tek cümle sonuç ekranı (S05). */
export function resultView(summary: FinishSummary, items: Array<{ no: number; answered: boolean; correct?: boolean | null }>): ResultView {
  const total = summary.total;
  const weak = summary.weak_skill ?? null;
  const top = summary.top_misconception ?? null;
  let sentence = lead(summary.correct, summary.answered);
  if (summary.answered > 0 && weak && weak.correct < weak.total) sentence += ` Takıldığın yer: ${stripDot(weak.name)}.`;
  const misText = top?.text ? stripDot(toMathText(top.text)) : null;
  return {
    correct: summary.correct,
    total,
    scoreLabel: `${total} sorudan ${summary.correct} doğru`,
    dots: [...items].sort((a, b) => a.no - b.no).map((i) => (i.answered ? Boolean(i.correct) : null)),
    sentence,
    learned: misText,
    detail: {
      misconception: misText && top ? { text: misText, count: top.count } : null,
      skills: summary.skills.map((s) => ({ name: s.name, line: `${s.total} soruda ${s.correct} doğru` })),
    },
  };
}

/** RPC hata kodu → öğrenciye tek cümle. */
export function practiceErrorMessage(code: string | null): string {
  switch (code) {
    case 'OGR-PRAC-001':
      return 'Bu test bulunamadı.';
    case 'OGR-PRAC-002':
      return 'Bu öneri bir test değil.';
    case 'OGR-PRAC-003':
      return 'Bu test bitti; sonucu açıyorum.';
    case 'OGR-PRAC-005':
      return 'Önce bir cevap seç.';
    case 'OGR-PRAC-006':
      return 'Planın kuruluyor; birkaç saniye sonra yeniden dene.';
    case 'OGR-PRAC-008':
      return "Planın eğitmen onayında; onaylanınca ilk testin Bugün'de açılır.";
    case 'OGR-PRAC-007':
      return 'Bugünlük alıştırma sınırına ulaştın; yarın yeni test açılır.';
    case 'OGR-SUG-001':
      return 'Bu öneri artık yok. Bugün ekranı yenilendi.';
    case 'OGR-SUG-002':
      return 'Bu önerinin süresi doldu. Koçun yenisini hazırlıyor.';
    case 'OGR-AUTH-001':
    case '42501':
      return 'Oturumun bu işlem için uygun değil. Yeniden giriş yap.';
    default:
      return 'Kaydedemedim. Bağlantını kontrol edip yeniden dene.';
  }
}
