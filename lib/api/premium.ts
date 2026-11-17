import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isPremium } from "@/lib/billing/entitlement";

/** Kullanıcının kendi abonelik satırından premium durumu (RLS p_subs_read). */
export async function getPremiumStatus(supabase: SupabaseClient, userId: string): Promise<{ premium: boolean; plan: string | null; periodEnd: string | null }> {
  const { data } = await supabase.from("subscriptions").select("plan, status, current_period_end").eq("user_id", userId).maybeSingle();
  const premium = isPremium(data ? { status: String(data.status), current_period_end: data.current_period_end ?? null } : null);
  return { premium, plan: premium && data ? String(data.plan) : null, periodEnd: premium && data ? String(data.current_period_end) : null };
}
