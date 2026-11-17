import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Cpu, Database, FileText, Gauge, ListOrdered, Scale, TriangleAlert, Layers } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { KindBadge } from "@/components/analysis/SubscoreList";
import { MethodViewTracker } from "@/components/marketing/MethodViewTracker";
import { getPublicEngineInfo } from "@/lib/ai/disclosure.server";
import { FAIRNESS_LAST_RUN, parseMethodFrom } from "@/lib/config/method";
import { CALIBRATION_REFERENCE, SUB_KIND_HYBRID } from "@/lib/config/scoring";
import { SUB_KEYS, type SubKeyV1 } from "@/lib/config/teaser";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("method");
  return { title: t("metaTitle"), description: t("metaDescription") };
}

/** Yapısal alanlar cihazdaki geometriden, geliştirilebilir alanlar görünür ayrıntı kategorilerinden (UI spec §5.2, C2). */
const SOURCE: Record<SubKeyV1, "device" | "ai"> = { harmony: "device", eyes: "device", jawline: "device", skin: "ai", hair: "ai", grooming: "ai" };
const DATA_KEYS = ["landmarks", "geometry", "photo", "tryon", "progress", "analytics"] as const;
const LIMIT_KEYS = ["l1", "l2", "l3", "l4", "l5", "l6"] as const;

/** "Yüz noktaları: yalnız telefonunda kalır." → terim ve açıklama (dl için). İki nokta yoksa tümü terimdir. */
function splitTerm(text: string): [string, string | null] {
  const i = text.indexOf(": ");
  return i > 0 ? [text.slice(0, i), text.slice(i + 2)] : [text, null];
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat("tr-TR", { dateStyle: "long" }).format(d);
}

/**
 * /yontem (F01): skorun yöntemi. Herkese açık, her zaman 200; kullanıcı verisi ve sayısal eşik/aralık göstermez.
 * Sağlayıcı adları FEATURE_PROVIDER_NAMES kapalıyken nötr "yapay zekâ" olarak gelir (getPublicEngineInfo).
 */
