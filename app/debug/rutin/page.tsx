import { notFound } from "next/navigation";
import { IlerlemeDebug, RutinDebug, type ProgressDebugState, type RutinDebugState } from "./RutinDebug";

const RUTIN: RutinDebugState[] = ["rest", "frozen", "missed", "limit"];
const ILERLEME: ProgressDebugState[] = ["same", "up", "down", "calib"];

/**
 * Yalnız development: Faz 6 rutin (affedici seri) ve ilerleme (±bant "değişim yok") ekranları sabit veriyle (kullanıcı,
 * Supabase, fotoğraf yok). Production'da 404. /debug/rutin?view=rutin&state=rest|frozen|missed|limit · ?view=ilerleme&state=same|up|down|calib
 */
export default async function RutinDebugPage({ searchParams }: PageProps<"/debug/rutin">) {
  if (process.env.NODE_ENV !== "development") notFound();
  const sp = await searchParams;
  const view = sp.view === "ilerleme" ? "ilerleme" : "rutin";
  return (
    <div className="mx-auto w-full max-w-lg space-y-5 px-4 py-6">
      <h1 className="sr-only">/debug/rutin {view}</h1>
      {view === "rutin" ? <RutinDebug state={RUTIN.find((s) => s === sp.state) ?? "rest"} /> : <IlerlemeDebug state={ILERLEME.find((s) => s === sp.state) ?? "same"} />}
    </div>
  );
}
