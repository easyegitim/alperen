// Taramadan önce Google / Apple girişi (KB §3.1/3 KARAR, P#2) ve e-posta tek kullanımlık kod yedeği (KB §11.11 AÇIK).
// PKCE akışı: signInWithOAuth({ skipBrowserRedirect }) → sistem tarayıcısı (expo-web-browser) → aura://auth/callback?code
// → exchangeCodeForSession. Oturum yokken signInWithOAuth, eski anonim oturum varsa linkIdentity (LinkAccount kalıbı).
// Supabase istemcisi yapısal tiple enjekte edilir: birim testler sahte istemciyle akışı doğrular; ağ yok.

export type OAuthProvider = "google" | "apple";
export const AUTH_REDIRECT = "aura://auth/callback";
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const OTP_CODE_RE = /^\d{6}$/;

/** OAuth dönüş URL'sinden PKCE kodunu alır (hash veya query). Saf; test edilebilir. */
export function extractAuthCode(url: string): string | null {
  const m = /[?#&]code=([^&#]+)/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Dönüş URL'sindeki sağlayıcı hatası (ör. kullanıcı Apple'da iptal etti): error / error_description. */
export function extractAuthError(url: string): string | null {
  const m = /[?#&]error(?:_description)?=([^&#]+)/.exec(url);
  return m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : null;
}

type AuthErr = { message: string } | null;

/** Supabase auth'un kullanılan kısmı (yapısal; gerçek istemci ve test çiftleri uyar). */
export type AuthLike = {
  signInWithOAuth(args: { provider: OAuthProvider; options: { redirectTo: string; skipBrowserRedirect: true } }): Promise<{ data: { url: string | null }; error: AuthErr }>;
  linkIdentity(args: { provider: OAuthProvider; options: { redirectTo: string; skipBrowserRedirect: true } }): Promise<{ data: { url: string | null }; error: AuthErr }>;
  exchangeCodeForSession(code: string): Promise<{ error: AuthErr }>;
  signInWithOtp(args: { email: string; options: { shouldCreateUser: boolean } }): Promise<{ error: AuthErr }>;
  updateUser(args: { email: string }): Promise<{ error: AuthErr }>;
  verifyOtp(args: { email: string; token: string; type: "email" | "email_change" }): Promise<{ error: AuthErr }>;
};

/** Sistem tarayıcısı (expo-web-browser openAuthSessionAsync'in kullanılan kısmı). */
export type OpenAuth = (url: string, redirect: string) => Promise<{ type: string; url?: string }>;

export type SignInResult = { ok: true } | { ok: false; reason: "cancelled" | "error"; message?: string };

/**
 * Google/Apple girişi. anonymous=true: eski anonim oturumu bağlar (linkIdentity); aksi hâlde yeni oturum (signInWithOAuth).
 * Apple, Google varsa zorunludur (Apple 4.8); ekran iOS'ta ikisini de gösterir.
 */
export async function signInWithProvider(auth: AuthLike, provider: OAuthProvider, openAuth: OpenAuth, opts: { anonymous: boolean } = { anonymous: false }): Promise<SignInResult> {
  const options = { redirectTo: AUTH_REDIRECT, skipBrowserRedirect: true as const };
  const { data, error } = opts.anonymous ? await auth.linkIdentity({ provider, options }) : await auth.signInWithOAuth({ provider, options });
  if (error || !data.url) return { ok: false, reason: "error", message: error?.message ?? "url" };
  const res = await openAuth(data.url, AUTH_REDIRECT);
  if (res.type !== "success" || !res.url) return { ok: false, reason: "cancelled" };
  const providerError = extractAuthError(res.url);
  const code = extractAuthCode(res.url);
  if (!code) return { ok: false, reason: providerError ? "cancelled" : "error", message: providerError ?? "code" };
  const ex = await auth.exchangeCodeForSession(code);
  if (ex.error) return { ok: false, reason: "error", message: ex.error.message };
  return { ok: true };
}

/** E-posta koduyla giriş (yedek). Geçersiz e-posta → invalid; anonim oturumda updateUser (e-posta değişikliği kodu). */
export async function startEmailOtp(auth: AuthLike, emailInput: string, opts: { anonymous: boolean } = { anonymous: false }): Promise<{ ok: true; email: string } | { ok: false; reason: "invalid" | "error"; message?: string }> {
  const email = emailInput.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, reason: "invalid" };
  const { error } = opts.anonymous ? await auth.updateUser({ email }) : await auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) return { ok: false, reason: "error", message: error.message };
  return { ok: true, email };
}

export async function verifyEmailOtp(auth: AuthLike, email: string, codeInput: string, opts: { anonymous: boolean } = { anonymous: false }): Promise<{ ok: true } | { ok: false; reason: "invalid" | "error"; message?: string }> {
  const token = codeInput.trim();
  if (!OTP_CODE_RE.test(token)) return { ok: false, reason: "invalid" };
  const { error } = await auth.verifyOtp({ email, token, type: opts.anonymous ? "email_change" : "email" });
  if (error) return { ok: false, reason: "error", message: error.message };
  return { ok: true };
}
