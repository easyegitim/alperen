import { notFound } from "next/navigation";
import { DeneFixture, type DeneFixtureState } from "./DeneFixture";

const STATES: DeneFixtureState[] = ["combo", "glowup", "qc_failed", "result", "share", "generating"];

/**
 * Yalnız development: /dene v2 durumları sabit veriyle (sentetik görsel; kullanıcı, fotoğraf, model, ücretli çağrı yok).
 * /debug/dene?state=combo|glowup|qc_failed|result|share|generating. Production'da 404.
 */
export default async function DeneDebugPage({ searchParams }: PageProps<"/debug/dene">) {
  if (process.env.NODE_ENV !== "development") notFound();
  const sp = await searchParams;
  const state = STATES.find((s) => s === sp.state) ?? "combo";
  return (
    <div className="mx-auto w-full max-w-lg space-y-4 px-4 py-6">
      <h1 className="text-2xl font-bold tracking-tight">Dene</h1>
      <DeneFixture key={state} state={state} />
    </div>
  );
}
