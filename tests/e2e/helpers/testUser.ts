/**
 * E2E test kullanıcısı (v2, anonim oturum yok): auth.admin.createUser ile sahte e-posta, doğrulanmış; oturum çerezi
 * tarayıcıya yazılır (sb-<ref>-auth-token, 3180'lik parçalar). Testin sonunda silinir. Gerçek kullanıcı verisi yok.
 */
import type { BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

export const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} gerekli — tests/e2e başlığına bak.`);
  return v;
};

export async function createTestUser(context: BrowserContext, baseURL: string, prefix = "e2e") {
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const admin = createClient(url, env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const anon = createClient(url, env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), { auth: { persistSession: false } });
  const email = `${prefix}-${randomUUID()}@example.test`;
  const password = randomUUID();
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !created.user) throw new Error("test kullanıcısı açılamadı");
  const { data: signed } = await anon.auth.signInWithPassword({ email, password });
  if (!signed.session) throw new Error("test oturumu açılamadı");
  const ref = new URL(url).hostname.split(".")[0];
  const enc = "base64-" + Buffer.from(JSON.stringify(signed.session)).toString("base64url");
  const name = `sb-${ref}-auth-token`;
  const chunks: { name: string; value: string }[] = [];
  if (enc.length <= 3180) chunks.push({ name, value: enc });
  else for (let i = 0, n = 0; i < enc.length; i += 3180, n++) chunks.push({ name: `${name}.${n}`, value: enc.slice(i, i + 3180) });
  const host = new URL(baseURL).hostname;
  await context.addCookies(chunks.map((c) => ({ ...c, domain: host, path: "/", sameSite: "Lax" as const })));
  const id = created.user.id;
  return { id, email, accessToken: signed.session.access_token, cleanup: async () => void (await admin.auth.admin.deleteUser(id)) };
}
