import { redirect } from "next/navigation";
import { createClient } from "@/lib/db/server";
import { getOnboardingRedirect } from "@/lib/onboarding/gate";

/** Onboarding kapısı (SPEC Faz 2 madde 5). /baslangic/* bu grubun dışındadır; döngü oluşmaz. */
export default async function GatedLayout({ children }: LayoutProps<"/">) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_adult, onboarding_completed_at, deletion_requested_at")
    .eq("id", user.id)
    .maybeSingle();

  const target = getOnboardingRedirect(
    profile
      ? { is_adult: Boolean(profile.is_adult), onboarding_completed_at: profile.onboarding_completed_at ?? null, deletion_requested_at: profile.deletion_requested_at ?? null }
      : null,
  );
  if (target) redirect(target);

  return <>{children}</>;
}
