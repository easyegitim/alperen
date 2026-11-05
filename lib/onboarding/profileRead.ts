import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingColumnError } from "@/lib/score/rowColumns";
import { isAgeBand, type AgeBand } from "./age";
import type { Presentation } from "./draft";
import { readPresentation } from "./presentation";

/**
 * Sayfalar için toleranslı okumalar: migration 0010 uygulanmamış ortamda sütun yoksa null döner (ekran yeniden sorar),
 * sahte değer üretilmez; diğer hatalar da null sayılır (sayfa akışı durmaz, yazma uçları gerçek hatayı verir).
 */
export async function readAgeBand(client: SupabaseClient, userId: string): Promise<AgeBand | null> {
  const r = await client.from("profiles").select("age_band").eq("id", userId).maybeSingle();
  if (r.error) {
    if (!isMissingColumnError(r.error)) console.warn("[onboarding] age_band okunamadı");
    return null;
  }
  return isAgeBand(r.data?.age_band) ? r.data.age_band : null;
}

export async function readPresentationSafe(client: SupabaseClient, userId: string): Promise<Presentation | null> {
  try {
    return await readPresentation(client, userId);
  } catch {
    return null;
  }
}
