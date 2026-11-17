// Belgeler (P2-D): list_my_documents ayrıştırma ve süzme, görüntüleyici (sayfa ‹ ›, İndir / Paylaş), Web Share yolu.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// pdf.js jsdom'da çalışmaz: PdfViewer'ı tuvalleri çizen sade bir taklitle değiştir (3 sayfa).
vi.mock('@/ds', async (orig) => {
  const actual = await orig<typeof import('@/ds')>();
  return {
    ...actual,
    PdfViewer: ({ title, onShare }: { title: string; onShare?: () => void }) => (
      <article>
        <h1>{title}</h1>
        <button type="button" onClick={onShare}>
          İndir / Paylaş
        </button>
        {[1, 2, 3].map((n) => (
          <canvas key={n} role="img" aria-label={`sayfa ${n}`} />
        ))}
      </article>
    ),
  };
});

import { DocumentViewer, shareOrDownload } from '@/components/pdf';
import { downloadName, guardianDocumentHref, documentHref, isViewable, latestReport, viewableDocuments } from '@/server/documents/present';
import { listMyDocuments } from '@/server/documents/rpc';
import { parseDocumentList } from '@/server/documents/types';
import type { RpcClient } from '@/server/practice/rpc';

const doc = (over: Record<string, unknown>) => ({ id: 'd', kind: 'report', title: 'Deneme 4', status: 'rendered', pdf_path: 'a.pdf', student_id: 's1', created_at: '2026-11-03T10:00:00Z', ...over });

describe('belge listesi', () => {
  it('list_my_documents yanıtı ayrıştırılır; cevap anahtarı türü şemada var ama listede hiç görünmez', () => {
    const docs = parseDocumentList({ documents: [doc({ id: 'a' }), doc({ id: 'b', kind: 'notes', title: 'Rasyonel sayılar', status: 'published', exam_session_id: null })], count: 2 });
    expect(docs.map((d) => d.id)).toEqual(['a', 'b']);
    expect(parseDocumentList({})).toEqual([]);
    expect(() => parseDocumentList({ documents: [{ id: 'x' }] })).toThrow();
  });

  it('yalnız PDF\'i hazır belgeler listelenir; adresler', () => {
    const docs = parseDocumentList({ documents: [doc({ id: 'a' }), doc({ id: 'b', status: 'generating', pdf_path: null }), doc({ id: 'c', pdf_path: null }), doc({ id: 'd', status: 'published', kind: 'notes' })] });
    expect(viewableDocuments(docs).map((d) => d.id)).toEqual(['a', 'd']);
    expect(isViewable(docs[1]!)).toBe(false);
    expect(documentHref('x')).toBe('/ogrenci/belge/x');
    expect(guardianDocumentHref('x')).toBe('/veli/rapor/x');
  });

  it('veli son rapor: çocuğun en yeni hazır raporu; başka çocuğun ya da not belgesi sayılmaz', () => {
    const docs = parseDocumentList({
      documents: [
        doc({ id: 'n', kind: 'notes', student_id: 's1' }),
        doc({ id: 'o', student_id: 's2' }),
        doc({ id: 'p', student_id: 's1', status: 'generating', pdf_path: null }),
        doc({ id: 'r1', student_id: 's1' }),
        doc({ id: 'r0', student_id: 's1' }),
      ],
    });
    expect(latestReport(docs, 's1')?.id).toBe('r1');
    expect(latestReport(docs, 's3')).toBeNull();
    expect(latestReport([], 's1')).toBeNull();
  });

  it('RPC argümanları', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { documents: [] }, error: null });
    const r = await listMyDocuments({ rpc } as unknown as RpcClient, { kind: 'report', studentId: 's1', limit: 5 });
    expect(rpc).toHaveBeenCalledWith('list_my_documents', { p_kind: 'report', p_student: 's1', p_limit: 5 });
    expect(r).toMatchObject({ ok: true, data: [] });
    await listMyDocuments({ rpc } as unknown as RpcClient);
    expect(rpc).toHaveBeenLastCalledWith('list_my_documents', { p_kind: null, p_student: null, p_limit: 50 });
  });

  it('indirilen dosya adı sadeleşir', () => {
    expect(downloadName('Deneme 4 · Rapor')).toBe('Deneme-4-Rapor.pdf');
    expect(downloadName('Çözümlü şıklar: öğrenci')).toBe('Cozumlu-siklar-ogrenci.pdf');
    expect(downloadName('···')).toBe('belge.pdf');
  });
});

describe('İndir / Paylaş', () => {
  it('Web Share dosya paylaşımını destekliyorsa dosyayı paylaşır', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['%PDF'], { type: 'application/pdf' }) });
    vi.stubGlobal('fetch', fetchMock);
    const share = vi.fn().mockResolvedValue(undefined);
    const out = await shareOrDownload('https://x/y.pdf', 'Deneme 4', { share, canShare: () => true } as unknown as Navigator);
    expect(out).toBe('shared');
    expect(share.mock.calls[0]![0].files[0].name).toBe('Deneme-4.pdf');
    vi.unstubAllGlobals();
  });

  it('dosya paylaşımı yoksa adresi paylaşır; kullanıcı vazgeçerse sessizce biter', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['%PDF']) }));
    const share = vi.fn().mockResolvedValue(undefined);
    expect(await shareOrDownload('https://x/y.pdf', 'T', { share, canShare: () => false } as unknown as Navigator)).toBe('shared');
    expect(share).toHaveBeenLastCalledWith({ title: 'T', url: 'https://x/y.pdf' });
    const abort = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'AbortError' }));
    expect(await shareOrDownload('https://x/y.pdf', 'T', { share: abort, canShare: () => false } as unknown as Navigator)).toBe('cancelled');
    vi.unstubAllGlobals();
  });

  it('Web Share yoksa dosyayı indirir', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    expect(await shareOrDownload('https://x/y.pdf', 'Deneme 4', {} as Navigator)).toBe('downloaded');
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });
});

describe('DocumentViewer', () => {
  it('sayfa ‹ › çubuğu: sayfa sayısı tuvallerden okunur; sınırlarda düğme kapanır', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(<DocumentViewer src="https://x/y.pdf" title="Deneme raporu" />);
    expect(await screen.findByTestId('sayfa-no')).toHaveTextContent('Sayfa 1 / 3');
    expect(screen.getByRole('button', { name: 'Önceki sayfa' })).toBeDisabled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sonraki sayfa' }));
    });
    expect(screen.getByTestId('sayfa-no')).toHaveTextContent('Sayfa 2 / 3');
    expect(scroll).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sonraki sayfa' }));
    });
    expect(screen.getByRole('button', { name: 'Sonraki sayfa' })).toBeDisabled();
    expect(screen.getAllByRole('button', { name: /İndir \/ Paylaş/ })).toHaveLength(1);
  });
});
