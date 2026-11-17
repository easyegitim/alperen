"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getPublicSupabaseEnv } from "./env";

/** Tarayıcı istemcisi; @supabase/ssr çerezleri kendisi yönetir. Her çağrı aynı singleton'ı döndürür. */
export function createClient() {
  const { url, key } = getPublicSupabaseEnv();
  return createBrowserClient(url, key);
}
