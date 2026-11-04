import { notFound } from "next/navigation";
import { isPhysicianUser } from "@/lib/api/admin";
import { isFeatureEnabled } from "@/lib/config/flags";
import { createClient } from "@/lib/db/server";
import { DoctorQueue } from "./DoctorQueue";

/** /admin/doctor (PLAN 4f; KB Ç3; AUP): hekim inceleme ekranı. Yalnız PHYSICIAN_EMAILS (ops ADMIN_EMAILS yetmez); diğer herkes için 404. */
export default async function AdminDoctorPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isPhysicianUser(user)) notFound();
  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight">Hekim onay kuyruğu · flag {isFeatureEnabled("doctorLayer") ? "AÇIK" : "KAPALI"}</h1>
      <p className="text-sm text-muted-foreground">Taslaklar yapay zekâ ile hazırlanır ve kullanıcıya YALNIZ hekim onayından sonra, hekimin son haliyle gider. Doz, marka, eczane/satış bağlantısı girilemez; kaynak yalnız TİTCK, DOI, PubMed, Cochrane, WHO.</p>
      <DoctorQueue />
    </div>
  );
}
