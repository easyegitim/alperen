// Belge ekranları: sohbet durum kartı (Hazırlıyorum → Aç), Koç'ta document olayı, Belgelerim durum kelimeleri,
// eğitmen inceleme kuyruğu (özet kelimeyle, Onayla / Reddet), belge ekranında "Çöz".
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh }), usePathname: () => '/ogrenci/koc' }));
vi.mock('@/ds', async (orig) => {
  const actual = await orig<typeof import('@/ds')>();
  return { ...actual, PdfViewer: ({ title }: { title: string }) => <article aria-label={`PDF ${title}`} /> };
});
vi.mock('@/lib/live', async () => {
  const actual = await vi.importActual<typeof import('@/lib/live')>('@/lib/live');
  // Gerçek yoklama yerine ilk bakışı hemen yap (Realtime/zamanlayıcı gerekmesin).
  const React = await import('react');
  return {
    ...actual,
    useLive: (o: { key: string; check: () => Promise<boolean | void> | boolean | void; enabled?: boolean }) => {
      React.useEffect(() => {
        if (o.enabled === false) return;
        void o.check();
      }, [o.enabled, o.key]); // eslint-disable-line react-hooks/exhaustive-deps
      return null;
    },
  };
});

import { CoachChat } from '@/components/chat/CoachChat';
import { RequestCard } from '@/components/documents/RequestCard';
import { LibraryList } from '@/components/documents/Library';
import { ReviewQueue } from '@/components/documents/ReviewQueue';
import { DocumentScreen } from '@/components/pdf';
import type { ChatBootstrap, DocRef } from '@/lib/chat';
import type { ReviewItem } from '@/server/documents/review';
import { verificationLines } from '@/server/documents/review-present';

