import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ThemeToggle } from '@/components/ThemeToggle';
import { THEME_INIT_SCRIPT, THEME_STORAGE_KEY, applyTheme, readStoredTheme, storeTheme } from '@/lib/theme';

describe('tema', () => {
  it('applyTheme: system özniteliği kaldırır, light/dark yazar', () => {
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    applyTheme('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
  it('tercih localStorage da saklanır; geçersiz değer sistem sayılır', () => {
    storeTheme('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(readStoredTheme()).toBe('dark');
    window.localStorage.setItem(THEME_STORAGE_KEY, 'mor');
    expect(readStoredTheme()).toBe('system');
    storeTheme('system');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });
  it('boyama öncesi betik kayıtlı temayı uygular', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    new Function(THEME_INIT_SCRIPT)();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
  it('ThemeToggle seçimi uygular ve düğmeleri aria-pressed ile işaretler', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    const dark = screen.getByRole('button', { name: 'Koyu' });
    await user.click(dark);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(dark).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Sistem' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: 'Sistem' }));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });
});