export default async function MethodPage({ searchParams }: PageProps<"/yontem">) {
  const { from } = await searchParams;
  const [t, ta, tl] = await Promise.all([getTranslations("method"), getTranslations("analysis"), getTranslations("legal.links")]);
  const info = getPublicEngineInfo();
  const ref = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(CALIBRATION_REFERENCE);

  const retention = t("data.retention");
  const linkLabel = tl("aydinlatma");
  const at = retention.indexOf(linkLabel);
  const aydinlatma = (label: string) => (
    <Link href="/yasal/aydinlatma" className="font-semibold text-brand underline underline-offset-4">
      {label}
    </Link>
  );

  return (
    <div className="relative overflow-x-clip">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-80 bg-hero-glow" aria-hidden="true" />
      <article className="mx-auto w-full max-w-3xl space-y-3 px-4 pt-8 pb-14">
        <MethodViewTracker from={parseMethodFrom(from)} />
        <header className="space-y-3 pb-3">
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
          {info.engine === "legacy" ? (
            <p className="flex gap-3 rounded-2xl border border-dashed p-4 text-[13px] text-muted-foreground">{t("legacyNote")}</p>
          ) : null}
        </header>

        <Section id="summary" title={t("summaryTitle")} icon={<Gauge className="size-4" />}>
          <p>{t("summary")}</p>
        </Section>

        <Section id="steps" title={t("stepsTitle")} icon={<ListOrdered className="size-4" />}>
          <ol className="space-y-2.5">
            {[
              t("steps.s1"),
              t("steps.s2"),
              t("steps.s3", { provider: info.analysisProvider }),
              ...(info.structuralSharePct !== null ? [t("steps.s4", { structuralShare: info.structuralSharePct })] : []),
              t("steps.s5"),
            ].map((text, i) => (
              <li key={i} className="flex gap-3">
                <span className="num mt-px grid size-6 shrink-0 place-items-center rounded-full bg-cta-gradient text-[11px] font-bold text-primary-foreground" aria-hidden="true">
                  {i + 1}
                </span>
                <span>{text}</span>
              </li>
            ))}
          </ol>
        </Section>

        <Section id="subs" title={t("subsTitle")} icon={<Layers className="size-4" />}>
          <table className="hidden w-full border-collapse text-left text-sm sm:table">
            <thead>
              <tr className="border-b">
                <th scope="col" className="py-2 pr-4 text-xs font-medium text-muted-foreground">{t("subsColumns.name")}</th>
                <th scope="col" className="py-2 pr-4 text-xs font-medium text-muted-foreground">{t("subsColumns.source")}</th>
                <th scope="col" className="py-2 text-xs font-medium text-muted-foreground">{t("subsColumns.kind")}</th>
              </tr>
            </thead>
            <tbody>
              {SUB_KEYS.map((k) => (
                <tr key={k} className="border-b last:border-0">
                  <th scope="row" className="py-2.5 pr-4 font-semibold">{ta(`sub.${k}`)}</th>
                  <td className="py-2.5 pr-4 text-muted-foreground">{t(`source.${SOURCE[k]}`)}</td>
                  <td className="py-2.5">
                    <KindBadge kind={SUB_KIND_HYBRID[k]} label={ta(`kind.${SUB_KIND_HYBRID[k]}`)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="space-y-2 sm:hidden">
            {SUB_KEYS.map((k) => (
              <dl key={k} className="flex items-center gap-3 rounded-xl bg-muted/60 px-3 py-2.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand" aria-hidden="true">
                  {SOURCE[k] === "device" ? <Cpu className="size-4" /> : <Gauge className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <dt className="sr-only">{t("subsColumns.name")}</dt>
                  <dd className="text-[15px] font-semibold">{ta(`sub.${k}`)}</dd>
                  <dt className="sr-only">{t("subsColumns.source")}</dt>
                  <dd className="text-xs text-muted-foreground">{t(`source.${SOURCE[k]}`)}</dd>
                </div>
                <dt className="sr-only">{t("subsColumns.kind")}</dt>
                <dd className="shrink-0">
                  <KindBadge kind={SUB_KIND_HYBRID[k]} label={ta(`kind.${SUB_KIND_HYBRID[k]}`)} />
                </dd>
              </dl>
            ))}
          </div>
        </Section>

        <Section id="data" title={t("dataTitle")} icon={<Database className="size-4" />}>
          <dl className="space-y-2">
            {DATA_KEYS.map((k) => {
              const [term, desc] = splitTerm(t(`data.${k}`, { provider: info.analysisProvider, tryonProvider: info.tryonProvider }));
              return (
                <div key={k} className="rounded-xl bg-muted/60 px-3 py-2.5">
                  <dt className="text-[13px] font-semibold">{term}</dt>
                  {desc ? <dd className="text-[13px] text-muted-foreground">{desc}</dd> : null}
                </div>
              );
            })}
          </dl>
          <p className="text-muted-foreground">
            {at >= 0 ? (
              <>
                {retention.slice(0, at)}
                {aydinlatma(linkLabel)}
                {retention.slice(at + linkLabel.length)}
              </>
            ) : (
              <>
                {retention} {aydinlatma(linkLabel)}
              </>
            )}
          </p>
        </Section>

        <Section id="fairness" title={t("fairnessTitle")} icon={<Scale className="size-4" />}>
          <Bullets items={[t("fairness.f1"), t("fairness.f2"), t("fairness.f3")]} />
          {FAIRNESS_LAST_RUN ? <p className="text-xs text-muted-foreground">{t("fairness.lastRun", { date: formatDate(FAIRNESS_LAST_RUN) })}</p> : null}
        </Section>

        <Section id="limits" title={t("limitsTitle")} icon={<TriangleAlert className="size-4" />}>
          <Bullets items={LIMIT_KEYS.map((k) => (k === "l3" ? t("limits.l3", { ref }) : t(`limits.${k}`)))} />
        </Section>

        <Section id="version" title={t("versionTitle")} icon={<FileText className="size-4" />}>
          <p className="text-muted-foreground">{t("version", { engine: info.engine, calibration: info.calibrationVersion })}</p>
        </Section>
      </article>
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2">
      {items.map((text, i) => (
        <li key={i} className="flex gap-2.5">
          <span className="mt-[0.45rem] size-1.5 shrink-0 rounded-full bg-brand-gradient" aria-hidden="true" />
          <span>{text}</span>
        </li>
      ))}
    </ul>
  );
}

function Section({ id, title, icon, children }: { id: string; title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={`method-${id}`} className="space-y-4 rounded-2xl border bg-card p-5 text-sm leading-relaxed shadow-card">
      <h2 id={`method-${id}`} className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand" aria-hidden="true">
          {icon}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}
