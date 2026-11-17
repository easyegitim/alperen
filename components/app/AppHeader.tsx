import { UserRound } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ThemeToggle } from "@/components/app/ThemeToggle";
import { APP_NAME } from "@/lib/config/app";

export async function AppHeader() {
  const t = await getTranslations("common");
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/75 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
      <div className="mx-auto flex h-14 w-full max-w-lg items-center justify-between px-4">
        <Link href="/analiz" className="-mx-1 flex min-h-11 items-center gap-2 rounded-lg px-1 text-lg font-bold tracking-tight">
          <span className="size-5 rounded-full bg-brand-gradient shadow-glow" aria-hidden="true" />
          {APP_NAME}
        </Link>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Link
            href="/hesap"
            aria-label={t("account")}
            className="flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <UserRound className="size-5" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </header>
  );
}
