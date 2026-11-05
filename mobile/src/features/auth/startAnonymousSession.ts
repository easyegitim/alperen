import { track } from "@/lib/analytics";
import { getSupabase } from "@/mobile/src/lib/supabase";

/** SPEC 4.1 adım 2 / SPEC-MOBILE M2: Turnstile token'ı (varsa) ile anonim oturum. Hata mesajı kullanıcıya metin anahtarıyla döner. */
export async function startAnonymousSession(captchaToken?: string): Promise<{ ok: true } | { ok: false; reason: "session" }> {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  if (data.session) return { ok: true };
  const { error } = await supabase.auth.signInAnonymously(captchaToken ? { options: { captchaToken } } : undefined);
  if (error) return { ok: false, reason: "session" };
  track("anon_session_started");
  return { ok: true };
}
