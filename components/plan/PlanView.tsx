"use client";

import { AlertCircle, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeTr } from "@/lib/ai/safety";
import { BasisChips } from "@/components/plan/BasisChips";
import { DoctorLayer } from "@/components/plan/DoctorLayer";
import { HairLossCard } from "@/components/plan/HairLossCard";
import { PlanPhases } from "@/components/plan/PlanPhases";
import { PriorityTable } from "@/components/plan/PriorityTable";
import { StepCard, type StepLink } from "@/components/plan/StepCard";
import { FeedbackButtons } from "@/components/report/FeedbackButtons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { track } from "@/lib/analytics";
import { ApiClientError, postJson } from "@/lib/api/client";
import type { PlanViewV2 } from "@/lib/coach/planTypes";
import { PLAN_AREAS, type PlanArea } from "@/lib/config/plan";
import { cn } from "@/lib/utils";

export type PlanPayload = { view: PlanViewV2; hairLossSignal: "none" | "possible" | "visible" | "not_visible" | null };

type Props = {
  analysisId: string;
  reportId: string | null;
  initial: PlanPayload | null;
  expertNetworkEnabled: boolean;
  doctorLayerEnabled: boolean;
  glowUpEnabled: boolean;
  /** Yalnız FEATURE_PRODUCT_LINKS açıkken dolu (sunucu); "Reklam" etiketi kartta. */
  links?: Record<string, StepLink[]>;
};

/** Sekme sırası (KB §6.1 mock-up): Saç · Sakal · Saç rengi · Cilt · Egzersizler; sonra kaş, alışkanlık, stil (varsa). */
const TAB_ORDER: PlanArea[] = ["hair", "beard", "color", "skin", "exercise", "brows", "habit", "style"];

/** Saç derisi adımı var mı (saç dökülmesi kartı yalnız o zaman "plana eklendi" der). */
const SCALP_RE = /scalp|hair_wash/;
const hasScalpStepIn = (steps: readonly { id: string; title: string }[]) => steps.some((s) => SCALP_RE.test(s.id) || normalizeTr(s.title).includes("sac derisi"));

/**
 * /plan/[analysisId] v2 (PLAN 4d): plan yoksa ilk açılışta üretilir (POST /api/plan); sunucu hak ve kilit kurallarını uygular.
 * Yeniden üretim mevcut planı ekrandan kaldırmaz: hata düğmenin altında gösterilir (QUOTA_EXCEEDED: cevaplar değişmediyse
 * mevcut plan geçerli). Tam sayfa "üretiliyor/hata" kartı yalnız plan yokken.
 */
