// Veli ekranları (mockup S10, S10b): sohbet (akış, yazıyor, hızlı çipler, mod seçici/ek/mikrofon yok, hata), "Rapor iste"
// tür seçimi, bildirim kartları, kural anahtarları ve öğrenci Profil'indeki tek düğmeli veli daveti.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh }), usePathname: () => '/veli/sohbet' }));
vi.mock('@/app/veli/actions', () => ({
  requestReportAction: vi.fn(async () => ({ ok: true, message: 'Raporu hazırlıyorum; hazır olunca haber vereceğim.' })),
  markNotificationRead: vi.fn(async () => undefined),
  toggleRule: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/app/davet/actions', () => ({ createGuardianInvite: vi.fn(async () => ({ token: 'gi_abcdefghijklmnopqrstuvwxyz234567', expiresAt: '2026-11-07T10:00:00Z' })) }));

import { GuardianInvite } from '@/components/GuardianInvite';
import { NotificationCards } from '@/components/parent/NotificationCards';
import { ParentChat } from '@/components/parent/ParentChat';
import { ReportRequest } from '@/components/parent/ReportRequest';
import { EmailSwitch, RuleSwitches } from '@/components/parent/RuleSwitches';
import { PARENT_COPY, PARENT_RULES } from '@/lib/parent';

const CHILD = '10000000-0000-4000-8000-000000000001';
const base = { available: true, conversationId: null, messages: [], pending: false };

function sse(events: { event: string; data: unknown }[]) {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const e of events) c.enqueue(enc.encode(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
}

describe('ParentChat', () => {
  it('karşılama, AI öğretmen etiketi; mod seçici, ek ve mikrofon yok; rapor çipi yok', () => {
    render(<ParentChat studentId={CHILD} initial={base} />);
    expect(screen.getByText(/ne çalıştığını, derslerdeki durumunu/)).toBeInTheDocument();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('button', { name: /ekle|sesle/i })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Rapor iste' })).toBeNull(); // çip yok (mockup S10b)
    expect(screen.getByRole('button', { name: 'Gönder' })).toBeDisabled();
  });

  it('gönder: gövde {student_id, conversation_id, text}; akışlı yanıt balonda kalır; rapor serbest metinle istenir', async () => {
    const user = userEvent.setup();
    let id = 8;
    const fetchImpl = vi.fn(async () =>
      sse([
        { event: 'start', data: { conversationId: 'c1', userMessageId: 1 } },
        { event: 'tool', data: { name: 'get_child_summary' } },
        { event: 'text', data: { text: 'Bu hafta 4,5 saat ' } },
        { event: 'text', data: { text: 'çalıştı.' } },
        { event: 'report', data: { documentId: 'd1', title: 'Haftalık rapor', kind: 'weekly' } },
        { event: 'done', data: { messageId: ++id, text: 'Bu hafta 4,5 saat çalıştı.', refusal: false } },
      ]),
    );
    render(<ParentChat studentId={CHILD} initial={base} fetchImpl={fetchImpl as unknown as typeof fetch} />);
    await user.type(screen.getByLabelText(PARENT_COPY.chatPlaceholder), 'Bu hafta ne çalıştı?');
    await user.click(screen.getByRole('button', { name: 'Gönder' }));
    await waitFor(() => expect(screen.getAllByText('Bu hafta 4,5 saat çalıştı.').length).toBeGreaterThan(0));
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body))).toEqual({ student_id: CHILD, conversation_id: null, text: 'Bu hafta ne çalıştı?' });
    expect(screen.getByText('Bu hafta ne çalıştı?')).toBeInTheDocument();
    expect(screen.getByTestId('rapor-istendi')).toHaveTextContent('Haftalık rapor istendi. Hazır olunca Özet’te görünür.');
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('/api/parent-chat');

    await user.type(screen.getByLabelText(PARENT_COPY.chatPlaceholder), 'Haftalık rapor istiyorum.');
    await user.click(screen.getByRole('button', { name: 'Gönder' }));
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    const second = JSON.parse(String(((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1]).body));
    expect(second).toMatchObject({ conversation_id: 'c1', text: 'Haftalık rapor istiyorum.' });
  });

  it('sunucu reddederse mesaj geri gelir ve nazik hata görünür; kullanılamıyorsa giriş kapalı', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'turn_in_progress', message: PARENT_COPY.chatBusy } }), { status: 409, headers: { 'content-type': 'application/json' } }));
    render(<ParentChat studentId={CHILD} initial={base} fetchImpl={fetchImpl as unknown as typeof fetch} />);
    await user.type(screen.getByLabelText(PARENT_COPY.chatPlaceholder), 'Merhaba');
    await user.click(screen.getByRole('button', { name: 'Gönder' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(PARENT_COPY.chatBusy);
    expect(screen.getByLabelText(PARENT_COPY.chatPlaceholder)).toHaveValue('Merhaba');
  });

  it('kullanılamıyorsa giriş kapalı ve uyarı görünür', () => {
    render(<ParentChat studentId={CHILD} initial={{ ...base, available: false }} />);
    expect(screen.getByRole('alert')).toHaveTextContent(PARENT_COPY.chatUnavailable);
    expect(screen.getByLabelText(PARENT_COPY.chatPlaceholder)).toBeDisabled();
  });
});

