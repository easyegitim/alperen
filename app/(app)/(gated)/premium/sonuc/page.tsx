import { PaymentResult } from "@/components/billing/PaymentResult";
import { isUuid } from "@/lib/billing/returnAnalysis";
import { createAdminClient } from "@/lib/db/admin";
import { createClient } from "@/lib/db/server";

/**
 * /premium/sonuc: ödeme sonucu. Fotoğraflar sunucuda saklanmadığı için iyzico dönüşünde bellekteki set yoktur: satır
 * henüz tam analiz görmediyse (device_only/failed) kullanıcı çekim ekranına yönlendirilir ve metin bunu açıkça söyler
 * (KB §3.4 risk notu: ödeme öncesi "hazır" izlenimi ödeme sonrasıyla çelişmemeli). "Yeni çekim gerekmez" yalnız
 * tamamlanmış satırda.
 */
export default async function PaymentResultPage({ searchParams }: PageProps<"/premium/sonuc">) {
  const sp = await searchParams;
  const status = sp.status === "ok" || sp.status === "failed" ? sp.status : "pending";
  const analysisId = isUuid(sp.analysis) ? sp.analysis : undefined;
  const product = sp.product === "one_time_report" ? "one_time_report" : undefined;
  let needsCapture = false;
  if (analysisId) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: row } = await createAdminClient().from("analyses").select("status").eq("id", analysisId).eq("user_id", user.id).maybeSingle();
      needsCapture = row?.status === "device_only" || row?.status === "failed";
    }
  }
  return (
    <div className="mx-auto w-full max-w-lg px-4 py-6">
      <PaymentResult status={status} analysisId={analysisId} product={product} needsCapture={needsCapture} />
    </div>
  );
}
