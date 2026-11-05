import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/** profiles.unlimited_quota (yalnız service role yazar). Okuma hatasında false: limitler normal uygulanır. */
export async function isUnlimitedQuota(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await admin.from("profiles").select("unlimited_quota").eq("id", userId).maybeSingle();
  return data?.unlimited_quota === true;
}
