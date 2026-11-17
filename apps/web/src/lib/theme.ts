// Tema tercihi: "system" (varsayılan, data-theme verilmez; işletim sistemi tercihi geçerli), "light", "dark".

export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = 'ogrenmen-tema';
export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];
export const THEME_LABELS: Record<ThemePreference, string> = { system: 'Sistem', light: 'Açık', dark: 'Koyu' };

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function readStoredTheme(): ThemePreference {
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

/** Tercihi <html data-theme> üzerine uygular; "system" özniteliği kaldırır. */
export function applyTheme(pref: ThemePreference, root: HTMLElement = document.documentElement): void {
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
}

export function storeTheme(pref: ThemePreference): void {
  try {
    if (pref === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    /* özel pencere / engelli depolama: tercih yalnız bu oturumda geçerli */
  }
}

/**
 * <head> içinde boyamadan önce çalışan satır içi betik (titremeyi önler).
 * Depolama okunamazsa sessizce sistem tercihine düşer.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;