const DOC: DocRef = { requestId: '11111111-2222-4333-8444-555555555555', kind: 'notes', title: 'Rasyonel sayılar' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

describe('RequestCard (sohbet durum kartı)', () => {
  it('hazırlanırken tek satır; hazır olunca "Notun hazır" ve Aç', async () => {
    let phase = 'working';
    const f = vi.fn(async () => json({ phase, documentId: phase === 'ready' ? 'doc-1' : null })) as unknown as typeof fetch;
    const { rerender } = render(<RequestCard doc={DOC} fetchImpl={f} />);
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(screen.getByTestId('belge-istek')).toHaveTextContent('Hazırlıyorum… Bugün’de görürsün');
    expect(screen.queryByRole('link', { name: /aç$/i })).toBeNull();
    phase = 'ready';
    rerender(<RequestCard doc={{ ...DOC, requestId: DOC.requestId.replace('1111', '2222') }} fetchImpl={f} />);
    await waitFor(() => expect(screen.getByRole('link', { name: /aç$/i })).toHaveAttribute('href', '/ogrenci/belge/doc-1'));
    expect(screen.getByTestId('belge-istek')).toHaveTextContent('Notun hazır');
  });

  it('hata: tek satır, bağlantı yok', async () => {
    const f = vi.fn(async () => json({ phase: 'failed', documentId: null })) as unknown as typeof fetch;
    render(<RequestCard doc={DOC} fetchImpl={f} />);
    await waitFor(() => expect(screen.getByTestId('belge-istek')).toHaveAttribute('data-phase', 'failed'));
    expect(screen.getByTestId('belge-istek')).toHaveTextContent(/Hazırlayamadım/);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('inceleme: Hocan inceliyor', async () => {
    const f = vi.fn(async () => json({ phase: 'review', documentId: null })) as unknown as typeof fetch;
    render(<RequestCard doc={DOC} fetchImpl={f} />);
    await waitFor(() => expect(screen.getByTestId('belge-istek')).toHaveTextContent(/Hocan inceliyor/));
  });
});

describe('Koç ekranı: document olayı', () => {
  it('akıştaki document olayı yanıtla birlikte kalıcı kart olur', async () => {
    const enc = new TextEncoder();
    const ev = (event: string, data: unknown) => enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).startsWith('/ogrenci/koc/belge-durum')) return json({ phase: 'working', documentId: null });
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(ev('start', { conversationId: 'c1', userMessageId: 1, mode: 'hint' }));
          c.enqueue(ev('document', DOC));
          c.enqueue(ev('done', { messageId: 2, text: 'Tamam, hazırlıyorum.', refusal: false, escalated: false, modeSuggestion: null }));
          c.close();
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }) as unknown as typeof fetch;
    const initial: ChatBootstrap = { available: true, conversationId: null, mode: 'hint', messages: [], seed: null, pending: false };
    render(<CoachChat initial={initial} fetchImpl={fetchImpl} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Koça yaz'), 'rasyonel sayılar notu istiyorum');
    await user.click(screen.getByRole('button', { name: 'Gönder' }));
    expect(await screen.findByText('Tamam, hazırlıyorum.')).toBeInTheDocument();
    expect(await screen.findByTestId('belge-istek')).toHaveTextContent('Hazırlıyorum… Bugün’de görürsün');
    expect(screen.getAllByTestId('belge-istek')).toHaveLength(1);
  });

  it('document sonrası akış hata ile biterse kart sohbette kalır (tur kaydedilmese de)', async () => {
    const enc = new TextEncoder();
    const ev = (event: string, data: unknown) => enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).startsWith('/ogrenci/koc/belge-durum')) return json({ phase: 'working', documentId: null });
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(ev('start', { conversationId: 'c1', userMessageId: 1, mode: 'hint' }));
          c.enqueue(ev('document', DOC));
          c.enqueue(ev('error', { code: 'llm_error', message: 'Koç şu an yanıt veremedi. Biraz sonra yeniden dene.' }));
          c.close();
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }) as unknown as typeof fetch;
    const initial: ChatBootstrap = { available: true, conversationId: null, mode: 'hint', messages: [], seed: null, pending: false };
    render(<CoachChat initial={initial} fetchImpl={fetchImpl} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Koça yaz'), 'rasyonel sayılar notu istiyorum');
    await user.click(screen.getByRole('button', { name: 'Gönder' }));
    expect(await screen.findByText(/Belgeni açtım/)).toBeInTheDocument();
    expect(screen.getAllByTestId('belge-istek')).toHaveLength(1);
  });

  it('geçmişte kayıtlı kart yeniden yüklemede de görünür', async () => {
    const f = vi.fn(async () => json({ phase: 'ready', documentId: 'doc-9' })) as unknown as typeof fetch;
    const initial: ChatBootstrap = {
      available: true,
      conversationId: 'c1',
      mode: 'hint',
      pending: false,
      seed: null,
      messages: [{ id: 'm2', from: 'tutor', text: 'Hazırlıyorum.', attachments: [], escalated: false, seeded: false, documents: [DOC] }],
    };
    render(<CoachChat initial={initial} fetchImpl={f} />);
    expect(await screen.findByRole('link', { name: /aç$/i })).toHaveAttribute('href', '/ogrenci/belge/doc-9');
  });
});

