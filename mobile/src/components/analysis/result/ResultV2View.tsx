import { useEffect, useMemo, useRef } from "react";
import { View } from "react-native";
import { track } from "@/lib/analytics";
import type { SectionKey } from "@/lib/score/contract";
import type { ClientAnalysisV2 } from "@/lib/score/present";
import { strongestSub } from "@/lib/share/spec";
import { FeedbackButtons } from "@/mobile/src/components/report/FeedbackButtons";
import { ReportV3 } from "@/mobile/src/components/report/ReportV3";
import { cardOrder, isLowScore, revealProgress, sectionReady } from "@/mobile/src/features/analysis/reveal";
import { orderSubsV2, rowsFromAnalysis, shareSubsFromRows } from "@/mobile/src/features/analysis/subs";
import { useAnalysisPoll } from "@/mobile/src/features/analysis/useAnalysisPoll";
import { useSession } from "@/mobile/src/features/session/SessionProvider";
import { ShareCardButtonV2 } from "@/mobile/src/features/share/ShareCardButtonV2";
import { isMobileFeatureEnabled } from "@/mobile/src/lib/flags";
import { scoped } from "@/mobile/src/lib/i18n";
import { spacing } from "@/mobile/src/theme";
import { FaceShapeCard } from "./FaceShapeCard";
import { ImproveFirstCard } from "./ImproveFirstCard";
import { MeasuresCard } from "./MeasuresCard";
import { OverallCard } from "./OverallCard";
import { RevealSequence, type RevealCard } from "./RevealSequence";
import { FailedCard, PendingUploadCard, StageBanner } from "./StageCards";
import { SubscoresCard } from "./SubscoresCard";

const t = scoped("analysis");

// Bu oturumda tam açılmış sonuçlar (yalnız kimlik): yeniden ziyarette sıra beklenmez.
const seen = new Set<string>();

/**
 * Ödeme sonrası açık sonuç (KB §3.2, §4.5–4.10, §5; CONTRACTS_V2 S3.1 "açık dal"): kart kart açılış; GET /api/analyses/[id]
 * yoklaması (running 2 sn). Hak sunucuda; burada yalnız sunucunun gönderdiği (kilit kurallarından geçmiş) ClientAnalysisV2
 * çizilir. W7a'nın analiz/[id].tsx dosyasındaki ResultBranch yerine bu bileşen gelir (aynı props).
 */
export function ResultV2View({ initial, onUpdate, instantReveal }: { initial: ClientAnalysisV2; onUpdate?: (a: ClientAnalysisV2) => void; /** Test/önizleme: sıra beklenmez. */ instantReveal?: boolean }) {
  const { aura } = useSession();
  const { a, pollError } = useAnalysisPoll(aura, initial, onUpdate);
  const instant = instantReveal ?? seen.has(initial.id);
  const viewedRef = useRef<string | null>(null);

  useEffect(() => {
    if (viewedRef.current === a.id) return;
    viewedRef.current = a.id;
    track("result_viewed", { tier: "premium", overlay: "schematic", legacy: false });
  }, [a.id]);
  useEffect(() => {
    if (a.stage === "completed") seen.add(a.id);
  }, [a.stage, a.id]);

  const overall = a.overall.locked ? null : a.overall.value;
  const potential = a.potential.locked ? null : a.potential.value;
  const lowScore = isLowScore(overall?.value ?? null);
  const rows = useMemo(() => orderSubsV2(rowsFromAnalysis(a), lowScore), [a, lowScore]);
  const report = a.report.locked ? null : a.report.value;
  const improve = a.improveFirst.locked ? null : a.improveFirst.value;
  const readyFor = (k: SectionKey) => sectionReady(a.stage, a.sectionsReady, k);

  if (a.stage === "device_only") {
    return (
      <View style={{ gap: spacing.md }}>
        <PendingUploadCard analysisId={a.id} />
        <MeasuresCard device={a.device} measures={null} reportReady={false} />
      </View>
    );
  }
  if (a.stage === "failed") {
    return (
      <View style={{ gap: spacing.md }}>
        <FailedCard failure={a.failure} analysisId={a.id} />
        <MeasuresCard device={a.device} measures={null} reportReady={false} />
      </View>
    );
  }

  const byKey: Partial<Record<SectionKey, RevealCard>> = {
    overall: { key: "overall", node: <OverallCard overall={overall} potential={potential} potentialReady={readyFor("potential")} /> },
    subscores: { key: "subscores", node: <SubscoresCard rows={rows} explanationsReady={readyFor("explanations")} viewsUsed={a.viewsUsed} /> },
    improveFirst: { key: "improveFirst", node: <ImproveFirstCard items={improve} analysisId={a.id} /> },
    faceShape: { key: "faceShape", node: <FaceShapeCard faceShape={a.faceShape} detailedReady={readyFor("faceShape")} /> },
    device: { key: "device", node: <MeasuresCard device={a.device} measures={report?.measures ?? null} reportReady={readyFor("report")} /> },
    // Rapor v3 iskeleti: mektup → 9 bölge → ölçüler → plan → "iyileşmiş hâlin" → kapanış ("Tıbbi tavsiye değildir").
    report: { key: "report", node: <ReportV3 report={report} analysisId={a.id} viewsUsed={a.viewsUsed} glowUpEnabled={isMobileFeatureEnabled("glowUp")} /> },
  };
  const order = cardOrder(lowScore);
  const cards = order.flatMap((k) => (byKey[k] ? [byKey[k] as RevealCard] : []));
  const progress = revealProgress(a.stage, order, a.sectionsReady);

  const strongestKey = strongestSub(Object.fromEntries(rows.map((r) => [r.k, r.score])));
  const strongestRow = strongestKey ? rows.find((r) => r.k === strongestKey) : undefined;
  const strongest = strongestKey && strongestRow ? { sub: strongestKey, area: t(`sub.${strongestKey}`), line: strongestRow.explanation?.held[0] ?? "" } : null;

  return (
    <View style={{ gap: spacing.md }}>
      <StageBanner stage={a.stage} done={progress.done} total={progress.total} pollError={pollError} />
      <RevealSequence stage={a.stage} sectionsReady={a.sectionsReady} cards={cards} instant={instant} />
      {a.stage === "completed" && overall ? <ShareCardButtonV2 score={{ overall: overall.value, potential: potential?.value ?? null, subs: shareSubsFromRows(rows, (k) => t(`sub.${k}`)) }} strongest={strongest} /> : null}
      {a.stage === "completed" ? <FeedbackButtons targetType="score" targetId={a.id} /> : null}
    </View>
  );
}
