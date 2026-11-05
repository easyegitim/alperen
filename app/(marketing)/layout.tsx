import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ThemeToggle } from "@/components/app/ThemeToggle";
import { LegalLinks } from "@/components/marketing/LegalLinks";
import { StartAnalysisButton } from "@/components/marketing/StartAnalysisButton";
import { APP_NAME } from "@/lib/config/app";

export default async function MarketingLayout({ children }: LayoutProps<"/">) {
  const t = await getTranslations();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/75 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-2 px-4">
          <Link href="/" className="-mx-1 flex min-h-11 items-center gap-2 rounded-lg px-1 text-lg font-bold tracking-tight">
            <span className="size-5 rounded-full bg-brand-gradient shadow-glow" aria-hidden="true" />
            {APP_NAME}
          </Link>
          <nav className="flex items-center gap-0.5" aria-label="Üst menü">
            <Link
              href="/fiyatlar"
              className="flex min-h-11 items-center rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("nav.pricing")}
            </Link>
            <ThemeToggle />
            <StartAnalysisButton className="ml-1 px-3.5 text-[13px]" />
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border/60">
        <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-8">
          <Link href="/" className="inline-flex items-center gap-2 text-base font-bold tracking-tight">
            <span className="size-4 rounded-full bg-brand-gradient" aria-hidden="true" />
            {APP_NAME}
          </Link>
          <div className="flex flex-wrap items-start gap-x-4">
            <LegalLinks />
            <Link href="/yontem?from=footer" className="inline-flex min-h-11 items-center text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              {t("method.footerLink")}
            </Link>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {t("common.adultOnly")} {t("common.photoNotStored")}
          </p>
          <p className="text-[11px] text-muted-foreground">{t("legal.rights", { year: new Date().getFullYear(), appName: APP_NAME })}</p>
        </div>
      </footer>
    </div>
  );
}
