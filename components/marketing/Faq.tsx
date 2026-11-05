import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";

const ITEMS = ["q1", "q2", "q3", "q4", "q5", "q6"] as const;

export function Faq() {
  const t = useTranslations("faq");
  return (
    <div className="divide-y overflow-hidden rounded-2xl border bg-card shadow-card">
      {ITEMS.map((k) => (
        <details key={k} className="group">
          <summary className="flex min-h-14 cursor-pointer items-center justify-between gap-3 px-4 text-[15px] font-semibold transition-colors hover:bg-accent/50">
            {t(`${k}.q`)}
            <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <p className="px-4 pb-4 text-[13px] leading-relaxed text-muted-foreground">{t(`${k}.a`)}</p>
        </details>
      ))}
    </div>
  );
}
