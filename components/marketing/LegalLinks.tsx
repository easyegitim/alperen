import { useTranslations } from "next-intl";
import Link from "next/link";
import { LEGAL_SLUGS } from "@/lib/consent";

export function LegalLinks({ className }: { className?: string }) {
  const t = useTranslations("legal.links");
  return (
    <nav aria-label="Yasal" className={className}>
      <ul className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
        {LEGAL_SLUGS.map((slug) => (
          <li key={slug}>
            <Link href={`/yasal/${slug}`} className="inline-flex min-h-11 items-center underline-offset-4 hover:text-foreground hover:underline">
              {t(slug)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
