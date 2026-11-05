import { notFound } from "next/navigation";
import { MetricsPanel } from "@/components/admin/MetricsPanel";
import { PartnersAdmin } from "@/components/admin/PartnersAdmin";
import { isAdminUser } from "@/lib/api/admin";
import { isFeatureEnabled } from "@/lib/config/flags";
import { createClient } from "@/lib/db/server";

/** /admin: yalnız ADMIN_EMAILS; diğer herkes için 404. Metrikler (F18) ve Uzman Ağı partner yönetimi (F19). */
export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdminUser(user)) notFound();
  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight">Yönetim</h1>
      <MetricsPanel />
      <h2 className="pt-4 text-lg font-semibold">Uzman Ağı · flag {isFeatureEnabled("expertNetwork") ? "AÇIK" : "KAPALI"}</h2>
      <PartnersAdmin />
    </div>
  );
}
