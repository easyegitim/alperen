import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConsentState, ConsentType } from "@/lib/consent";

/** Web getConsentState karşılığı: current_consents görünümü (RLS, yalnız kendi satırları). Saf eşleme ayrı test edilir. */
export function mapConsentRows(rows: { type: string; granted: boolean | null; text_version: string | null }[] | null | undefined): ConsentState {
  const state: ConsentState = {};
  for (const row of rows ?? []) state[row.type as ConsentType] = { granted: Boolean(row.granted), textVersion: String(row.text_version ?? "") };
  return state;
}

export async function readConsentState(supabase: SupabaseClient): Promise<ConsentState> {
  const { data, error } = await supabase.from("current_consents").select("type, granted, text_version");
  if (error) throw new Error("rızalar okunamadı");
  return mapConsentRows(data);
}

export type LegalDocDto = { slug: string; title: string; version: string; updatedAt: string; body: string };
