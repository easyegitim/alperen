// Deneme bekleme ve "Nereye kadar geldim?" ekranları (P2-D).
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock('next/image', () => ({ default: (p: { alt: string }) => <span role="img" aria-label={p.alt || undefined} /> }));
vi.mock('@/lib/supabase/browser', () => ({ createSupabaseBrowserClient: () => ({ storage: { from: () => ({ upload: vi.fn().mockResolvedValue({ error: null }) }) } }) }));

const sendBlankReason = vi.fn();
const sendHowFar = vi.fn();
vi.mock('@/server/exam-result/actions', () => ({ sendBlankReason: (...a: unknown[]) => sendBlankReason(...a), sendHowFar: (...a: unknown[]) => sendHowFar(...a) }));

let liveCheck: (() => Promise<boolean | void>) | null = null;
vi.mock('@/lib/live', () => ({
  useLive: (o: { check: () => Promise<boolean | void> }) => {
    liveCheck = o.check;
    return null;
  },
}));

import { DenemeBekleme, SonucYenile } from '@/app/ogrenci/deneme/[session]/bekleme';
import { NeredenKadarGeldim } from '@/app/ogrenci/deneme/[session]/soru/[response]/nereye-kadar';

const S = '00000000-0000-4000-8000-0000000000b1';
const R = '00000000-0000-4000-8000-0000000000a1';
const OWNER = '00000000-0000-4000-8000-000000000001';

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  sendBlankReason.mockReset();
  sendHowFar.mockReset();
  liveCheck = null;
});

describe('DenemeBekleme', () => {
  it('maskot + tek satır "sayfa 3/12"; yoklama ilerlemeyi günceller, notlanınca ekranı yeniler', async () => {
    render(<DenemeBekleme sessionId={S} initial={{ stage: 'classify', pages_total: 12, pages_done: 3 }} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Denemeni inceliyorum…' })).toBeInTheDocument();
    expect(screen.getByTestId('bekleme-satiri')).toHaveTextContent('sayfa 3/12');
    expect(screen.getAllByRole('link')).toHaveLength(1); // yalnız "Bugün’e dön"

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ json: async () => ({ screen: 'waiting', progress: { stage: 'ocr' } }) }).mockResolvedValueOnce({ json: async () => ({ screen: 'result' }) }));
    await act(async () => {
      expect(await liveCheck!()).toBe(false);
    });
    await waitFor(() => expect(screen.getByTestId('bekleme-satiri')).toHaveTextContent('sorular okunuyor'));
    expect(refresh).not.toHaveBeenCalled();
    expect(await liveCheck!()).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('düşmüş oturumda da ekranı yeniler; ağ hatası sessizce sürer', async () => {
    render(<DenemeBekleme sessionId={S} initial={null} />);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('ağ')).mockResolvedValueOnce({ json: async () => ({ screen: 'failed' }) }));
    expect(await liveCheck!()).toBe(false);
    expect(await liveCheck!()).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});

describe('SonucYenile', () => {
  it('rapor hazır olunca yeniler; sürerken tek satır gösterir', async () => {
    render(<SonucYenile sessionId={S} reportPending pendingItems={0} />);
    expect(screen.getByRole('status')).toHaveTextContent('Raporun hazırlanıyor…');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ json: async () => ({ screen: 'result', report: 'pending', pendingItems: 0 }) }).mockResolvedValueOnce({ json: async () => ({ screen: 'result', report: 'ready', pendingItems: 0 }) }));
    expect(await liveCheck!()).toBe(false);
    expect(await liveCheck!()).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('bekleyen teşhis bitince yeniler; hiçbir şey sürmüyorsa metin çizmez', async () => {
    const { container } = render(<SonucYenile sessionId={S} reportPending={false} pendingItems={2} />);
    expect(container).toBeEmptyDOMElement();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ json: async () => ({ report: 'ready', pendingItems: 2 }) }).mockResolvedValueOnce({ json: async () => ({ report: 'ready', pendingItems: 1 }) }));
    expect(await liveCheck!()).toBe(false);
    expect(await liveCheck!()).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});

describe('NeredenKadarGeldim', () => {
  it('yanlış soruda: tek birincil "Fotoğraf çek", "Yaz"; neden düğmeleri yok', () => {
    render(<NeredenKadarGeldim sessionId={S} responseId={R} ownerId={OWNER} blankable={false} />);
    expect(screen.getByRole('button', { name: /Fotoğraf çek/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Yaz/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hiç başlayamadım' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Süre yetmedi' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Gönder' })).toBeNull();
  });

  it('boş soruda "Süre yetmedi" tek dokunuşla gönderilir ve Detay\'a döner', async () => {
    sendBlankReason.mockResolvedValue({ ok: true, href: `/ogrenci/deneme/${S}?detay=1` });
    render(<NeredenKadarGeldim sessionId={S} responseId={R} ownerId={OWNER} blankable />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Süre yetmedi' }));
    expect(sendBlankReason).toHaveBeenCalledWith({ sessionId: S, responseId: R, reason: 'time' });
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/ogrenci/deneme/${S}?detay=1`));
  });

  it('yaz → Gönder: metin gider; hata gelirse tek cümle gösterilir ve yönlenmez', async () => {
    const user = userEvent.setup();
    sendHowFar.mockResolvedValueOnce({ ok: false, error: 'Bu soru için bilgiyi zaten verdin.' }).mockResolvedValueOnce({ ok: true, href: `/ogrenci/deneme/${S}?detay=1` });
    render(<NeredenKadarGeldim sessionId={S} responseId={R} ownerId={OWNER} blankable={false} />);
    await user.click(screen.getByRole('button', { name: /Yaz/ }));
    await user.type(screen.getByLabelText('Nereye kadar geldin?'), 'Eksiyi dağıtamadım');
    await user.click(screen.getByRole('button', { name: 'Gönder' }));
    expect(sendHowFar).toHaveBeenCalledWith({ sessionId: S, responseId: R, text: 'Eksiyi dağıtamadım', files: [] });
    expect(await screen.findByText('Bu soru için bilgiyi zaten verdin.')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Gönder' }));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
  });

  it('neden hatasında düğmeler yeniden açılır', async () => {
    sendBlankReason.mockResolvedValue({ ok: false, error: 'Gönderemedim.' });
    render(<NeredenKadarGeldim sessionId={S} responseId={R} ownerId={OWNER} blankable />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Hiç başlayamadım' }));
    expect(await screen.findByText('Gönderemedim.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hiç başlayamadım' })).toBeEnabled();
    expect(push).not.toHaveBeenCalled();
  });
});
