"use client";

import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { useEffect, type ComponentProps } from "react";

/** Tarayıcı/PWA durum çubuğu rengi = sayfa zemini (--background). Değerler app/globals.css ile aynı tutulur. */
export const THEME_COLOR = { light: "#f6f6fa", dark: "#0b0b12" } as const;

/**
 * Tema seçimi sisteme değil düğmeye bağlı olduğundan (enableSystem=false) meta[name=theme-color]
 * medya sorgusuyla değil, seçilen temayla güncellenir.
 */
function ThemeColorSync() {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    const color = resolvedTheme === "light" ? THEME_COLOR.light : THEME_COLOR.dark;
    const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
    if (metas.length === 0) {
      const m = document.createElement("meta");
      m.name = "theme-color";
      m.content = color;
      document.head.appendChild(m);
      return;
    }
    metas.forEach((m) => {
      m.content = color;
      m.removeAttribute("media");
    });
  }, [resolvedTheme]);
  return null;
}

/**
 * Not (yalnız geliştirme): React 19 + next-themes 0.4.6 (son sürüm) her sayfada
 * "Encountered a script tag while rendering React component" uyarısı basar. Satır içi tema betiği
 * sunucu HTML'inde doğru çalışır (FOUC yok); uyarı üretim derlemesinde görünmez. next-themes güncellenince yeniden bakılacak.
 */
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider {...props}>
      <ThemeColorSync />
      {children}
    </NextThemesProvider>
  );
}
