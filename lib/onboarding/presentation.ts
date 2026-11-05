import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { PRESENTATIONS } from "@/lib/questionnaire";
import { isMissingColumnError } from "@/lib/score/rowColumns";
import type { Presentation } from "./draft";

/**
 * Sunum (cinsiyet) tek kaynağı: profiles.presentation (migration 0010); eski kayıtlarda questionnaire.presentation.
 * 0010 henüz uygulanmamış bir ortamda sütun yoktur: "sütun yok" hatasında yalnız anketten okunur, sahte değer üretilmez.
 * Sonuç null = kullanıcı henüz seçmedi (ekran yeniden sorar).
 */
export async function readPresentation(client: SupabaseClient, userId: string): Promise<Presentation | null> {
  const full = await client.from("profiles").select("presentation, questionnaire").eq("id", userId).maybeSingle();
  if (!full.error) return pick(full.data?.presentation) ?? pick(questionnairePresentation(full.data?.questionnaire));
  if (!isMissingColumnError(full.error)) throw new Error("profil okunamadı");
  const legacy = await client.from("profiles").select("questionnaire").eq("id", userId).maybeSingle();
  if (legacy.error) throw new Error("profil okunamadı");
  return pick(questionnairePresentation(legacy.data?.questionnaire));
}

function questionnairePresentation(q: unknown): unknown {
  return q && typeof q === "object" ? (q as Record<string, unknown>).presentation : undefined;
}

function pick(v: unknown): Presentation | null {
  return isPresentation(v) ? v : null;
}

/** Saf tip koruması: profiles.presentation değeri geçerli bir sunum mu? */
export function isPresentation(v: unknown): v is Presentation {
  return typeof v === "string" && (PRESENTATIONS as readonly string[]).includes(v);
}
