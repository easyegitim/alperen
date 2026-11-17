"use client";

import { CalendarCheck, ClipboardList, ScanFace, Scissors, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/analiz", key: "analysis", Icon: ScanFace },
  { href: "/plan", key: "plan", Icon: ClipboardList },
  { href: "/dene", key: "tryon", Icon: Scissors },
  { href: "/rutin", key: "routine", Icon: CalendarCheck },
  { href: "/ilerleme", key: "progress", Icon: TrendingUp },
] as const;

/** Onboarding ve çekim ekranlarında alt gezinme gizlenir. */
const HIDDEN_PREFIXES = ["/baslangic", "/tara", "/premium"];

export function BottomNav() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return null;

  return (
    <nav
      aria-label="Ana gezinme"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/80 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {ITEMS.map(({ href, key, Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                    active ? "bg-brand-soft text-brand" : "group-hover:bg-accent",
                  )}
                >
                  <Icon className="size-5" strokeWidth={active ? 2.25 : 1.75} aria-hidden="true" />
                </span>
                {t(key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