describe('ReportRequest', () => {
  it('kapalı başlar; açılınca tek satır dört tür; Konu metin alanı açar; sonuç satırı', async () => {
    const user = userEvent.setup();
    const action = vi.fn(async () => ({ ok: true, message: PARENT_COPY.reportAsked }));
    render(<ReportRequest studentId={CHILD} action={action} />);
    expect(screen.queryByRole('radio')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Rapor iste' }));
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['Haftalık', 'Deneme', 'Konu', 'Trend']);
    expect(screen.getByRole('radio', { name: 'Haftalık' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('radio', { name: 'Konu' }));
    await user.type(screen.getByLabelText('Hangi konu?'), 'üslü sayılar');
    await user.click(screen.getByRole('button', { name: 'İste' }));
    await waitFor(() => expect(action).toHaveBeenCalledWith(CHILD, 'topic', 'üslü sayılar'));
    expect(await screen.findByText(PARENT_COPY.reportAsked)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Trend' }));
    await user.click(screen.getByRole('button', { name: 'İste' }));
    await waitFor(() => expect(action).toHaveBeenLastCalledWith(CHILD, 'trend', null));
  });
});

describe('NotificationCards ve RuleSwitches', () => {
  it('tek kart: yalnız en yeni bildirim, başlık bağlantı, tek Okudum; boşsa hiçbir şey çizilmez', () => {
    const item = (id: string, title: string, href: string | null) => ({ id, kind: 'exam_analysed', title, body: 'Elif’in denemesi incelendi.', createdAt: '2026-11-03T10:00:00Z', read: false, href });
    const { container, rerender } = render(<NotificationCards items={[item('n1', 'Deneme sonucu hazır', '/veli/rapor/x'), item('n2', 'Haftalık özet hazır', '/veli')]} />);
    expect(screen.getByRole('link', { name: 'Deneme sonucu hazır' })).toHaveAttribute('href', '/veli/rapor/x');
    expect(screen.queryByText('Haftalık özet hazır')).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Okudum' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Aç' })).toBeNull();
    rerender(<NotificationCards items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('E-postayla da gönder: tek anahtar; başarısızsa geri alınır', async () => {
    const user = userEvent.setup();
    const action = vi.fn(async (on: boolean) => ({ ok: on }));
    render(<EmailSwitch initial={false} action={action} />);
    const sw = screen.getByRole('switch', { name: 'E-postayla da gönder' });
    await user.click(sw);
    expect(action).toHaveBeenCalledWith(true);
    expect(sw).toHaveAttribute('aria-checked', 'true');
    await user.click(sw);
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'true'));
    expect(await screen.findByRole('alert')).toHaveTextContent('kaydedilemedi');
  });

  it('yedi kural anahtarı; değişiklik kaydedilir, başarısızsa geri alınır ve uyarı verir', async () => {
    const user = userEvent.setup();
    const rules = PARENT_RULES.map((r) => ({ kind: r.kind, enabled: true }));
    const action = vi.fn(async (kind: string) => ({ ok: kind !== 'inactivity' }));
    render(<RuleSwitches rules={rules} action={action} />);
    expect(screen.getAllByRole('switch')).toHaveLength(7);
    const weekly = screen.getByRole('switch', { name: 'Haftalık özet' });
    await user.click(weekly);
    expect(weekly).toHaveAttribute('aria-checked', 'false');
    expect(action).toHaveBeenCalledWith('weekly_summary', false);
    const idle = screen.getByRole('switch', { name: 'Ara verildiğinde' });
    await user.click(idle);
    await waitFor(() => expect(idle).toHaveAttribute('aria-checked', 'true'));
    expect(await screen.findByRole('alert')).toHaveTextContent('kaydedilemedi');
  });
});

describe('GuardianInvite (öğrenci Profil)', () => {
  it('sade kipte yakınlık seçimi yok; tek düğme "Veli davet et"; kod gelince kopyala', async () => {
    const user = userEvent.setup();
    render(<GuardianInvite simple />);
    expect(screen.queryByLabelText(/Yakınlık/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Veli davet et' }));
    expect(await screen.findByTestId('davet-kodu')).toHaveTextContent('gi_abcdefghijklmnopqrstuvwxyz234567');
    expect(screen.getByRole('button', { name: 'Kodu kopyala' })).toBeInTheDocument();
  });
});
