import type { Session, User } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { clearCaptureState } from "@/mobile/src/features/capture/captureSession";
import { createApiClient, createAuraApi, type AuraApi } from "@/mobile/src/lib/api";
import { isSupabaseConfigured } from "@/mobile/src/lib/env";
import { getSupabase } from "@/mobile/src/lib/supabase";

type SessionState = {
  loading: boolean;
  session: Session | null;
  user: User | null;
  configured: boolean;
  api: ReturnType<typeof createApiClient>;
  /** Tipli v2 uç noktaları (CONTRACTS_V2 Sprint 3 S3.2); aynı token kaynağı. */
  aura: AuraApi;
  signOut: () => Promise<void>;
};

const Ctx = createContext<SessionState | null>(null);

/** Supabase oturumunu tek yerden sağlar; API istemcisi erişim token'ını her istekte taze okur. */
export function SessionProvider({ children }: PropsWithChildren) {
  // Yapılandırma yoksa yüklenecek oturum da yoktur; başlangıç durumu buradan türetilir (effect içinde setState yok).
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const supabase = getSupabase();
    let active = true;
    // Çekim durumu (selfie, bekleyen set, hayalet çizgi) kullanıcıya aittir: oturumdaki kullanıcı değişirse ya da düşerse
    // bellekten ve önbellekten silinir (bir sonraki hesap öncekinin yüzünü görmesin/göndermesin).
    let lastUserId: string | null | undefined;
    const onUser = (id: string | null) => {
      if (lastUserId !== undefined && lastUserId !== id) void clearCaptureState();
      lastUserId = id;
    };
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      onUser(data.session?.user.id ?? null);
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (!active) return;
      onUser(s?.user.id ?? null);
      setSession(s);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<SessionState>(() => {
    const api = createApiClient(async () => {
      if (!isSupabaseConfigured) return null;
      const { data } = await getSupabase().auth.getSession();
      return data.session?.access_token ?? null;
    });
    return {
      loading,
      session,
      user: session?.user ?? null,
      configured: isSupabaseConfigured,
      api,
      aura: createAuraApi(api),
      signOut: async () => {
        await clearCaptureState();
        if (isSupabaseConfigured) await getSupabase().auth.signOut();
        setSession(null);
      },
    };
  }, [loading, session]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession SessionProvider içinde kullanılmalı");
  return v;
}
