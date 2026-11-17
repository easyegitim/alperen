import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { CookieBanner } from "@/components/legal/CookieBanner";
import { AnalyticsProvider } from "@/components/providers/AnalyticsProvider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { APP_NAME, APP_URL } from "@/lib/config/app";
import { getLegalVersion } from "@/lib/legal/docs";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: "Skorunu öğren, potansiyelini gör, planla yükselt. 18+ için AI görünüm analizi ve bakım koçu.",
  applicationName: APP_NAME,
  appleWebApp: { capable: true, statusBarStyle: "default", title: APP_NAME },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Varsayılan koyu tema; açık tema seçilince ThemeProvider (ThemeColorSync) meta etiketini günceller.
  themeColor: "#0b0b12",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [locale, cookieTextVersion] = await Promise.all([getLocale(), getLegalVersion("cerez")]);
  return (
    <html lang={locale} suppressHydrationWarning className="h-full">
      <body className="flex min-h-full flex-col">
        {/* Koyu varsayılan (F08 "koyu, cesur"); açık tema başlıktaki düğmeyle seçilir ve localStorage "theme" anahtarında kalır. */}
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
          <NextIntlClientProvider>
            {children}
            <CookieBanner cookieTextVersion={cookieTextVersion} />
            <AnalyticsProvider />
            <Toaster position="top-center" richColors />
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
