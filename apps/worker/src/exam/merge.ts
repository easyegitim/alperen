/**
 * Kitapçık sayfalarının OCR çıktısını tek soru listesine çevirir (docs/PLAN-v2.md §8 "devam eden soruları birleştirme").
 *
 *   - Sayfa sırası: bütün kitapçık sayfalarında basılı sayfa numarası varsa ve tekilse ona göre, yoksa yükleme sırası.
 *   - Devam: `continues_from_previous` maddesi bir önceki sorunun (aynı numara ya da `continues_on_next`) devamıdır: kök
 *     metinleri birleşir, şıklar dolu olan parçadan, şekiller ve sayfalar birikir, okunaklılık en kötüsü.
 *   - Aynı numara iki kez (devam değil): içeriği zengin olan kalır, uyarı yazılır.
 *   - Sonda hâlâ devam bekleyen ya da şıkkı eksik soru ve numara boşlukları uyarıdır (soru yine yazılır).
 */
import type { ExamPageItems } from '@ogrenmen/contracts';

export type PageItem = ExamPageItems['items'][number];

export interface BookletPage {
  uploadId: string;
  /** 1'den başlayan yükleme sırası. */
  order: number;
  printedPage: number | null;
  sectionHint: string | null;
  items: readonly PageItem[];
}

export interface MergedFigure {
  uploadId: string;
  bbox: { x: number; y: number; w: number; h: number };
  description: string;
}

export interface MergedQuestion {
  no: number;
  section: string | null;
  kind: PageItem['kind'];
  stem_text: string;
  options: { key: string; text: string }[];
  figures: MergedFigure[];
  /** Sorunun başladığı kitapçık sayfası. */
  pageUploadId: string;
  pageUploadIds: string[];
  legibility: PageItem['legibility'];
  /** Model kazanım kodu verdiyse (sözleşme alanı eklendiğinde; şimdilik boş). */
  skillIds: string[];
  /** Sorunun başladığı sayfadaki kırpım kutusu (sözleşme alanı eklendiğinde; şimdilik null). */
  bbox: { x: number; y: number; w: number; h: number } | null;
}

export interface MergeResult {
  questions: MergedQuestion[];
  warnings: string[];
}

const LEGIBILITY_RANK: Record<PageItem['legibility'], number> = { clear: 0, partial: 1, poor: 2 };

function worst(a: PageItem['legibility'], b: PageItem['legibility']): PageItem['legibility'] {
  return LEGIBILITY_RANK[a] >= LEGIBILITY_RANK[b] ? a : b;
}

/** Kitapçık sayfalarının okunma sırası. */
export function orderBookletPages<T extends Pick<BookletPage, 'order' | 'printedPage'>>(pages: readonly T[]): T[] {
  const printed = pages.map((p) => p.printedPage);
  const usable = printed.every((n) => n !== null) && new Set(printed).size === printed.length;
  return [...pages].sort((a, b) => (usable ? a.printedPage! - b.printedPage! : 0) || a.order - b.order);
}

function richness(q: Pick<MergedQuestion, 'stem_text' | 'options' | 'figures'>): number {
  return q.stem_text.trim().length + 50 * q.options.length + 20 * q.figures.length;
}

function joinStem(a: string, b: string): string {
  const x = a.trim();
  const y = b.trim();
  if (!x) return y;
  if (!y) return x;
  return `${x} ${y}`;
}

function itemBox(it: PageItem): MergedQuestion['bbox'] {
  const b = (it as { bbox?: unknown }).bbox as Record<string, unknown> | null | undefined;
  if (!b || typeof b !== 'object') return null;
  const [x, y, w, h] = [b.x, b.y, b.w, b.h].map(Number) as [number, number, number, number];
  return [x, y, w, h].every(Number.isFinite) && x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1.001 && y + h <= 1.001 ? { x, y, w, h } : null;
}

function itemSkills(it: PageItem): string[] {
  const raw = (it as { skill_ids?: unknown }).skill_ids;
  return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string') : [];
}

export function mergeBookletPages(pages: readonly BookletPage[]): MergeResult {
  const warnings: string[] = [];
  const byNo = new Map<number, MergedQuestion & { open: boolean }>();
  let last: (MergedQuestion & { open: boolean }) | null = null;

  for (const page of orderBookletPages(pages)) {
    for (const it of page.items) {
      const figures = it.figures.map((f) => ({ uploadId: page.uploadId, bbox: f.bbox, description: f.description }));
      if (it.continues_from_previous && last && (last.no === it.no || last.open)) {
        if (last.no !== it.no) warnings.push(`soru ${last.no} devamı ${it.no} numarasıyla okundu`);
        last.stem_text = joinStem(last.stem_text, it.stem_text);
        if (last.options.length < 2 && it.options.length > 0) last.options = it.options.map((o) => ({ ...o }));
        last.figures.push(...figures);
        if (!last.pageUploadIds.includes(page.uploadId)) last.pageUploadIds.push(page.uploadId);
        last.legibility = worst(last.legibility, it.legibility);
        last.section ??= it.section ?? page.sectionHint;
        for (const s of itemSkills(it)) if (!last.skillIds.includes(s)) last.skillIds.push(s);
        last.open = it.continues_on_next;
        continue;
      }
      if (it.continues_from_previous) warnings.push(`soru ${it.no} önceki sayfadan devam ediyor ama başı bulunamadı`);
      const q: MergedQuestion & { open: boolean } = {
        no: it.no,
        section: it.section ?? page.sectionHint,
        kind: it.kind,
        stem_text: it.stem_text,
        options: it.options.map((o) => ({ ...o })),
        figures,
        pageUploadId: page.uploadId,
        pageUploadIds: [page.uploadId],
        legibility: it.legibility,
        skillIds: itemSkills(it),
        bbox: itemBox(it),
        open: it.continues_on_next,
      };
      const prev = byNo.get(it.no);
      if (prev) {
        warnings.push(`soru ${it.no} iki kez okundu`);
        if (richness(q) <= richness(prev)) continue;
      }
      byNo.set(it.no, q);
      last = q;
    }
  }

  const questions = [...byNo.values()]
    .sort((a, b) => a.no - b.no)
    .map(({ open, ...q }) => {
      if (open) warnings.push(`soru ${q.no} sonraki sayfada sürüyor ama devamı yok`);
      if (q.kind === 'mcq' && q.options.length < 2) warnings.push(`soru ${q.no} şıkları eksik`);
      return q;
    });
  if (questions.length > 0) {
    const max = questions[questions.length - 1]!.no;
    const have = new Set(questions.map((q) => q.no));
    const missing: number[] = [];
    for (let n = 1; n <= max; n++) if (!have.has(n)) missing.push(n);
    if (missing.length > 0) warnings.push(`eksik soru numaraları: ${missing.slice(0, 20).join(', ')}`);
  }
  return { questions, warnings };
}