export function PlanView({ analysisId, reportId, initial, expertNetworkEnabled, doctorLayerEnabled, glowUpEnabled, links = {} }: Props) {
  const t = useTranslations("plan.v2");
  const [data, setData] = useState<PlanPayload | null>(initial);
  const [status, setStatus] = useState<"idle" | "generating" | "error">(initial ? "idle" : "generating");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [regen, setRegen] = useState<{ busy: boolean; errorCode: string | null }>({ busy: false, errorCode: null });
  const [stale, setStale] = useState(initial?.view.basisStale ?? false);
  const [tab, setTab] = useState<string>("all");
  const jumpRef = useRef<string | null>(null);

  async function generate(regenerate = false) {
    const inline = regenerate && data !== null;
    if (inline) setRegen({ busy: true, errorCode: null });
    else {
      setStatus("generating");
      setErrorCode(null);
    }
    try {
      const r = await postJson<PlanPayload & { created: boolean }>("/api/plan", { analysisId, regenerate });
      if (!r) throw new Error("empty");
      setData({ view: r.view, hairLossSignal: r.hairLossSignal });
      setStale(r.view.basisStale);
      setStatus("idle");
      setRegen({ busy: false, errorCode: null });
      track("plan_viewed");
    } catch (e) {
      const code = e instanceof ApiClientError ? e.code : "NETWORK";
      if (inline) setRegen({ busy: false, errorCode: code });
      else {
        setErrorCode(code);
        setStatus("error");
      }
    }
  }

  useEffect(() => {
    if (!initial) void Promise.resolve().then(() => generate());
    else track("plan_viewed");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnız ilk açılış
  }, []);

  // Öncelik tablosu / faz çipi → "Tümü" sekmesi + kart (kart yalnız o sekmede çizilir; Radix pasif paneli kaldırır).
  const scrollToStep = (stepId: string) => document.getElementById(`step-${stepId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  useEffect(() => {
    if (tab !== "all" || !jumpRef.current) return;
    const id = jumpRef.current;
    jumpRef.current = null;
    scrollToStep(id);
  }, [tab]);
  const jump = (stepId: string) => {
    if (tab === "all") {
      scrollToStep(stepId);
      return;
    }
    jumpRef.current = stepId;
    setTab("all");
  };

  const plan = data?.view.plan ?? null;
  const areas = useMemo(() => {
    const present = new Set(plan?.steps.map((s) => s.area) ?? []);
    return TAB_ORDER.filter((a) => present.has(a));
  }, [plan]);

  if (status === "generating") {
    return (
      <Card className="items-center bg-hero-glow px-6 py-8 text-center" aria-busy="true">
        <span className="grid size-14 place-items-center rounded-2xl bg-brand-soft text-brand" aria-hidden="true">
          <Sparkles className="size-6 motion-safe:animate-pulse" />
        </span>
        <div className="space-y-1.5">
          <h2 className="text-base font-semibold">{t("generating.title")}</h2>
          <p className="text-[13px] text-muted-foreground">{t("generating.body")}</p>
        </div>
        <div className="w-full space-y-2" aria-hidden="true">
          {["w-full", "w-4/5", "w-3/5"].map((w) => (
            <div key={w} className={cn("h-2.5 rounded-full bg-track motion-safe:animate-pulse", w)} />
          ))}
        </div>
      </Card>
    );
  }
  if (status === "error" || !plan || !data) {
    const code = errorCode ?? "GENERIC";
    return (
      <Card className="items-center bg-hero-glow px-6 py-8 text-center">
        <span className="grid size-14 place-items-center rounded-2xl bg-warn/12 text-warn" aria-hidden="true">
          <AlertCircle className="size-6" />
        </span>
        <div className="space-y-1.5">
          <h2 className="text-base font-semibold">{t("errorTitle")}</h2>
          <p className="text-[13px] text-muted-foreground">{t.has(`errors.${code}`) ? t(`errors.${code}`) : t("errors.GENERIC")}</p>
        </div>
        {code === "BAD_INPUT" ? (
          <Button asChild className="w-full">
            <Link href={`/plan/${analysisId}/anket`}>{t("basis.edit")}</Link>
          </Button>
        ) : code === "PREMIUM_REQUIRED" ? (
          <Button asChild className="w-full">
            <Link href={`/premium?analysis=${analysisId}`}>{t("locked")}</Link>
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

  const hairLoss = data.hairLossSignal === "possible" || data.hairLossSignal === "visible" ? data.hairLossSignal : null;
  const exclusionEntries = Object.entries(plan.exclusions) as [keyof typeof plan.exclusions, string][];
  const fallback = plan.disclaimers.includes("deterministicFallback");

  return (
    <div className="space-y-3">
      <p className="text-[13px] leading-relaxed text-muted-foreground">{t("intro")}</p>
      <BasisChips chips={plan.basisChips} analysisId={analysisId} stale={stale} />
      {fallback ? (
        <p role="note" className="rounded-2xl border border-dashed px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          {t("fallbackNote")}
        </p>
      ) : null}

      {exclusionEntries.length ? (
        <ul className="space-y-1.5">
          {exclusionEntries.map(([k, v]) => (
            <li key={k} className="rounded-2xl border border-dashed px-4 py-3 text-xs leading-relaxed text-muted-foreground">
              {t(`exclusions.${k}.${v}`)}
            </li>
          ))}
        </ul>
      ) : null}

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold tracking-tight">{t("title")}</h2>
          <p className="text-[13px] text-muted-foreground">{t("stepCount", { n: plan.steps.length })}</p>
        </CardHeader>
        <CardContent className="space-y-5">
          <PlanPhases phases={plan.phases} steps={plan.steps} onJump={jump} />
          <PriorityTable rows={plan.priorityTable} steps={plan.steps} onJump={jump} />
          <section className="space-y-2">
            <h3 className="eyebrow">{t("layersTitle")}</h3>
            <ul className="grid grid-cols-3 gap-2 text-center text-xs">
              {(["diy", "expert", "doctor"] as const).map((tier) => (
                <li key={tier} className="rounded-xl bg-muted/60 p-2">
                  <span className="block font-semibold">{t(`tiers.${tier}`)}</span>
                  <span className="num block text-muted-foreground">{tier === "doctor" ? data.view.doctor.steps.length : plan.layers[tier].length}</span>
                  <span className="block text-[10px] text-muted-foreground">{t(`tiersHint.${tier}`)}</span>
                </li>
              ))}
            </ul>
          </section>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex h-auto! w-full flex-nowrap justify-start gap-1 overflow-x-auto bg-transparent p-0 [scrollbar-width:none]" aria-label={t("tabsAria")}>
          <TabsTrigger value="all" className="h-9 shrink-0 rounded-full border bg-card px-3 data-[state=active]:border-brand data-[state=active]:bg-brand-soft">
            {t("allTab")}
          </TabsTrigger>
          {areas.map((a) => (
            <TabsTrigger key={a} value={a} className="h-9 shrink-0 rounded-full border bg-card px-3 data-[state=active]:border-brand data-[state=active]:bg-brand-soft">
              {t(`tabs.${a}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {(["all", ...PLAN_AREAS] as const).map((a) => (
          <TabsContent key={a} value={a} className="space-y-2">
            {plan.steps
              .filter((s) => a === "all" || s.area === a)
              .map((s, i) => (
                <StepCard key={s.id} step={s} links={links[s.id]} index={i} id={a === "all" ? `step-${s.id}` : undefined} />
              ))}
            {a !== "all" && !plan.steps.some((s) => s.area === a) ? <p className="text-xs text-muted-foreground">{t("emptyTab")}</p> : null}
          </TabsContent>
        ))}
      </Tabs>

      {hairLoss ? <HairLossCard signal={hairLoss} doctorLayerEnabled={doctorLayerEnabled} expertNetworkEnabled={expertNetworkEnabled} hasScalpStep={hasScalpStepIn(plan.steps)} /> : null}

      <DoctorLayer doctor={data.view.doctor} expertNetworkEnabled={expertNetworkEnabled} analysisId={analysisId} />

      {glowUpEnabled ? (
        <Card className="bg-hero-glow">
          <CardContent className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand" aria-hidden="true">
              <Wand2 className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t("glowUpCta")}</p>
              <p className="text-xs text-muted-foreground">{t("glowUpBody")}</p>
            </div>
            <Button asChild size="sm" className="h-11 rounded-full">
              <Link href={`/dene?mode=glow_up&analysis=${analysisId}`} onClick={() => track("glowup_viewed")}>
                {t("glowUpOpen")}
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {reportId ? (
        <div className="rounded-2xl border bg-card px-4 py-1 shadow-card">
          <FeedbackButtons targetType="report" targetId={reportId} compact />
        </div>
      ) : null}

      <div className="grid gap-2 pt-2">
        <Button variant="ghost" onClick={() => generate(true)} disabled={regen.busy} aria-busy={regen.busy}>
          <RefreshCw aria-hidden="true" className={cn(regen.busy && "motion-safe:animate-spin")} />
          {regen.busy ? t("regen.busy") : t("regen.cta")}
        </Button>
        {regen.errorCode ? (
          <p role="alert" className="flex items-start justify-center gap-1.5 text-center text-[12px] leading-relaxed text-warn">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>{t.has(`errors.${regen.errorCode}`) ? t(`errors.${regen.errorCode}`) : t("errors.GENERIC")}</span>
          </p>
        ) : null}
        <p className="text-center text-[11px] text-muted-foreground">{t("regen.note")}</p>
      </div>
      <ul className="space-y-1 text-center text-[11px] text-muted-foreground">
        {plan.disclaimers.map((d) => (
          <li key={d}>{t(`disclaimers.${d}`)}</li>
        ))}
      </ul>
    </div>
  );
}
