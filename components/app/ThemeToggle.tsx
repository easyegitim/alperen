"use client";

import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";

/**
 * Koyu ↔ açık tema. Koyu varsayılandır (app/layout.tsx). Simge CSS ile seçilir: sunucu ve istemci aynı HTML'i üretir.
 */
export function ThemeToggle() {
  const t = useTranslations("common");
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === "light" ? "dark" : "light")}
      aria-label={t("toggleTheme")}
      className="flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <Sun className="hidden size-5 dark:block" aria-hidden="true" />
      <Moon className="size-5 dark:hidden" aria-hidden="true" />
    </button>
  );
}
