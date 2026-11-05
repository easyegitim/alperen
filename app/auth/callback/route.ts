import { NextResponse } from "next/server";
import { createClient } from "@/lib/db/server";

/** Google/Apple girişi (signInWithOAuth) ve eski anonim bağlama (linkIdentity) sonrası PKCE kodunu oturuma çevirir. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const forwardedHost = request.headers.get("x-forwarded-host");
      const isLocal = process.env.NODE_ENV === "development";
      if (isLocal || !forwardedHost) return NextResponse.redirect(`${origin}${next}`);
      return NextResponse.redirect(`https://${forwardedHost}${next}`);
    }
  }

  // Giriş ekranından gelen deneme hataya düşerse aynı ekrana döner (v2 /baslangic/giris); eski bağlama yolu /hesap.
  const back = next.startsWith("/baslangic/") ? next : "/hesap";
  return NextResponse.redirect(`${origin}${back}?auth_error=1`);
}

/** Yalnız site içi, kök ile başlayan yollar; açık yönlendirme engellenir. */
function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/hesap";
  return value;
}
