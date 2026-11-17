import { notFound } from "next/navigation";
import { DavetDebug, HayaletDebug, KartDebug } from "./PaylasDebug";

/**
 * Yalnız development: Faz 6 paylaşım kartları (cihazda çizilir), davet bloğu + kod girişi, hayalet kılavuz katmanı
 * (sentetik çizgi). Kullanıcı, fotoğraf, Supabase yok. Production'da 404. /debug/paylas?view=kart|davet|hayalet&unlocked=1
 */
export default async function PaylasDebugPage({ searchParams }: PageProps<"/debug/paylas">) {
  if (process.env.NODE_ENV !== "development") notFound();
  const sp = await searchParams;
  const view = sp.view === "davet" ? "davet" : sp.view === "hayalet" ? "hayalet" : "kart";
  return (
    <div className="mx-auto w-full max-w-lg space-y-5 px-4 py-6">
      <h1 className="sr-only">/debug/paylas {view}</h1>
      {view === "kart" ? <KartDebug /> : view === "davet" ? <DavetDebug unlocked={sp.unlocked === "1"} /> : <HayaletDebug />}
    </div>
  );
}
