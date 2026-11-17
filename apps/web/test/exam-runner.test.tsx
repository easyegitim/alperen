// ExamRunner: şık seç, işaretle, ızgara, bitir onayı, süre dolunca otomatik bitiş, çevrimdışı kuyruk (jsdom; eylemler sahte).
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }) }));
const record = vi.fn();
const finish = vi.fn();
const sync = vi.fn();
vi.mock('@/server/exam/actions', () => ({
  recordExamResponseAction: (...a: unknown[]) => record(...a),
  finishExamAction: (...a: unknown[]) => finish(...a),
  registerCanvasUpload: vi.fn(),
  startExamAction: vi.fn(),
  syncExamClockAction: (...a: unknown[]) => sync(...a),
}));
vi.mock('@/lib/supabase/browser', () => ({ createSupabaseBrowserClient: () => ({ storage: { from: () => ({ upload: async () => ({ error: null }) }) } }) }));

import { ExamRunner, type ExamRunnerProps } from '@/components/exam';
import { queueKey } from '@/server/exam/queue';

const qid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SESSION = qid(100);

function items(): ExamRunnerProps['items'] {
  return [1, 2, 3].map((no) => ({
    no,
    questionId: qid(no),
    section: 'mat',
    kind: 'mcq' as const,
    stem: `${no}. soru metni`,
    options: ['A', 'B', 'C', 'D', 'E'].map((key) => ({ key, text: `${key} şıkkı` })),
    figure: null,
    crop: null,
  }));
}

function props(extra: Partial<ExamRunnerProps> = {}): ExamRunnerProps {
  const now = Date.now();
  return {
    sessionId: SESSION,
    title: 'TYT Deneme 1',
    ownerId: qid(900),
    items: items(),
    deadlineAt: new Date(now + 75 * 60_000).toISOString(),
    serverNow: new Date(now).toISOString(),
    expired: false,
    answers: [],
    ...extra,
  };
}

