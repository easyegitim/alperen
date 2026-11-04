"use client";

import { Check, Scissors, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { CaptureHintsCard } from "@/components/analysis/CaptureHintsCard";
import { ImproveFirstCard } from "@/components/analysis/ImproveFirstCard";
import { LockedPlanPreview } from "@/components/analysis/LockedPlanPreview";
import { LockedSection } from "@/components/analysis/LockedSection";
import { DeviceMeasurementsCard, MeasurementsCard } from "@/components/analysis/MeasurementsCard";
import { MethodDisclosure } from "@/components/analysis/MethodDisclosure";
import { REVEAL_COUNT_MS, REVEAL_LINES_MS, ScoreHero, ScoreHeroLocked } from "@/components/analysis/ScoreHero";
import { LockedSubscoreList, SubscoreList, type SubRow } from "@/components/analysis/SubscoreList";
import { useBoundSelfie } from "@/components/analysis/useBoundSelfie";
import { usePaywall } from "@/components/paywall/PaywallSheet";
import { FeedbackButtons } from "@/components/report/FeedbackButtons";
import { ShareCardButton } from "@/components/share/ShareCardButton";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics";
import type { PaywallTrigger } from "@/lib/config/paywall";
import { RESULT_FOCUS_BELOW } from "@/lib/config/scoring";
import { SUB_KEYS, SUB_KEYS_V2, type SubKey } from "@/lib/config/teaser";
import { notMeasuredLayers } from "@/lib/face/overlay";
import type { EngineName, ExplainItem } from "@/lib/score/contract";
import { observationFor } from "@/lib/score/observationText";
import type { ClientAnalysis, ClientAnalysisV2 } from "@/lib/score/present";

const REVEAL_KEY = (id: string) => `aura.revealed.${id}`;

/** Açılış gösterimi yalnız bu analize bağlı bellekteki selfie varsa ve bu sekmede daha önce oynamadıysa (yalnız kimlik saklanır). */
function shouldReveal(id: string, bound: boolean): boolean {
  if (!bound || typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(REVEAL_KEY(id)) === null;
  } catch {
    return false;
  }
}

/** SPEC 8.7: düşük skorda geliştirilebilir alanlar önce; kilitli 99 sayılır; değerlendirilmeyen alan en sonda. */
function orderSubs(a: ClientAnalysis, lowScore: boolean): SubKey[] {
  if (!lowScore) return [...SUB_KEYS];
  const rank = { modifiable: 0, partial: 1, structural: 2 } as const;
  const skipped = (k: SubKey) => a.notAssessed.some((n) => n.sub === k) && !a.subscores[k].locked;
  return [...SUB_KEYS].sort((x, y) => {
    const s = Number(skipped(x)) - Number(skipped(y));
    if (s !== 0) return s;
    const d = rank[a.kinds[x]] - rank[a.kinds[y]];
    if (d !== 0) return d;
    const vx = a.subscores[x].locked ? 99 : (a.subscores[x].value ?? 99);
    const vy = a.subscores[y].locked ? 99 : (a.subscores[y].value ?? 99);
    return vx - vy;
  });
}

/**
 * Sonuç ekranı (F08, UI spec §2). Kilitli değerler istemcide yoktur; dokununca paywall açılır.
 * Hem hybrid.v1 hem eski satırlar çizilir (eski satırda türetilmiş alanlar varsayılan değerdedir).
 */
export function ScoreView({ a, premium, currentEngine }: { a: ClientAnalysis; premium: boolean; currentEngine?: EngineName }) {
  const t = useTranslations("analysis");
  const { open } = usePaywall();
  const onLocked = (trigger: PaywallTrigger) => open(trigger);
  const source = useBoundSelfie(a.id);

  // Bir kez, bağlama göre: sayfa yenilenince (selfie yok) her iki tarafta da false; istemci geçişinde gerçek değer.
  const [reveal] = useState(() => shouldReveal(a.id, source !== null));
  const [announce, setAnnounce] = useState("");
  const viewedRef = useRef<string | null>(null);

  useEffect(() => {
    if (viewedRef.current === a.id) return;
    viewedRef.current = a.id;
    track("result_viewed", { tier: premium ? "premium" : "free", overlay: source ? "photo" : "schematic", legacy: a.engine === "legacy" });
  }, [a.id, a.engine, premium, source]);

  useEffect(() => {
    if (!reveal) return;
    try {
      window.sessionStorage.setItem(REVEAL_KEY(a.id), "1");
    } catch {
      // depolama kapalıysa gösterim yine bir kez oynar
    }
    const id = window.setTimeout(() => setAnnounce(t("reveal.ready")), REVEAL_LINES_MS + REVEAL_COUNT_MS);
    return () => clearTimeout(id);
  }, [reveal, a.id, t]);

  const overall = a.overall.locked ? null : a.overall.value;
  const potential = a.potential.locked ? null : a.potential.value;
  const lowScore = overall !== null && overall < RESULT_FOCUS_BELOW;
  const obs = a.observations.locked ? null : a.observations.value;
  const hybrid = a.engine === "hybrid.v1";

  const notMeasured = useMemo(() => {
    const items: ExplainItem[] = SUB_KEYS.flatMap((k) => {
      const e = a.explain[k];
      return !e.locked && e.value ? e.value : [];
    });
    return notMeasuredLayers(items);
  }, [a.explain]);

  const rows: SubRow[] = orderSubs(a, lowScore).map((k) => ({
    k,
    v: a.subscores[k],
    kind: a.kinds[k],
    note: obs ? observationFor(k, obs) : null,
    explain: a.explain[k],
    notAssessed: a.notAssessed.find((n) => n.sub === k),
  }));

  const hero = (
    <ScoreHero
      a={a}
      onLocked={onLocked}
      reveal={reveal}
      showLegacyNote={currentEngine === "hybrid.v1" && a.engine === "legacy"}
      source={source}
      notMeasured={notMeasured}
    />
  );
  const subs = <SubscoreList rows={rows} hybrid={hybrid} reveal={reveal} onLocked={onLocked} />;
  const improve = <ImproveFirstCard v={a.improveFirst} analysisId={a.id} onLocked={onLocked} kinds={a.kinds} />;
  const hints = <CaptureHintsCard hints={a.captureHints} />;
  const measurements = <MeasurementsCard a={a} onLocked={onLocked} />;
  const plan = (
    <LockedSection
      title={t("planTitle")}
      description={t("planBody")}
      icon={<Sparkles className="size-4" />}
      feature
      ctaVariant="outline"
      locked={!premium}
      onTap={() => onLocked("plan")}
    >
      <div className="grid grid-cols-2 gap-2">
        <Button asChild>
          <Link href={`/plan/${a.id}`}>{t("seePlan")}</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/dene">
            <Scissors aria-hidden="true" />
            {t("tryStyles")}
          </Link>
        </Button>
      </div>
    </LockedSection>
  );

  // Paylaşım kartı: değerlendirilmeyen alt skor listelenmez (null'u 0 diye basmamak için).
  const shareSubs = (["skin", "hair", "jawline"] as SubKey[]).flatMap((k) => {
    const s = a.subscores[k];
    if (s.locked || s.value === null || a.notAssessed.some((n) => n.sub === k)) return [];
    return [{ label: t(`sub.${k}`), value: s.value }];
  });
  const share = premium && overall !== null && potential !== null ? <ShareCardButton overall={overall} potential={potential} subs={shareSubs} /> : null;
  const feedback = a.status === "completed" ? <FeedbackButtons targetType="score" targetId={a.id} /> : null;
  const method = <MethodDisclosure hybrid={hybrid} />;

  return (
    <div className="space-y-3">
      {lowScore ? (
        <>
          {improve}
          {plan}
          {hero}
          {subs}
          {measurements}
          {hints}
          {method}
        </>
      ) : (
        <>
          {hero}
          {subs}
          {improve}
          {plan}
          {measurements}
          {hints}
          {method}
        </>
      )}
      {share}
      {feedback}
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}

// ─── v2 kilitli sonuç ekranı (KB §3.3; PLAN 1f) ─────────────────────────────────────────────────────────────────────

/**
 * Ödeme öncesi (stage device_only) ve hak yokken tamamlanmış analiz: sunucudan hiçbir skor gelmez (null + locked).
 * Sıra: portre + aynı halka/kilit → alt skor adları (aynı bulanık çubuk, rozet yok) → ilk adımlar (3 bulanık satır) →
 * sana özel plan (cihazda bulanık önizlemeler) → oranlar (açık, KB notu) → yöntem.
 */
export function ScoreViewV2({ a }: { a: ClientAnalysisV2 }) {
  const t = useTranslations("analysis");
  const { open } = usePaywall();
  const onLocked = (trigger: PaywallTrigger) => open(trigger);
  const source = useBoundSelfie(a.id);
  const viewedRef = useRef<string | null>(null);

  useEffect(() => {
    if (viewedRef.current === a.id) return;
    viewedRef.current = a.id;
    track("result_viewed", { tier: "free", overlay: source ? "photo" : "schematic", legacy: false });
  }, [a.id, source]);

  const prelim = a.faceShape?.override ? { primary: a.faceShape.override } : (a.faceShape?.prelim ?? null);

  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 rounded-xl border bg-muted/40 px-3.5 py-2.5 text-[13px]">
        <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-full bg-success text-white">
          <Check className="size-3.5" strokeWidth={3} />
        </span>
        <span>
          <span className="font-semibold">{t("locked.deviceDone")}</span> · {t("locked.unlockBody")}
        </span>
      </p>
      <ScoreHeroLocked faceShape={prelim} source={source} onLocked={onLocked} />
      <LockedSubscoreList keys={SUB_KEYS_V2} onLocked={onLocked} />
      <ImproveFirstCard v={{ value: null, locked: true }} analysisId={a.id} onLocked={onLocked} />
      <LockedPlanPreview source={source} onTap={() => onLocked("plan")} />
      {a.device ? <DeviceMeasurementsCard ratios={a.device.ratios} /> : null}
      <p className="text-center text-[11px] text-muted-foreground">{t("competitorsNote")}</p>
      <MethodDisclosure hybrid />
    </div>
  );
}
