"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { RevealSequence, type RevealCard } from "@/components/analysis/RevealSequence";
import { FeedbackButtons } from "@/components/report/FeedbackButtons";
import { ShareCardButton } from "@/components/share/ShareCardButton";
import { track } from "@/lib/analytics";
import { RESULT_FOCUS_BELOW } from "@/lib/config/scoring";
import type { SectionKey } from "@/lib/score/contract";
import type { ClientAnalysisV2 } from "@/lib/score/present";
import { FaceShapeCard } from "./FaceShapeCard";
import { ImproveFirstV2Card } from "./ImproveFirstV2Card";
import { MeasuresCard } from "./MeasuresCard";
import { OverallCard } from "./OverallCard";
import { ReportV3 } from "@/components/report/ReportV3";
import { FailedCard, PendingUploadCard, StageBanner } from "./StageCards";
import { SubscoresCard, orderSubsV2, rowsFromAnalysis } from "./SubscoresCard";
import { useAnalysisPoll } from "./useAnalysisPoll";

const SEEN_KEY = (id: string) => `aura.revealed.v2.${id}`;
const subscribeNoop = () => () => {};

/** Bu sonuç bu sekmede daha önce tam açıldıysa sıra beklenmez (yalnız kimlik saklanır). */
function seenBefore(id: string): boolean {
  try {
    return window.sessionStorage.getItem(SEEN_KEY(id)) === "1";
  } catch {
    return false;
  }
}

/** Kart sırası (KB §4.8): skor 4,0'ın altındaysa gelişim alanları önce. */
export function cardOrder(lowScore: boolean): SectionKey[] {
  return lowScore ? ["improveFirst", "subscores", "overall", "faceShape", "device", "report"] : ["overall", "subscores", "improveFirst", "faceShape", "device", "report"];
}

/**
 * Ödeme sonrası sonuç (KB §3.2, §4.5–4.10, §5): kart kart açılış; GET /api/analyses/[id] yoklaması. Hak sunucuda;
 * burada yalnız sunucunun gönderdiği (kilit kurallarından geçmiş) ClientAnalysisV2 çizilir.
 */
type ResultFlags = { glowUp: boolean; expertNetwork: boolean };
const DEFAULT_FLAGS: ResultFlags = { glowUp: true, expertNetwork: false };

export function ResultV2View({ initial, instantReveal, flags = DEFAULT_FLAGS }: { initial: ClientAnalysisV2; /** Test/önizleme: sıra beklenmez. */ instantReveal?: boolean; /** Sunucu bayrakları (FEATURE_GLOW_UP, FEATURE_EXPERT_NETWORK); rapor kartındaki bağlantılar. */ flags?: ResultFlags }) {
  const t = useTranslations("analysis");
  const { a, pollError } = useAnalysisPoll(initial);
  // sessionStorage yalnız istemcide okunur; sunucu anlık görüntüsü false: sunucu HTML'i (bulanık iskelet) ile hidrasyon
  // aynı kalır, daha önce görülmüş sonuçta React hidrasyon sonrası instant=true ile yeniden çizer (useBoundSelfie kalıbı).
  // Değer ilk okumada dondurulur: bu ziyarette tamamlanınca yazılan anahtar, süren açılışı anında bitirmez.
  const seenRef = useRef<boolean | null>(null);
  const seenNow = useSyncExternalStore(
    subscribeNoop,
    () => (seenRef.current ??= seenBefore(initial.id)),
    () => false,
  );
  const instant = instantReveal ?? seenNow;
  const viewedRef = useRef<string | null>(null);

  useEffect(() => {
    if (viewedRef.current === a.id) return;
    viewedRef.current = a.id;
    track("result_viewed", { tier: "premium", overlay: "schematic", legacy: false });
  }, [a.id]);

  useEffect(() => {
    if (a.stage !== "completed") return;
    try {
      window.sessionStorage.setItem(SEEN_KEY(a.id), "1");
    } catch {
      // depolama kapalıysa açılış her ziyarette oynar
    }
  }, [a.stage, a.id]);

  const overall = a.overall.locked ? null : a.overall.value;
  const potential = a.potential.locked ? null : a.potential.value;
  const lowScore = overall !== null && overall.value < RESULT_FOCUS_BELOW;
  const ready = new Set(a.sectionsReady);
  const rows = useMemo(() => orderSubsV2(rowsFromAnalysis(a), lowScore), [a, lowScore]);
  const report = a.report.locked ? null : a.report.value;
  const improve = a.improveFirst.locked ? null : a.improveFirst.value;

  if (a.stage === "device_only") {
    return (
      <div className="space-y-3">
        <PendingUploadCard analysisId={a.id} />
        <MeasuresCard device={a.device} measures={null} reportReady={false} />
      </div>
    );
  }
  if (a.stage === "failed") {
    return (
      <div className="space-y-3">
        <FailedCard failure={a.failure} analysisId={a.id} />
        <MeasuresCard device={a.device} measures={null} reportReady={false} />
      </div>
    );
  }

  const byKey: Record<SectionKey, RevealCard | null> = {
    overall: { key: "overall", node: <OverallCard overall={overall} potential={potential} potentialReady={a.stage === "completed" || ready.has("potential")} /> },
    subscores: { key: "subscores", node: <SubscoresCard rows={rows} explanationsReady={a.stage === "completed" || ready.has("explanations")} viewsUsed={a.viewsUsed} /> },
    improveFirst: { key: "improveFirst", node: <ImproveFirstV2Card items={improve} analysisId={a.id} /> },
    faceShape: { key: "faceShape", node: <FaceShapeCard faceShape={a.faceShape} detailedReady={a.stage === "completed" || ready.has("faceShape")} /> },
    device: { key: "device", node: <MeasuresCard device={a.device} measures={report?.measures ?? null} reportReady={a.stage === "completed" || ready.has("report")} /> },
    // W4 (PLAN 4a): rapor v3 iskeleti — mektup, 9 bölge, açılır ölçüler, plan ve "iyileşmiş halin" kartları, kapanış.
    // Plan kartı /plan/[id]'ye gider (anket v2 yoksa önce /plan/[id]/anket); "iyileşmiş halin" /dene?mode=glow_up&analysis=[id].
    report: { key: "report", node: <ReportV3 report={report} analysisId={a.id} viewsUsed={a.viewsUsed} glowUpEnabled={flags.glowUp} expertNetworkEnabled={flags.expertNetwork} /> },
    potential: null,
    explanations: null,
  };
  const cards = cardOrder(lowScore).flatMap((k) => (byKey[k] ? [byKey[k]] : []));
  const done = cards.filter((c) => ready.has(c.key) || a.stage === "completed").length;

  const shareSubs = rows
    .filter((r) => r.score && !r.notAssessed)
    .sort((x, y) => (y.score?.value ?? 0) - (x.score?.value ?? 0))
    .slice(0, 3)
    .map((r) => ({ label: t(`sub.${r.k}`), value: r.score?.value ?? 0 }));

  return (
    <div className="space-y-3">
      <StageBanner stage={a.stage} done={done} total={cards.length} pollError={pollError} />
      <RevealSequence stage={a.stage} sectionsReady={a.sectionsReady} cards={cards} instant={instant} />
      {a.stage === "completed" && overall && potential ? <ShareCardButton overall={overall.value} potential={potential.value} subs={shareSubs} /> : null}
      {a.stage === "completed" ? <FeedbackButtons targetType="score" targetId={a.id} /> : null}
    </div>
  );
}