beforeEach(() => {
  record.mockReset().mockResolvedValue({ ok: true });
  finish.mockReset().mockResolvedValue({ ok: true, href: `/ogrenci/sonuc?deneme=${SESSION}` });
  replace.mockReset();
  sync.mockReset().mockResolvedValue(null);
  window.scrollTo = vi.fn();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ExamRunner', () => {
  it('3 soru: şık seçer, her cevabı kaydeder, Sonraki ile ilerler, son soruda Bitir onayıyla bitirir', async () => {
    render(<ExamRunner {...props()} />);
    expect(screen.getByRole('timer', { name: 'Kalan süre' })).toHaveTextContent('1:15:00');
    expect(screen.getByTestId('soru-no')).toHaveTextContent('Soru 1 / 3');
    const group = screen.getByRole('radiogroup');
    expect(within(group).getAllByRole('radio')).toHaveLength(5);

    fireEvent.click(screen.getByRole('radio', { name: /B şıkkı/ }));
    expect(screen.getByRole('radio', { name: /B şıkkı/ })).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(record).toHaveBeenCalledWith(expect.objectContaining({ sessionId: SESSION, questionId: qid(1), answer: 'B', flagged: false })));
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');

    fireEvent.click(screen.getByRole('button', { name: 'Sonraki' }));
    expect(screen.getByTestId('soru-no')).toHaveTextContent('Soru 2 / 3');
    fireEvent.click(screen.getByRole('radio', { name: /D şıkkı/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Sonraki' }));
    fireEvent.click(screen.getByRole('radio', { name: /A şıkkı/ }));
    await waitFor(() => expect(record).toHaveBeenCalledWith(expect.objectContaining({ questionId: qid(3), answer: 'A' })));
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ questionId: qid(2), answer: 'D' }));

    fireEvent.click(screen.getByRole('button', { name: 'Bitir' }));
    const dialog = screen.getByRole('dialog', { name: 'Sınavı bitir' });
    expect(within(dialog).getByTestId('bitir-onay')).toHaveTextContent('Tüm soruları cevapladın');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Bitir' }));
    await waitFor(() => expect(finish).toHaveBeenCalledWith(SESSION));
    await waitFor(() => expect(replace).toHaveBeenCalledWith(`/ogrenci/sonuc?deneme=${SESSION}`));
  });

  it('İşaretle ve Sorular: ızgara özetini kelimeyle verir, ızgaradan soruya atlar', async () => {
    render(<ExamRunner {...props()} />);
    fireEvent.click(screen.getByRole('radio', { name: /C şıkkı/ }));
    fireEvent.click(screen.getByRole('button', { name: 'İşaretle' }));
    expect(screen.getByRole('button', { name: 'İşaretle' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(record).toHaveBeenLastCalledWith(expect.objectContaining({ answer: 'C', flagged: true })));

    fireEvent.click(screen.getByRole('button', { name: 'Sorular' }));
    const dialog = screen.getByRole('dialog', { name: 'Sorular' });
    expect(within(dialog).getByTestId('izgara-ozet')).toHaveTextContent('1 cevaplı, 1 işaretli, 2 boş');
    expect(within(dialog).getByRole('button', { name: 'Soru 1, bayraklı' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Soru 3, boş' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Soru 3, boş' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('soru-no')).toHaveTextContent('Soru 3 / 3');
  });

  it('aynı şıkka yeniden dokunmak cevabı boşa çeker ve boş olarak kaydeder', async () => {
    render(<ExamRunner {...props()} />);
    fireEvent.click(screen.getByRole('radio', { name: /E şıkkı/ }));
    fireEvent.click(screen.getByRole('radio', { name: /E şıkkı/ }));
    await waitFor(() => expect(record).toHaveBeenLastCalledWith(expect.objectContaining({ questionId: qid(1), answer: null })));
  });

  it('boş soru varken Bitir onayı boş sayısını söyler; Geri dön sınava döndürür', () => {
    render(<ExamRunner {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sorular' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sınavı bitir' }));
    expect(screen.getByTestId('bitir-onay')).toHaveTextContent('3 soru boş');
    fireEvent.click(screen.getByRole('button', { name: 'Geri dön' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(finish).not.toHaveBeenCalled();
  });

  it('süre dolunca onay sormadan kendiliğinden biter', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
    const now = Date.now();
    render(<ExamRunner {...props({ deadlineAt: new Date(now + 3000).toISOString(), serverNow: new Date(now).toISOString() })} />);
    expect(screen.getByRole('timer')).toHaveTextContent('00:03');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3600);
    });
    expect(finish).toHaveBeenCalledWith(SESSION);
    expect(replace).toHaveBeenCalledWith(`/ogrenci/sonuc?deneme=${SESSION}`);
  });

  it('süre sayfa açılırken dolmuşsa doğrudan bitirir ve saat eşitlemesi çağrılmaz', async () => {
    render(<ExamRunner {...props({ expired: true, deadlineAt: new Date(Date.now() - 1000).toISOString() })} />);
    await waitFor(() => expect(finish).toHaveBeenCalledWith(SESSION));
    expect(sync).not.toHaveBeenCalled();
  });

  it('bitiş ve kuyruk yarışı: saat eşitlemesi oturum kimliğiyle çağrılır (yeni oturum açan başlatma yolu yok) ve bitişten sonra da sayacı değiştirmez', async () => {
    const now = Date.now();
    sync.mockResolvedValue(null);
    render(<ExamRunner {...props({ serverNow: new Date(now).toISOString(), deadlineAt: new Date(now + 600_000).toISOString() })} />);
    await waitFor(() => expect(sync).toHaveBeenCalledWith(SESSION));
    expect(screen.getByRole('timer')).toHaveTextContent('10:00');
  });

  it('karalama alt sayfasından bitirme sırasında çizim kaybolmaz: Esc kaydedilmemiş çizimde onay sorar, Vazgeç kapatır', async () => {
    const ctx = { fillStyle: '', fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), strokeStyle: '', lineWidth: 0, lineCap: '', lineJoin: '', drawImage: vi.fn() };
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    try {
      render(<ExamRunner {...props()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Karalama' }));
      const canvas = screen.getByTestId('karalama-tuvali');
      expect(canvas).toHaveAttribute('role', 'application');
      expect(canvas).toHaveAccessibleDescription(/isteğe bağlıdır/);
      fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.getByTestId('karalama-vazgec')).toHaveTextContent('Kaydetmediğin bir çizim var');
      expect(screen.getByRole('application')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Geri dön' }));
      expect(screen.queryByTestId('karalama-vazgec')).toBeNull();
      fireEvent.keyDown(document, { key: 'Escape' });
      fireEvent.click(screen.getByRole('button', { name: 'Vazgeç' }));
      expect(screen.queryByRole('application')).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('daha önce kaydedilmiş karalama varsa tuval bunu kelimeyle söyler', () => {
    render(<ExamRunner {...props({ answers: [{ questionId: qid(1), answer: null, flagged: false, hasWork: true }] })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Karalama, kaydedildi' }));
    expect(screen.getByText(/daha önce kaydedilmiş bir karalama var/)).toBeInTheDocument();
  });

  it('sayısal ve açık uçlu cevapta sayı klavyesi (decimal) verilmez: iOS sayı klavyesinde eksi işareti yoktur', () => {
    const its = items();
    its[0] = { no: 1, questionId: qid(1), section: 'mat', kind: 'open', stem: 'Açıkla', options: [], figure: null, crop: null } as unknown as ExamRunnerProps['items'][number];
    render(<ExamRunner {...props({ items: its })} />);
    expect(screen.getByLabelText('Cevabın')).not.toHaveAttribute('inputmode', 'decimal');
  });

  it('süre sunucudan türetilir: istemci saati sapsa da sayaç sunucu saatine göre başlar', () => {
    const now = Date.now();
    // sunucu saati istemciden 10 dk ileri; bitiş sunucu saatine göre 30 dk sonra
    render(<ExamRunner {...props({ serverNow: new Date(now + 600_000).toISOString(), deadlineAt: new Date(now + 600_000 + 1_800_000).toISOString() })} />);
    expect(screen.getByRole('timer')).toHaveTextContent('30:00');
  });

  it('ağ yokken cevap kuyrukta kalır (localStorage), bildirim çıkar; bitirirken kuyruk boşalamazsa hata ve yeniden deneme', async () => {
    record.mockRejectedValue(new Error('offline'));
    render(<ExamRunner {...props()} />);
    fireEvent.click(screen.getByRole('radio', { name: /B şıkkı/ }));
    await waitFor(() => expect(screen.getByText(/1 cevap henüz gönderilmedi/)).toBeInTheDocument());
    expect(JSON.parse(window.localStorage.getItem(queueKey(SESSION))!)[0]).toMatchObject({ questionId: qid(1), answer: 'B' });
    expect(finish).not.toHaveBeenCalled();
  });

  it('bu cihazda gönderilmemiş cevap yeniden açılışta ekrana yansır ve gönderilir', async () => {
    window.localStorage.setItem(queueKey(SESSION), JSON.stringify([{ questionId: qid(1), answer: 'D', flagged: true, timeSpentSec: 4 }, { questionId: qid(2), answer: 'A', flagged: false, timeSpentSec: 1 }, { questionId: qid(3), answer: 'A', flagged: false, timeSpentSec: 1 }]));
    render(<ExamRunner {...props()} />);
    expect(screen.getByRole('radio', { name: /D şıkkı/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: 'İşaretle' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(record).toHaveBeenCalledWith(expect.objectContaining({ questionId: qid(1), answer: 'D', flagged: true })));
    await waitFor(() => expect(window.localStorage.getItem(queueKey(SESSION))).toBeNull());
  });

  it('süre doldu hatası (OGR-EXAM-008) kuyruğu boşaltır, yeniden denenmez', async () => {
    record.mockResolvedValue({ ok: false, message: 'Süre doldu', closed: true });
    render(<ExamRunner {...props()} />);
    fireEvent.click(screen.getByRole('radio', { name: /A şıkkı/ }));
    await waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(window.localStorage.getItem(queueKey(SESSION))).toBeNull());
    expect(screen.queryByText(/henüz gönderilmedi/)).toBeNull();
  });

  it('erişilebilirlik: radiogroup soruya bağlı, zamanlayıcı role=timer, ok tuşu seçimi taşır', () => {
    render(<ExamRunner {...props()} />);
    const group = screen.getByRole('radiogroup');
    expect(group).toHaveAttribute('aria-labelledby', 'soru');
    expect(document.getElementById('soru')).toHaveTextContent('1. soru metni');
    fireEvent.keyDown(group, { key: 'ArrowDown' });
    expect(screen.getByRole('radio', { name: /A şıkkı/ })).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(group, { key: 'ArrowDown' });
    expect(screen.getByRole('radio', { name: /B şıkkı/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('timer')).toBeInTheDocument();
  });

  it('alt sayfa açıkken Tab diyalog dışına çıkmaz ve arka plan etkisizdir', async () => {
    const user = userEvent.setup();
    render(<ExamRunner {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sorular' }));
    const dialog = screen.getByRole('dialog');
    const buttons = within(dialog).getAllByRole('button');
    buttons[buttons.length - 1]!.focus();
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(screen.getByTestId('soru-no').closest('[inert]')).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByTestId('soru-no').closest('[inert]')).toBeNull();
  });

  it('açık uçlu cevap her tuşta değil, sessizlikten sonra tek kez gönderilir; Sonraki bekleyeni boşaltır', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
    const its = items();
    its[0] = { no: 1, questionId: qid(1), section: 'mat', kind: 'numeric', stem: 'Kaç?', options: [], figure: null, crop: null } as unknown as ExamRunnerProps['items'][number];
    render(<ExamRunner {...props({ items: its })} />);
    const input = screen.getByLabelText('Cevabın');
    for (const v of ['1', '12', '12,', '12,5']) fireEvent.change(input, { target: { value: v } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(record).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenLastCalledWith(expect.objectContaining({ answer: '12,5' }));
    fireEvent.change(input, { target: { value: '13' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sonraki' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(record).toHaveBeenLastCalledWith(expect.objectContaining({ questionId: qid(1), answer: '13' }));
  });

  it('beş dakika ve bir dakika eşiklerinde ekran okuyucuya bir kez duyurur', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
    const now = Date.now();
    render(<ExamRunner {...props({ deadlineAt: new Date(now + 302_000).toISOString(), serverNow: new Date(now).toISOString() })} />);
    expect(screen.getByTestId('sure-uyari')).toHaveTextContent('');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByTestId('sure-uyari')).toHaveTextContent('Beş dakika kaldı.');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(240_000);
    });
    expect(screen.getByTestId('sure-uyari')).toHaveTextContent('Bir dakika kaldı.');
  });

  it('mount sonrası saat eşitlemesi sayacı düzeltir', async () => {
    const now = Date.now();
    sync.mockResolvedValue({ deadlineAt: new Date(now + 600_000).toISOString(), serverNow: new Date(now).toISOString() });
    render(<ExamRunner {...props({ serverNow: new Date(now + 120_000).toISOString(), deadlineAt: new Date(now + 600_000).toISOString() })} />);
    await waitFor(() => expect(screen.getByRole('timer')).toHaveTextContent('10:0'));
    expect(sync).toHaveBeenCalledWith(SESSION);
  });
});
