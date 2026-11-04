import { notFound } from "next/navigation";
import { ResultV2View } from "@/components/analysis/result/ResultV2View";
import { fixtureAnalysis, type FixtureState } from "@/tests/fixtures/analysisV2";

const STATES: FixtureState[] = ["completed", "reveal", "queued", "low", "failed", "device_only"];

/**
 * Yalnız development: ödeme sonrası sonuç ekranı sabit veriyle (fotoğraf, kullanıcı, model yok). Production'da 404.
 * /debug/sonuc?state=completed|reveal|queued|low|failed|device_only&instant=1
 */
export default async function ResultDebugPage({ searchParams }: PageProps<"/debug/sonuc">) {
  if (process.env.NODE_ENV !== "development") notFound();
  const sp = await searchParams;
  const state = STATES.find((s) => s === sp.state) ?? "completed";
  const a = fixtureAnalysis(state);
  return (
    <div className="mx-auto w-full max-w-lg px-4 py-6">
      <h1 className="sr-only">/debug/sonuc {state}</h1>
      <ResultV2View key={state} initial={a} instantReveal={sp.instant === "1"} />
    </div>
  );
}
