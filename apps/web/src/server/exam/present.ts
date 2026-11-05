// Sınav ekranının veri eşlemesi ve metinleri (saf; test/exam-*.test.ts). Soru satırı v_exam_questions_student görünümünden
// gelir: doğru cevap ve yanılgı etiketi içermez; telifli sınavda soru ve şık metni yoktur (kitapçık kırpımı gösterilir).
import { toMathText } from '@/server/practice/present';
import type { ExamCrop, ExamItem, ExamOption } from './types';

export interface QuestionRow {
  id: string;
  no: number;
  section: string | null;
  kind: 'mcq' | 'numeric' | 'open';
  stem_text: string | null;
  options: unknown;
  is_copyrighted: boolean;
  figure_upload_id: string | null;
  page_upload_id: string | null;
  bbox: unknown;
}

export interface UploadRef {
  id: string;
  storage_path: string;
  width: number | null;
  height: number | null;
}

/** Kutuları {x,y,w,h} (0..1 oranlı) olarak doğrular; geçersizse null. */
export function parseBbox(raw: unknown): ExamCrop['bbox'] | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  const [x, y, w, h] = [b.x, b.y, b.w, b.h];
  if (![x, y, w, h].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const [bx, by, bw, bh] = [x, y, w, h] as number[];
  if (bw! <= 0 || bh! <= 0 || bx! < 0 || by! < 0 || bx! + bw! > 1.0001 || by! + bh! > 1.0001) return null;
  return { x: bx!, y: by!, w: bw!, h: bh! };
}

function optionsOf(raw: unknown, copyrighted: boolean): ExamOption[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((o): ExamOption[] => {
    if (!o || typeof o !== 'object') return [];
    const r = o as { key?: unknown; text?: unknown };
    if (typeof r.key !== 'string' || r.key === '') return [];
    return [{ key: r.key.toUpperCase(), text: copyrighted || typeof r.text !== 'string' ? null : toMathText(r.text) }];
  });
}

/** Görünüm satırları + imzalı adresler → oynatıcı soruları (no sırasıyla). `urls` yükleme kimliğinden adrese. */
export function examItems(rows: QuestionRow[], urls: Map<string, string>, uploads: Map<string, UploadRef>): ExamItem[] {
  return [...rows]
    .sort((a, b) => a.no - b.no)
    .map((r) => {
      const figureSrc = r.figure_upload_id ? (urls.get(r.figure_upload_id) ?? null) : null;
      const bbox = parseBbox(r.bbox);
      const pageSrc = r.page_upload_id ? (urls.get(r.page_upload_id) ?? null) : null;
      const page = r.page_upload_id ? uploads.get(r.page_upload_id) : undefined;
      const aspect = page?.width && page?.height ? page.width / page.height : 0.707;
      const hasText = !r.is_copyrighted && r.stem_text != null && r.stem_text.trim() !== '';
      return {
        no: r.no,
        questionId: r.id,
        section: r.section,
        kind: r.kind,
        stem: hasText ? toMathText(r.stem_text!) : null,
        options: optionsOf(r.options, r.is_copyrighted),
        figure: figureSrc ? { src: figureSrc, alt: 'Soru şekli' } : null,
        crop: !hasText && pageSrc && bbox ? { src: pageSrc, bbox, pageAspect: aspect } : null,
      };
    });
}

/** Kırpım kutusunun CSS yerleşimi (yüzde): kapsayıcı oranı ve sayfa görselinin boyut/konumu. */
export function cropLayout(c: ExamCrop): { aspectRatio: number; widthPct: number; leftPct: number; topPct: number } {
  const { x, y, w, h } = c.bbox;
  return { aspectRatio: (w * c.pageAspect) / h, widthPct: 100 / w, leftPct: -(x / w) * 100, topPct: -(y / h) * 100 };
}

/** "75 dk" ya da "1 sa 15 dk"; süresizde null. */
export function durationLabel(min: number | null | undefined): string | null {
  if (!min || min <= 0) return null;
  if (min < 60) return `${min} dk`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} sa` : `${h} sa ${m} dk`;
}

/** Giriş ekranı alt satırı: "40 soru · 75 dk". */
export function introLine(questionCount: number, durationMin: number | null | undefined): string {
  const parts = [`${questionCount} soru`];
  const d = durationLabel(durationMin);
  if (d) parts.push(d);
  return parts.join(' · ');
}
