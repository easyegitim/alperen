import { useEffect, useState } from "react";
import { getOnboardingRedirect } from "@/lib/onboarding/gate";
import { getSupabase } from "@/mobile/src/lib/supabase";
import { useSession } from "./SessionProvider";

export type GateState = { ready: boolean; redirect: string | null };

/**
 * Web (app)/(gated) layout'unun karşılığı: profil RLS ile okunur, paylaşılan getOnboardingRedirect uygulanır.
 * Yollar web ile aynıdır (/baslangic/yas, /baslangic/izinler, /silme) — expo-router dosya adları bu yollara eşlenir.
 * Sunucu uçları yine withGuard ile korunur; bu yalnız UX kapısıdır (CLAUDE.md).
 */
export function useGate(): GateState {
  const { loading, user, configured } = useSession();
  // Profil sonucu kullanıcı kimliğiyle saklanır; çıkış sonrası eski sonuç kullanılmaz.
  const [profile, setProfile] = useState<{ userId: string; target: string | null } | null>(null);
  const userId = user?.id ?? null;

  useEffect(() => {
    if (loading || !userId || !configured) return;
    let active = true;
    void getSupabase()
      .from("profiles")
      .select("is_adult, onboarding_completed_at, deletion_requested_at")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        const target = getOnboardingRedirect(
          data ? { is_adult: Boolean(data.is_adult), onboarding_completed_at: data.onboarding_completed_at ?? null, deletion_requested_at: data.deletion_requested_at ?? null } : null,
        );
        setProfile({ userId, target });
      });
    return () => {
      active = false;
    };
  }, [loading, userId, configured]);

  if (loading) return { ready: false, redirect: null };
  if (!userId || !configured) return { ready: true, redirect: "/" };
  if (!profile || profile.userId !== userId) return { ready: false, redirect: null };
  return { ready: true, redirect: profile.target };
}
