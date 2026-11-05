/**
 * Veli ve bildirim hattı (P6, docs/PLAN-v2.md §10) kullanıcı turu metinleri:
 *   - rapor: report + `reportUserText` (`<report_request>` JSON: tür, başlık, dönem, ders, tarih, izinli grafikler, veri)
 *   - bildirim metni: notification_copy + `notificationCopyUserText` (`<notification>` JSON: tür, alıcı, veri, şablon)
 *
 * Veri velinin zaten görebildiği bilgidir (supabase 0043 parent_* RPC'leri): ad, ham olasılık (p), soru metni, cevap ve
 * anahtar bu metinlere girmez. Kullanıcı verisi (konu adı, velinin sorusu) veri bloğunu kapatamasın diye `<`/`>`
 * kaçışlanır. Sahte taşımanın (OGRENMEN_LLM=fake) eşleme anahtarları `REPORT_REQUEST_MARK` ve `NOTIFICATION_MARK`'tır.
 */

export const REPORT_REQUEST_MARK = '<report_request>';
export const NOTIFICATION_MARK = '<notification>';

export type ReportKind = 'weekly' | 'exam' | 'topic' | 'trend' | 'custom';

/** Rapora izin verilen grafik: hat bu adla veriyi render anında doldurur. */
export interface ReportChartRef {
  data_ref: string;
  chart_kind: string;
  /** Grafiğin neyi gösterdiği (modele yol gösterir). */
  about: string;
}

export interface ReportRequestInput {
  kind: ReportKind;
  title: string;
  /** Dönem metni (alt başlık): "2–8 Kasım 2026" gibi. */
  period: string;
  course_title: string;
  /** YYYY-MM-DD. */
  generated_on: string;
  charts: readonly ReportChartRef[];
  /** Türe göre hazırlanmış veri (veliye açık alanlar). */
  data: Record<string, unknown>;
  /** custom raporda velinin sorusu. */
  question?: string | null;
}

export interface NotificationCopyInput {
  kind: string;
  audience: 'parent' | 'student';
  data: Record<string, unknown>;
  template: { title: string; body: string };
}

function jsonBlock(v: unknown): string {
  return JSON.stringify(v, null, 1).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

/** Kullanıcı metni (soru, konu): tek satır, `<`/`>` değiştirilmiş, kısaltılmış. */
export function cleanUserText(s: string, max = 500): string {
  return s.replace(/[\r\n\t]+/g, ' ').replace(/</g, '‹').replace(/>/g, '›').replace(/\s{2,}/g, ' ').trim().slice(0, max);
}

export function reportUserText(input: ReportRequestInput): string {
  const body = {
    kind: input.kind,
    title: cleanUserText(input.title, 120),
    period: cleanUserText(input.period, 120),
    course_title: cleanUserText(input.course_title, 160),
    generated_on: input.generated_on,
    charts: input.charts,
    ...(input.question ? { question: cleanUserText(input.question, 500) } : {}),
    data: input.data,
  };
  return [
    `${REPORT_REQUEST_MARK}`,
    jsonBlock(body),
    '</report_request>',
    `Rapor türü: ${input.kind}. Grafikler yalnız charts listesindeki data_ref adlarıyla; liste boşsa grafik yok.`,
  ].join('\n');
}

export function notificationCopyUserText(input: NotificationCopyInput): string {
  return [
    NOTIFICATION_MARK,
    jsonBlock({ kind: input.kind, audience: input.audience, data: input.data, template: input.template }),
    '</notification>',
    `Bildirim türü: ${input.kind}. Alıcı: ${input.audience === 'parent' ? 'veli' : 'öğrenci'}.`,
  ].join('\n');
}
