// Belgelerim / belge görüntüleyici saf yardımcıları (test/documents.test.ts).
import type { MyDocument } from './types';

export const documentHref = (id: string): string => `/ogrenci/belge/${id}`;
export const guardianDocumentHref = (id: string): string => `/veli/rapor/${id}`;

/** PDF'i hazır, görüntülenebilir belge. */
export function isViewable(d: Pick<MyDocument, 'status' | 'pdf_path'>): boolean {
  return Boolean(d.pdf_path) && (d.status === 'rendered' || d.status === 'published');
}

/** Belgelerim satırları için: PDF'i hazır olanlar, en yeni önce (RPC sırası). */
export function viewableDocuments(docs: MyDocument[]): Array<Pick<MyDocument, 'id' | 'title' | 'kind' | 'created_at'>> {
  return docs.filter(isViewable).map((d) => ({ id: d.id, title: d.title, kind: d.kind, created_at: d.created_at }));
}

/** Veli Özet'in son rapor kartı: çocuğun en yeni hazır raporu (liste en yeni önce gelir). */
export function latestReport(docs: MyDocument[], studentId?: string): MyDocument | null {
  return docs.find((d) => d.kind === 'report' && isViewable(d) && (!studentId || d.student_id === studentId)) ?? null;
}

/** İndirilen dosyanın adı: "Deneme-4-Rapor.pdf" (Türkçe harfler sadeleşir, boşluk tire olur). */
export function downloadName(title: string): string {
  const map: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'C', Ğ: 'G', İ: 'I', Ö: 'O', Ş: 'S', Ü: 'U' };
  const base = title
    .replace(/[çğıöşüÇĞİÖŞÜ]/g, (c) => map[c] ?? c)
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'belge'}.pdf`;
}