describe('Belgelerim', () => {
  it('durum kelimeleri; yalnız hazır satır bağlantıdır; çip/filtre yok', () => {
    render(
      <LibraryList
        rows={[
          { id: 'a', title: 'Rasyonel sayılar', kind: 'notes', created_at: '2026-11-03T10:00:00Z', word: 'Hazır', open: true },
          { id: 'b', title: 'Üslü sayılar', kind: 'notes', created_at: '2026-11-03T10:00:00Z', word: 'Hazırlanıyor', open: false },
          { id: 'c', title: 'Denemen', kind: 'mock_exam', created_at: '2026-11-03T10:00:00Z', word: 'İncelemede', open: false },
        ]}
      />,
    );
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/ogrenci/belge/a');
    expect(screen.getByText('Hazırlanıyor')).toBeInTheDocument();
    expect(screen.getByText('İncelemede')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
  });
});

describe('Belge ekranı: Çöz', () => {
  it('denemede ikinci eylem "Çöz" sınav girişine gider; notta yok', () => {
    const { rerender } = render(<DocumentScreen doc={{ id: 'd', title: 'Deneme', src: 'https://x/a.pdf', examId: 'ex-1' }} closeHref="/ogrenci" backLabel="Bugün" />);
    expect(screen.getByRole('link', { name: 'Çöz' })).toHaveAttribute('href', '/ogrenci/sinav/ex-1');
    rerender(<DocumentScreen doc={{ id: 'd', title: 'Not', src: 'https://x/a.pdf', examId: null }} closeHref="/ogrenci" backLabel="Bugün" />);
    expect(screen.queryByRole('link', { name: 'Çöz' })).toBeNull();
  });
});

describe('Eğitmen inceleme kuyruğu', () => {
  const item = (id: string, over: Partial<ReviewItem> = {}): ReviewItem => {
    const v = verificationLines({ schema: { status: 'pass' }, sympy: { status: 'pass' }, figures: { status: 'pass' }, duplicates: { status: 'skipped' }, personalization: { status: 'pass' } });
    return { id, title: `Belge ${id}`, kind: 'notes', scope: 'personal', courseTitle: null, createdAt: '2026-11-03T10:00:00Z', src: 'https://x/a.pdf', steps: v.steps, regenerated: 0, warning: null, ...over };
  };

  it('özet kelimeyle, PDF önizleme, Onayla not ile karar çağırır ve listeyi yeniler', async () => {
    const decide = vi.fn(async () => ({ ok: true, message: 'Onaylandı; öğrenciye gönderildi.' }));
    render(<ReviewQueue items={[item('1'), item('2')]} decide={decide} />);
    expect(screen.getByTestId('dogrulama')).toHaveTextContent('Çözümler (SymPy): geçti');
    expect(screen.getByTestId('dogrulama')).toHaveTextContent('Tekrarlar: atlandı');
    expect(screen.getByLabelText('PDF Belge 1')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Belge 2/ }));
    expect(screen.getByRole('heading', { name: 'Belge 2' })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Not/), 'Şekil net');
    await user.click(screen.getByRole('button', { name: 'Onayla' }));
    await waitFor(() => expect(decide).toHaveBeenCalledWith('2', 'approve', 'Şekil net'));
    expect(await screen.findByRole('status')).toHaveTextContent('Onaylandı');
    expect(refresh).toHaveBeenCalled();
  });

  it('not belgeye aittir: başka belgeye geçince boşalır, karar A’nın notunu taşımaz', async () => {
    const decide = vi.fn(async () => ({ ok: true, message: 'Onaylandı; öğrenciye gönderildi.' }));
    render(<ReviewQueue items={[item('1'), item('2')]} decide={decide} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Not/), 'Belge 1 için not');
    await user.click(screen.getByRole('button', { name: /Belge 2/ }));
    expect(screen.getByLabelText(/Not/)).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Onayla' }));
    await waitFor(() => expect(decide).toHaveBeenCalledWith('2', 'approve', ''));
  });

  it('kalan basamak uyarısı görünür; Reddet reject gönderir; hata iletisi kalır', async () => {
    const failed = verificationLines({ figures: { status: 'fail' } });
    const decide = vi.fn(async () => ({ ok: false, message: 'Bu belge artık incelemede değil.' }));
    render(<ReviewQueue items={[item('1', { steps: failed.steps, warning: 'Kontrolden geçmeyen: Şekiller' })]} decide={decide} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Şekiller');
    fireEvent.click(screen.getByRole('button', { name: 'Reddet' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reddi onayla' }));
    await act(async () => undefined);
    await waitFor(() => expect(decide).toHaveBeenCalledWith('1', 'reject', ''));
    expect(await screen.findByText('Bu belge artık incelemede değil.')).toBeInTheDocument();
  });
});

describe('Belge kartı erişilebilirlik', () => {
  it('hazır kartın bağlantısı belge adını taşır (aynı sohbette birden çok kart)', async () => {
    const fetchImpl = vi.fn(async () => json({ phase: 'ready', documentId: 'd1' }));
    render(<RequestCard doc={DOC} fetchImpl={fetchImpl as unknown as typeof fetch} />);
    expect(await screen.findByRole('link', { name: 'Rasyonel sayılar aç' })).toHaveAttribute('href', '/ogrenci/belge/d1');
  });
});
