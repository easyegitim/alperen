import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import HataSayfasi from '@/app/ogrenci/error';

describe('öğrenci error sınırı', () => {
  it('cümleyi, düğmeyi ve ana sayfa bağlantısını gösterir; hata metnini göstermez', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reset = vi.fn();
    render(<HataSayfasi error={Object.assign(new Error('gizli-ayrıntı-42'), { digest: 'd1' })} reset={reset} />);
    expect(screen.getByText('Bu sayfa şu an açılamadı.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Yeniden dene' }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Ana sayfaya dön' }).getAttribute('href')).toBe('/ogrenci');
    expect(screen.queryByText(/gizli-ayrıntı-42/)).toBeNull();
    expect(spy.mock.calls[0]?.[0]).toContain('OGR-WEB-003');
    spy.mockRestore();
  });
});
