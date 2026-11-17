import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/**
 * İllüstratif önce/sonra (KB P#17, Ç14): gerçek yüz yok, stok fotoğraf yerine nötr çizgi figür (yer tutucu;
 * stok görsel gelince aynı bileşen src alır). Cinsiyete göre figür; yaş bandı yalnız 18 altı için 18–24 görünümü
 * (Ç14) — figür tüm bantlarda yetişkin çizilir. "İllüstratif" etiketi her zaman görünür.
 */
export type Presentation = "male" | "female" | "unspecified";

export function illustrationVariant(presentation: Presentation | null | undefined, ageBand: string | null | undefined): { figure: Presentation; adultYoung: boolean } {
  const figure: Presentation = presentation === "male" || presentation === "female" ? presentation : "unspecified";
  // 18 altı seçen kullanıcıya 18–24 görünen yetişkin figür (Ç14); diğer bantlar kendi görünümünde (yer tutucu: tek yetişkin figür).
  return { figure, adultYoung: ageBand === "under_18" || ageBand === "18_24" };
}

function Figure({ figure, after }: { figure: Presentation; after: boolean }) {
  const hairLong = figure === "female";
  const beard = figure === "male";
  return (
    <svg viewBox="0 0 120 150" className="h-full w-full" aria-hidden="true" focusable="false">
      {/* omuzlar */}
      <path d="M12 150 C 18 118, 40 112, 60 112 C 80 112, 102 118, 108 150 Z" className="fill-brand-soft" />
      {/* boyun */}
      <rect x="50" y="92" width="20" height="24" rx="6" className="fill-muted-foreground/25" />
      {/* uzun saç arka */}
      {hairLong ? <path d={after ? "M30 60 C 26 100, 30 118, 36 124 L 84 124 C 90 118, 94 100, 90 60 Z" : "M28 60 C 20 100, 34 122, 30 128 L 92 126 C 88 118, 100 100, 92 60 Z"} className="fill-muted-foreground/45" /> : null}
      {/* yüz */}
      <ellipse cx="60" cy="62" rx="30" ry="36" className="fill-card stroke-muted-foreground/40" strokeWidth="2" />
      {/* saç ön */}
      {hairLong ? (
        <path d={after ? "M30 58 C 32 28, 88 28, 90 58 C 80 44, 74 40, 60 40 C 46 40, 40 44, 30 58 Z" : "M28 60 C 30 24, 90 26, 92 60 C 84 40, 70 36, 62 44 C 50 34, 40 42, 28 60 Z"} className="fill-muted-foreground/60" />
      ) : after ? (
        <path d="M30 56 C 32 30, 88 30, 90 56 C 82 46, 70 42, 60 42 C 50 42, 38 46, 30 56 Z" className="fill-muted-foreground/60" />
      ) : (
        <path d="M28 58 C 26 26, 94 24, 92 58 C 86 44, 78 40, 70 48 C 60 36, 44 40, 28 58 Z" className="fill-muted-foreground/55" />
      )}
      {!after && !hairLong ? <path d="M34 40 l-6 -8 M48 34 l-3 -9 M74 34 l4 -9 M88 42 l7 -7" className="stroke-muted-foreground/55" strokeWidth="2" strokeLinecap="round" /> : null}
      {/* kaşlar */}
      <path d={after ? "M42 54 q8 -4 16 0 M62 54 q8 -4 16 0" : "M40 54 q9 -2 18 1 M62 55 q9 -3 18 -1"} className="stroke-muted-foreground/70" strokeWidth={after ? 2.5 : 3} strokeLinecap="round" fill="none" />
      {/* gözler */}
      <circle cx="49" cy="62" r="2.5" className="fill-muted-foreground/70" />
      <circle cx="71" cy="62" r="2.5" className="fill-muted-foreground/70" />
      {/* burun ve ağız */}
      <path d="M60 64 q-3 10 2 12" className="stroke-muted-foreground/45" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <path d={after ? "M50 84 q10 7 20 0" : "M51 85 q9 2 18 0"} className="stroke-muted-foreground/60" strokeWidth="2" strokeLinecap="round" fill="none" />
      {/* sakal */}
      {beard ? (
        after ? (
          <path d="M33 70 C 36 96, 84 96, 87 70 C 84 92, 36 92, 33 70 Z" className="fill-muted-foreground/45" />
        ) : (
          <g className="stroke-muted-foreground/50" strokeWidth="1.5" strokeLinecap="round">
            <path d="M36 74 l-2 6 M42 86 l-1 6 M52 94 l0 6 M68 94 l0 6 M78 86 l1 6 M84 74 l2 6 M46 90 l-2 5 M74 90 l2 5" />
          </g>
        )
      ) : null}
      {/* cilt ışıltısı (sonra) */}
      {after ? <path d="M40 48 q-4 10 0 20" className="stroke-brand/50" strokeWidth="1.5" strokeLinecap="round" fill="none" /> : null}
    </svg>
  );
}

export function IllustrativeBeforeAfter({ presentation, ageBand, className }: { presentation?: Presentation | null; ageBand?: string | null; className?: string }) {
  const t = useTranslations("paywall.v2.beforeAfter");
  const tv = useTranslations("paywall.v2");
  const { figure } = illustrationVariant(presentation, ageBand);
  return (
    <figure className={cn("rounded-2xl border bg-card p-3", className)} role="img" aria-label={t("aria")}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[13px] font-semibold">{t("title")}</span>
        <span className="inline-flex h-6 items-center rounded-full bg-muted px-2.5 text-[11px] font-semibold tracking-wide text-muted-foreground">{tv("illustrativeLabel")}</span>
      </div>
      <div className="grid grid-cols-2 gap-2" aria-hidden="true">
        {([false, true] as const).map((after) => (
          <div key={String(after)} className={cn("relative aspect-[4/5] overflow-hidden rounded-xl", after ? "bg-hero-glow" : "bg-muted/60")}>
            <Figure figure={figure} after={after} />
            <span className="absolute bottom-1.5 left-1.5 rounded-md bg-background/85 px-1.5 py-0.5 text-[10px] font-semibold backdrop-blur">{after ? t("after") : t("before")}</span>
          </div>
        ))}
      </div>
      <figcaption className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{t("caption")}</figcaption>
    </figure>
  );
}
