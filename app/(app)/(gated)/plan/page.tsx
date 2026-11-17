import { redirect } from "next/navigation";
import { PhasePlaceholder } from "@/components/app/PhasePlaceholder";
import { createAdminClient } from "@/lib/db/admin";
import { createClient } from "@/lib/db/server";

/** /plan: son tamamlanmış analizin planına yönlendirir; yoksa boş durum. */
export default async function PlanIndexPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");
  const admin = createAdminClient();
  const { data } = await admin.from("analyses").select("id").eq("user_id", user.id).eq("status", "completed").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (data?.id) redirect(`/plan/${data.id}`);
  return <PhasePlaceholder titleKey="plan" phase={9} feature="F09" />;
}
