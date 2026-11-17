"use client";

import {
  AlertCircle,
  CalendarDays,
  ChevronDown,
  Droplets,
  Dumbbell,
  ListChecks,
  MessageSquareQuote,
  Moon,
  Palette,
  RefreshCw,
  ScanFace,
  Scissors,
  Shirt,
  Sparkles,
  Stethoscope,
  Sun,
  UserRound,
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { EXERCISES, EXERCISE_SAFETY_TEXT } from "@/content/exercises";
import { HABITS } from "@/content/habits";
import { getPreset } from "@/content/presets";
import { SKIN_STEPS } from "@/content/skin-steps";
import { FeedbackButtons } from "@/components/report/FeedbackButtons";
import { PlanBasis } from "@/components/report/PlanBasis";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { track } from "@/lib/analytics";
import type { CoachReport, ReportPick } from "@/lib/ai/reportSchema";
import { ApiClientError, postJson } from "@/lib/api/client";
import type { BasisChip, PlanSkips, ReportSection } from "@/lib/coach/planBasis";
import { addReportToRoutine } from "@/lib/routine/addFromReport";
import { cn } from "@/lib/utils";
import type { ImproveItem } from "@/lib/score/contract";

type Props = {
  analysisId: string;
  initial: { reportId: string; report: CoachReport; isFallback: boolean } | null;
  expertNetworkEnabled: boolean;
  /** UI spec §7: planın dayandığı anket çipleri (beden/not içermez). */
  basis?: BasisChip[];
  improveFirst?: ImproveItem[] | null;
  skipped?: PlanSkips;
  /** Anket, kayıtlı rapordan sonra güncellendiyse true. */
  basisStale?: boolean;
};

/** /plan/[analysisId] (F09). Rapor yoksa ilk açılışta üretilir (SPEC 9.1). */
export function ReportView({ analysisId, initial, expertNetworkEnabled, basis, improveFirst = null, skipped = {}, basisStale = false }: Props) {
  const t = useTranslations("report");
  const tc = useTranslations("common");
  const [state, setState] = useState<{ reportId: string; report: CoachReport; isFallback: boolean } | null>(initial);
  const [status, setStatus] = useState<"idle" | "generating" | "error">(initial ? "idle" : "generating");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(basisStale);

  async function generate(regenerate = false) {
    setStatus("generating");
    setErrorCode(null);
    try {
      const r = await postJson<{ reportId: string; report: CoachReport; isFallback: boolean }>("/api/reports", { analysisId, regenerate });
      if (!r) throw new Error("empty");
      setState(r);
      setStatus("idle");
      // Yeniden üretilen plan güncel cevaplarla hazırlandı.
      if (regenerate) setStale(false);
      track("report_viewed");
    } catch (e) {
      setErrorCode(e instanceof ApiClientError ? e.code : "NETWORK");
      setStatus("error");
    }
  }

  useEffect(() => {
    // Yalnız ilk açılış: rapor yoksa üret (asenkron; efekt gövdesinde senkron setState yok).
    if (!initial) void Promise.resolve().then(() => generate());
    else track("report_viewed");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnız ilk açılış
  }, []);

  async function addToRoutine() {
    if (!state) return;
    setBusy(true);
    try {
      const n = await addReportToRoutine(state.report, state.report.exercises.length > 0);
      toast.success(n > 0 ? t("addedToRoutine", { n }) : t("alreadyInRoutine"));
    } catch {
      toast.error(t("routineError"));
    } finally {
      setBusy(false);
    }
  }

  if (status === "generating") {
    return (
      <Card className="items-center bg-hero-glow px-6 py-8 text-center" aria-busy="true">
        <span className="grid size-14 place-items-center rounded-2xl bg-brand-soft text-brand" aria-hidden="true">
          <Sparkles className="size-6 motion-safe:animate-pulse" />
        </span>
        <div className="space-y-1.5">
          <h2 className="text-base font-semibold">{t("generatingTitle")}</h2>
          <p className="text-[13px] text-muted-foreground">{t("generatingBody")}</p>
        </div>
        <div className="w-full space-y-2" aria-hidden="true">
          {["w-full", "w-4/5", "w-3/5"].map((w) => (
            <div key={w} className={cn("h-2.5 rounded-full bg-track motion-safe:animate-pulse", w)} />
          ))}
        </div>
      </Card>
    );
  }
  if (status === "error" || !state) {
    return (
      <Card className="items-center bg-hero-glow px-6 py-8 text-center">
        <span className="grid size-14 place-items-center rounded-2xl bg-warn/12 text-warn" aria-hidden="true">
          <AlertCircle className="size-6" />
        </span>
        <div className="space-y-1.5">
          <h2 className="text-base font-semibold">{t("errorTitle")}</h2>
          <p className="text-[13px] text-muted-foreground">{errorCode && t.has(`errors.${errorCode}`) ? t(`errors.${errorCode}`) : t("errors.GENERIC")}</p>
        </div>
        {errorCode === "PREMIUM_REQUIRED" ? (
          <Button asChild className="w-full">
            <Link href={`/premium?analysis=${analysisId}`}>{t("goPremium")}</Link>
          </Button>
        ) : (
          <Button className="w-full" onClick={() => generate()}>
            <RefreshCw aria-hidden="true" />
            {t("retry")}
          </Button>
        )}
      </Card>
    );
  }

  const r = state.report;
  const rendered = new Set<ReportSection>(["skin"]);
  if (r.hair.length) rendered.add("hair");
  if (r.beard.length) rendered.add("beard");
  const { lead, rest } = splitLead(r.summary);
  // Atlama çipleri: yalnız ekranda olan bölümler, sayfadaki sırayla.
  const nav: { id: string; label: string }[] = [
    ...(r.hair.length ? [{ id: "hair", label: t("sections.hair") }] : []),
    ...(r.beard.length ? [{ id: "beard", label: t("sections.beard") }] : []),
    ...(r.hairColor ? [{ id: "color", label: t("sections.color") }] : []),
    { id: "skin", label: t("sections.skin") },
    ...(r.faceContours.enabled && r.faceContours.tips.length ? [{ id: "contours", label: t("sections.contours") }] : []),
    ...(r.exercises.length ? [{ id: "exercises", label: t("sections.exercises") }] : []),
    ...(r.habits.length ? [{ id: "habits", label: t("sections.habits") }] : []),
    ...(r.style.length ? [{ id: "style", label: t("sections.style") }] : []),
  ];
  return (
    <div className="space-y-3">
      <nav aria-label={t("jumpNav")} className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-30 -mx-4 border-b border-border/60 bg-background/85 backdrop-blur-xl">
        <ul className="flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]">
          {nav.map((n) => (
            <li key={n.id} className="shrink-0">
              <a href={`#section-${n.id}`} className="group inline-flex min-h-11 items-center">
                <span className="inline-flex h-8 items-center rounded-full border bg-card px-3 text-[13px] font-medium whitespace-nowrap transition-colors group-hover:bg-accent">
                  {n.label}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {state.isFallback ? <Notice>{t("fallbackNote")}</Notice> : null}

      <Section id="summary" title={t("sections.summary")} icon={<Sparkles className="size-4" />} feature>
        <p className="text-[15px] leading-relaxed font-medium">{lead}</p>
        {rest || r.scoreNarrative ? (
          <Details label={tc("details")}>
            {rest ? <p>{rest}</p> : null}
            {r.scoreNarrative ? <p>{r.scoreNarrative}</p> : null}
          </Details>
        ) : null}
      </Section>

      {basis ? <PlanBasis analysisId={analysisId} basis={basis} improveFirst={improveFirst} rendered={rendered} stale={stale} /> : null}

      {r.hair.length ? (
        <Section id="hair" title={t("sections.hair")} icon={<Scissors className="size-4" />}>
          {r.hair.map((p) => <PickCard key={p.presetId} pick={p} />)}
        </Section>
      ) : skipped.hair ? (
        <Notice>{t("basis.skipped.hair")}</Notice>
      ) : null}
      {r.beard.length ? (
        <Section id="beard" title={t("sections.beard")} icon={<UserRound className="size-4" />}>
          {r.beard.map((p) => <PickCard key={p.presetId} pick={p} />)}
        </Section>
      ) : skipped.beard ? (
        <Notice>{t("basis.skipped.beard")}</Notice>
      ) : null}
      {r.hairColor ? (
        <Section id="color" title={t("sections.color")} icon={<Palette className="size-4" />}>
          <PickCard pick={r.hairColor} />
        </Section>
      ) : null}

      <Section id="skin" title={t("sections.skin")} icon={<Droplets className="size-4" />}>
        {(["morning", "evening", "weekly"] as const).map((slot) =>
          r.skincare[slot].length ? (
            <div key={slot} className="space-y-2">
              <h3 className="eyebrow flex items-center gap-1.5">
                {slot === "morning" ? <Sun className="size-3.5" aria-hidden="true" /> : slot === "evening" ? <Moon className="size-3.5" aria-hidden="true" /> : <CalendarDays className="size-3.5" aria-hidden="true" />}
                {t(`slots.${slot}`)}
              </h3>
              <ol className="divide-y divide-border/60 rounded-xl bg-muted/60">
                {r.skincare[slot].map((s, i) => {
                  const def = SKIN_STEPS.find((x) => x.id === s.stepType);
                  return (
                    <li key={`${s.stepType}-${i}`} className="flex gap-3 px-3 py-2.5">
                      <span className="num mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-brand-soft text-[10px] font-bold text-brand" aria-hidden="true">
                        {i + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{def?.nameTr ?? s.stepType}</span>
                        <span className="block text-[13px] text-muted-foreground">{s.note}</span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : null,
        )}
      </Section>

      {r.faceContours.enabled && r.faceContours.tips.length ? (
        <Section id="contours" title={t("sections.contours")} icon={<ScanFace className="size-4" />}>
          <Bullets items={r.faceContours.tips} />
        </Section>
      ) : null}

      {r.exercises.length ? (
        <Section id="exercises" title={t("sections.exercises")} icon={<Dumbbell className="size-4" />}>
          <ul className="space-y-2">
            {r.exercises.map((e) => {
              const def = EXERCISES.find((x) => x.id === e.id);
              return (
                <li key={e.id} className="space-y-1.5 rounded-xl bg-muted/60 p-3">
                  <p className="text-sm font-semibold">{def?.nameTr ?? e.id}</p>
                  {def?.doseTr ? (
                    <span className="inline-flex rounded-full bg-brand-soft px-2.5 py-0.5 text-[11px] font-semibold text-brand">{def.doseTr}</span>
                  ) : null}
                  <p className="text-[13px] text-muted-foreground">{e.why}</p>
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] leading-relaxed text-muted-foreground">{EXERCISE_SAFETY_TEXT}</p>
        </Section>
      ) : skipped.exercises ? (
        <Notice>{t("basis.skipped.exercises")}</Notice>
      ) : null}

      {r.habits.length ? (
        <Section id="habits" title={t("sections.habits")} icon={<ListChecks className="size-4" />}>
          <ul className="divide-y divide-border/60 rounded-xl bg-muted/60">
            {r.habits.map((h) => (
              <li key={h.id} className="px-3 py-2.5">
                <span className="block text-sm font-semibold">{HABITS.find((x) => x.id === h.id)?.nameTr ?? h.id}</span>
                <span className="block text-[13px] text-muted-foreground">{h.target}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {r.style.length ? (
        <Section id="style" title={t("sections.style")} icon={<Shirt className="size-4" />}>
          <Bullets items={r.style} />
        </Section>
      ) : null}

      {r.seeProfessional ? (
        <section className="flex gap-3 rounded-2xl border border-dashed p-4">
          <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-warn/12 text-warn" aria-hidden="true">
            <Stethoscope className="size-4" />
          </span>
          <div className="min-w-0 flex-1 space-y-2">
            <h2 className="text-[15px] font-semibold">{t("sections.professional")}</h2>
            <p className="text-[13px] leading-relaxed text-muted-foreground">{r.seeProfessional.text}</p>
            {expertNetworkEnabled ? (
              <Button asChild variant="outline" className="w-full">
                <Link href={`/uzman?alan=${encodeURIComponent(r.seeProfessional.specialty)}`}>{t("findExpert")}</Link>
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="rounded-2xl border bg-card px-4 py-1 shadow-card">
        <FeedbackButtons targetType="report" targetId={state.reportId} compact />
      </div>

      <div className="grid gap-2 pt-2">
        <Button size="lg" onClick={addToRoutine} disabled={busy}>
          <ListChecks aria-hidden="true" />
          {t("addToRoutine")}
        </Button>
        <Button variant="ghost" onClick={() => generate(true)} disabled={busy}>
          <RefreshCw aria-hidden="true" />
          {t("regenerate")}
        </Button>
      </div>
      <p className="text-center text-[11px] text-muted-foreground">{tc("notMedicalAdvice")}</p>
    </div>
  );
}

/** Özet: ilk cümle görünür (kısaysa iki cümle), kalanı "Ayrıntılar" altına. */
function splitLead(text: string): { lead: string; rest: string } {
  const parts = text.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g)?.map((x) => x.trim()) ?? [text];
  let n = 1;
  if (parts[0] && parts[0].length < 70 && parts.length > 2) n = 2;
  return { lead: parts.slice(0, n).join(" "), rest: parts.slice(n).join(" ") };
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl border border-dashed px-4 py-3 text-xs leading-relaxed text-muted-foreground">{children}</p>;
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2">
      {items.map((text, i) => (
        <li key={i} className="flex gap-2.5 text-sm leading-relaxed">
          <span className="mt-[0.5rem] size-1.5 shrink-0 rounded-full bg-brand-gradient" aria-hidden="true" />
          <span>{text}</span>
        </li>
      ))}
    </ul>
  );
}

function Details({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="group">
      <summary className="-mx-1 inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-lg px-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        {label}
        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="space-y-2 pb-1 text-[13px] leading-relaxed text-muted-foreground">{children}</div>
    </details>
  );
}

function Section({
  id,
  title,
  icon,
  feature = false,
  children,
}: {
  id: string;
  title: string;
  icon: React.ReactNode;
  feature?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card id={`section-${id}`} className={cn("scroll-mt-32", feature && "border-brand-gradient bg-hero-glow")}>
      <CardHeader>
        <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
          <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand" aria-hidden="true">
            {icon}
          </span>
          {title}
        </h2>
      </CardHeader>
      <CardContent className="space-y-3">
        {children}
      </CardContent>
    </Card>
  );
}

function PickCard({ pick }: { pick: ReportPick }) {
  const t = useTranslations("report");
  const tc = useTranslations("common");
  const preset = getPreset(pick.presetId);
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2 rounded-xl border bg-muted/40 px-4 pt-3.5 pb-1">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[15px] font-semibold">{preset?.nameTr ?? pick.presetId}</p>
        {/* İkincil eylemler: sayfadaki tek gradyan CTA "Rutinime ekle" kalır. */}
        <Button asChild variant="outline" size="sm" className="h-11 rounded-full px-3.5 text-brand">
          <Link href={`/dene?preset=${pick.presetId}`}>
            <Scissors aria-hidden="true" /> {t("tryIt")}
          </Link>
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <Details label={tc("details")}>
          <p>{pick.why}</p>
        </Details>
        <Button variant="ghost" size="sm" className="-mr-2 h-11 text-[13px]" onClick={() => setOpen(true)}>
          <MessageSquareQuote aria-hidden="true" />
          {t("showBarber")}
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{preset?.nameTr ?? pick.presetId}</DialogTitle>
            <DialogDescription>{t("barberHint")}</DialogDescription>
          </DialogHeader>
          <p className="rounded-xl bg-muted p-4 text-lg leading-relaxed">{pick.barberScript}</p>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">{t("maintenance")}:</span> {pick.maintenance}
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
