// Koç ekranı (mockup S03): karşılama, akışlı yanıt + yazıyor göstergesi, KaTeX, mod seçici, + ekle menüsü,
// mikrofonun gizli olması, hata ve teşhis bağlamı.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const replace = vi.fn();
const refresh = vi.fn();
const router = { replace, push: vi.fn(), refresh };
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/ogrenci/koc' }));

import { CoachChat } from '@/components/chat/CoachChat';
import { CHAT_COPY, type ChatBootstrap } from '@/lib/chat';

const base: ChatBootstrap = { available: true, conversationId: null, mode: 'hint', messages: [], seed: null, pending: false };

function sse(events: { event: string; data: unknown }[], opts: { hold?: Promise<void> } = {}) {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(c) {
      const [first, ...rest] = events;
      if (first) c.enqueue(enc.encode(`event: ${first.event}\ndata: ${JSON.stringify(first.data)}\n\n`));
      if (opts.hold) await opts.hold;
      for (const e of rest) c.enqueue(enc.encode(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
}

describe('CoachChat', () => {
  it('boşken karşılama, AI öğretmen etiketi; mikrofon yok; + menüsünde kamera ve dosya', async () => {
    render(<CoachChat initial={base} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Koç' })).toBeInTheDocument();
    expect(screen.getAllByText('AI öğretmen').length).toBeGreaterThan(0);
    expect(screen.getByText(/Ben senin AI koçunum/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sesle/i })).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Fotoğraf veya dosya ekle' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Fotoğraf çek' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Dosya seç' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gönder' })).toBeDisabled();
  });

  it('gönder → yazıyor → akışlı metin → son yanıt KaTeX ile; gövdede mod ve sohbet kimliği', async () => {
    let release: () => void = () => undefined;
    const hold = new Promise<void>((r) => {
      release = r;
    });
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      sse(
        [
          { event: 'start', data: { conversationId: 'c1', userMessageId: 1, mode: 'explain' } },
          { event: 'text', data: { text: 'Önce ' } },
          { event: 'done', data: { messageId: 9, text: 'Önce $x=2$ yaz.', refusal: false, escalated: false, modeSuggestion: 'solve' } },
        ],
        { hold },
      ),
    );
    render(<CoachChat initial={base} fetchImpl={fetchImpl as unknown as typeof fetch} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: 'Açıkla' }));
    await user.type(screen.getByLabelText('Koça yaz'), 'Denklemi nasıl çözerim?');
    await user.keyboard('{Enter}');
    expect(await screen.findByText('Denklemi nasıl çözerim?')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Öğretmen yazıyor')).toBeInTheDocument());
    const sent = JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body));
    expect(sent).toEqual({ conversation_id: null, text: 'Denklemi nasıl çözerim?', upload_ids: [], mode: 'explain', seed: null });
    await act(async () => release());
    const log = screen.getByRole('log');
    await waitFor(() => expect(log.querySelector('.katex')).not.toBeNull());
    expect(screen.getByRole('button', { name: CHAT_COPY.modeSuggestion('solve') })).toBeInTheDocument();
    // Öneri yalnız öneridir: öğrenci dokununca mod değişir.
    await user.click(screen.getByRole('button', { name: CHAT_COPY.modeSuggestion('solve') }));
    expect(screen.getByRole('radio', { name: 'Çözümü göster' })).toHaveAttribute('aria-checked', 'true');
    expect((screen.getByLabelText('Koça yaz') as HTMLTextAreaElement).value).toBe('');
  });

  it('tur başlamadan hata: mesaj geri gelir, sade hata satırı', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ error: { code: 'text_too_long', message: 'Mesaj çok uzun. Daha kısa yazmayı dene.' } }, { status: 400 }));
    render(<CoachChat initial={base} fetchImpl={fetchImpl as unknown as typeof fetch} />);
    const box = screen.getByLabelText('Koça yaz');
    fireEvent.change(box, { target: { value: 'uzun' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gönder' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mesaj çok uzun');
    expect((box as HTMLTextAreaElement).value).toBe('uzun');
    expect(screen.queryByText('uzun', { selector: 'p *' })).toBeNull();
  });

  it('ret yanıtı: hocana iletildi notu', async () => {
    const fetchImpl = vi.fn(async () =>
      sse([
        { event: 'start', data: { conversationId: 'c1', userMessageId: 1, mode: 'hint' } },
        { event: 'done', data: { messageId: 2, text: 'Bu isteğe burada yardımcı olamıyorum.', refusal: true, escalated: true, modeSuggestion: null } },
      ]),
    );
    render(<CoachChat initial={base} fetchImpl={fetchImpl as unknown as typeof fetch} />);
    fireEvent.change(screen.getByLabelText('Koça yaz'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gönder' }));
    expect(await screen.findByText(CHAT_COPY.escalated)).toBeInTheDocument();
  });

  it('Koça sor: metin hazır, teşhis şeridi; gönderimde seed gider ve adres temizlenir', async () => {
    const fetchImpl = vi.fn(async () =>
      sse([
        { event: 'start', data: { conversationId: 'c1', userMessageId: 1, mode: 'hint' } },
        { event: 'done', data: { messageId: 2, text: 'Üçüncü satıra bak.', refusal: false, escalated: false, modeSuggestion: null } },
      ]),
    );
    render(
      <CoachChat
        initial={{ ...base, seed: { id: '7e5d0000-0000-4000-8000-0000000000a1', summary: 'Parantezi açarken işaret.', attachments: [] } }}
        fetchImpl={fetchImpl as unknown as typeof fetch}
      />,
    );
    expect((screen.getByLabelText('Koça yaz') as HTMLTextAreaElement).value).toBe(CHAT_COPY.seedPrompt);
    expect(screen.getByText('Parantezi açarken işaret.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Gönder' }));
    await screen.findByText('Üçüncü satıra bak.');
    const calls = fetchImpl.mock.calls as unknown as [string, RequestInit][];
    expect(JSON.parse(String(calls[0]![1].body)).seed).toBe('7e5d0000-0000-4000-8000-0000000000a1');
    expect(replace).toHaveBeenCalledWith('/ogrenci/koc');
  });

  it('mevcut geçmiş çizilir; öğrenci balonu ve koç balonu', () => {
    render(
      <CoachChat
        initial={{
          ...base,
          conversationId: 'c1',
          messages: [
            { id: 'm1', from: 'student', text: 'Bu soruda nerede yanlış yaptım?', attachments: [{ id: 'u1', kind: 'photo' }], escalated: false, seeded: false },
            { id: 'm2', from: 'tutor', text: 'Yolun doğru, tek bir işaret kaçmış.', attachments: [], escalated: false, seeded: false },
          ],
        }}
      />,
    );
    expect(screen.queryByText(/Ben senin AI koçunum/)).toBeNull();
    expect(screen.getByRole('img', { name: 'Eklediğin fotoğraf' })).toHaveAttribute('src', '/api/chat/upload/u1');
    expect(screen.getByText('Yolun doğru, tek bir işaret kaçmış.')).toBeInTheDocument();
  });

  it('koç kullanılamıyorsa giriş kapalı ve açıklama görünür', () => {
    render(<CoachChat initial={{ ...base, available: false }} />);
    expect(screen.getByRole('alert')).toHaveTextContent(CHAT_COPY.unavailable);
    expect(screen.getByLabelText('Koça yaz')).toBeDisabled();
  });

  it('önceki tur sürüyorsa: yazıyor görünür, gönderim kapalı; sayfa yenilenir, tur bitince yanıt gelir', async () => {
    vi.useFakeTimers();
    try {
      const msgs = [{ id: 'm1', from: 'student' as const, text: 'Bunu nasıl çözerim?', attachments: [], escalated: false, seeded: false }];
      const { rerender } = render(<CoachChat initial={{ ...base, conversationId: 'c1', messages: msgs, pending: true }} />);
      expect(screen.getByText('Öğretmen yazıyor')).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Koça yaz'), { target: { value: 'Yeni soru' } });
      expect(screen.getByRole('button', { name: 'Gönder' })).toBeDisabled();
      refresh.mockClear();
      act(() => {
        vi.advanceTimersByTime(3100);
      });
      expect(refresh).toHaveBeenCalled();
      const reply = { id: 'm3', from: 'tutor' as const, text: 'Önce parantezi aç.', attachments: [], escalated: false, seeded: false };
      rerender(<CoachChat initial={{ ...base, conversationId: 'c1', messages: [...msgs, reply], pending: false }} />);
      expect(screen.getByText('Önce parantezi aç.')).toBeInTheDocument();
      expect(screen.queryByText('Öğretmen yazıyor')).toBeNull();
      expect(screen.getByRole('button', { name: 'Gönder' })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('409 (başka sekmede tur sürüyor): taslak geri gelir, açıklama görünür, bekleme kipine geçer', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ error: { code: 'turn_in_progress', message: CHAT_COPY.turnInProgress } }, { status: 409 }),
    );
    render(<CoachChat initial={{ ...base, conversationId: 'c1' }} fetchImpl={fetchImpl as unknown as typeof fetch} />);
    fireEvent.change(screen.getByLabelText('Koça yaz'), { target: { value: 'İkinci soru' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gönder' }));
    await screen.findByText(CHAT_COPY.turnInProgress);
    expect((screen.getByLabelText('Koça yaz') as HTMLTextAreaElement).value).toBe('İkinci soru');
    expect(screen.getByText('Öğretmen yazıyor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gönder' })).toBeDisabled();
  });

  it('oturum kapanınca (giriş sayfasına yönlenen yanıt) doğru açıklama', async () => {
    const res = new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    Object.defineProperty(res, 'redirected', { value: true });
    Object.defineProperty(res, 'url', { value: 'http://localhost/giris?next=%2Fapi%2Fchat' });
    const fetchImpl = vi.fn(async () => res);
    render(<CoachChat initial={base} fetchImpl={fetchImpl as unknown as typeof fetch} />);
    fireEvent.change(screen.getByLabelText('Koça yaz'), { target: { value: 'Merhaba' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gönder' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(CHAT_COPY.sessionExpired);
  });

  it('teşhis şeridi Kaldır: dokunma hedefi 44 px, hazır metin de temizlenir (yazılmış metin kalır)', async () => {
    const seed = { id: '7e5d0000-0000-4000-8000-0000000000a1', summary: 'Parantezi açarken işaret.', attachments: [] };
    const { unmount } = render(<CoachChat initial={{ ...base, seed }} />);
    const remove = screen.getByRole('button', { name: 'Kaldır' });
    expect(remove.className).toMatch(/min-h-11/);
    fireEvent.click(remove);
    expect(screen.queryByText('Parantezi açarken işaret.')).toBeNull();
    expect((screen.getByLabelText('Koça yaz') as HTMLTextAreaElement).value).toBe('');
    unmount();
    render(<CoachChat initial={{ ...base, seed }} />);
    fireEvent.change(screen.getByLabelText('Koça yaz'), { target: { value: 'Kendi sorum' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kaldır' }));
    expect((screen.getByLabelText('Koça yaz') as HTMLTextAreaElement).value).toBe('Kendi sorum');
  });
  it('akış başladıktan sonra koparsa: hata yerine bekleme; sayfa yenilenir, kaydedilen yanıt gelir', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const fetchImpl = vi.fn(async () => sse([{ event: 'start', data: { conversationId: 'c1', userMessageId: 1, mode: 'hint' } }]));
      render(<CoachChat initial={base} fetchImpl={fetchImpl as unknown as typeof fetch} />);
      fireEvent.change(screen.getByLabelText('Koça yaz'), { target: { value: 'Kopan soru' } });
      fireEvent.click(screen.getByRole('button', { name: 'Gönder' }));
      await waitFor(() => expect(screen.getByText('Öğretmen yazıyor')).toBeInTheDocument());
      await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
      // stream_closed: uyarı yok, mesaj geri alınmaz, bekleme kipinde sayfa yenilenir.
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.getByText('Kopan soru')).toBeInTheDocument();
      refresh.mockClear();
      act(() => {
        vi.advanceTimersByTime(3100);
      });
      expect(refresh).toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Gönder' })).toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('üst üste iki seçim en çok 4 ek ekler; fazlası için açıklama görünür', async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => Response.json({ id: `00000000-0000-4000-8000-00000000000${++n}`, kind: 'pdf' }, { status: 201 }));
    render(<CoachChat initial={base} fetchImpl={fetchImpl as unknown as typeof fetch} />);
    const input = screen.getByTestId('koc-dosya');
    const pdf = (i: number) => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], `belge${i}.pdf`, { type: 'application/pdf' });
    // İki seçim yeniden çizimden önce: ikincisi bayat sayıyla 3 ek daha ekleyemez.
    act(() => {
      fireEvent.change(input, { target: { files: [pdf(1), pdf(2), pdf(3)] } });
      fireEvent.change(input, { target: { files: [pdf(4), pdf(5), pdf(6)] } });
    });
    const list = await screen.findByRole('list', { name: 'Ekler' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(4));
    expect(screen.getByRole('alert')).toHaveTextContent(CHAT_COPY.tooManyAttachments(4));
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(4));
    expect(within(list).getAllByRole('listitem')).toHaveLength(4);
  });
});
