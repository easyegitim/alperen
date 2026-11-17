import { ArrowUpRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { ScoreRing } from "@/components/analysis/ScoreRing";

/** Örnek değerler: gerçek bir kullanıcıya ait değildir (SPEC F01). */
const SAMPLE = {
  overall: 6.4,
  potential: 7.6,
  subs: [
    { key: "skin", value: 5.9 },
    { key: "hair", value: 6.8 },
    { key: "jawline", value: 6.1 },
  ] as const,
};

const fmt = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Soyut yüz illüstrasyonu (gerçek yüz yok). */
function FaceGlyph() {
  return (
    <svg viewBox="0 0 120 120" className="size-full" aria-hidden="true">
      <ellipse cx="60" cy="56" rx="26" ry="33" fill="none" stroke="currentColor" strokeWidth="4" />
      <path d="M33 47c8-17 46-17 54 0" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <path d="M18 116c6-20 22-30 42-30s36 10 42 30" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

/** Açılıştaki örnek sonuç kartı. Sonuç ekranının görsel dilini tekrarlar; gerçek yüz yok, soyut illüstrasyon (SPEC F01). */
export function SampleResultCard() {
  const t = useTranslations("landing.sampleCard");
  return (
    <figure
      className="border-brand-gradient relative mx-auto w-full max-w-sm overflow-hidden rounded-3xl p-5 shadow-card"
      aria-label={t("badge")}
    >
      <div className="pointer-events-none absolute inset-0 bg-hero-glow" aria-hidden="true" />
      <div className="relative space-y-5">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-muted px-2.5 text-[11px] font-medium">
            <span className="size-1.5 rounded-full bg-brand" aria-hidden="true" />
            {t("badge")}
          </span>
          <span className="grid size-10 place-items-center rounded-full bg-muted p-2 text-muted-foreground">
            <FaceGlyph />
          </span>
        </div>

        <div className="flex items-center gap-5">
          <ScoreRing value={SAMPLE.overall} size={128} stroke={11}>
            <span className="num text-brand-gradient text-4xl font-bold">{fmt(SAMPLE.overall)}</span>
            <span className="text-[11px] text-muted-foreground">/10</span>
          </ScoreRing>
          <div className="min-w-0 space-y-2">
            <p className="eyebrow">{t("overallLabel")}</p>
            <p className="border-brand-gradient inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold">
              <ArrowUpRight className="size-3.5 text-brand" aria-hidden="true" />
              {t("potentialLabel")} <span className="num">{fmt(SAMPLE.potential)}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              <span className="num text-brand-gradient text-sm font-bold">+{fmt(SAMPLE.potential - SAMPLE.overall)}</span> {t("gainNote")}
            </p>
          </div>
        </div>

        <ul className="space-y-3.5">
          {SAMPLE.subs.map((s) => (
            <li key={s.key} className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] font-semibold">{t(`sub.${s.key}`)}</span>
                <span className="num text-base font-bold">{fmt(s.value)}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-track" role="presentation">
                <div className="h-full origin-left rounded-full bg-brand-gradient motion-safe:animate-grow-x" style={{ width: `${s.value * 10}%` }} />
              </div>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-muted-foreground">{t("illustrationNote")}</p>
      </div>
    </figure>
  );
}
