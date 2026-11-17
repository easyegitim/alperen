import { AUTH_REDIRECT, extractAuthCode, extractAuthError, signInWithProvider, startEmailOtp, verifyEmailOtp, type AuthLike } from "@/mobile/src/features/auth/oauth";

function fakeAuth(overrides: Partial<AuthLike> = {}) {
  const calls: string[] = [];
  const auth: AuthLike = {
    signInWithOAuth: async ({ provider, options }) => {
      calls.push(`oauth:${provider}:${options.redirectTo}:${options.skipBrowserRedirect}`);
      return { data: { url: `https://sb.test/authorize?provider=${provider}` }, error: null };
    },
    linkIdentity: async ({ provider }) => {
      calls.push(`link:${provider}`);
      return { data: { url: "https://sb.test/link" }, error: null };
    },
    exchangeCodeForSession: async (code) => {
      calls.push(`exchange:${code}`);
      return { error: null };
    },
    signInWithOtp: async ({ email, options }) => {
      calls.push(`otp:${email}:${options.shouldCreateUser}`);
      return { error: null };
    },
    updateUser: async ({ email }) => {
      calls.push(`update:${email}`);
      return { error: null };
    },
    verifyOtp: async ({ email, token, type }) => {
      calls.push(`verify:${email}:${token}:${type}`);
      return { error: null };
    },
    ...overrides,
  };
  return { auth, calls };
}

describe("Google/Apple girişi (KB §3.1/3; PKCE + sistem tarayıcısı)", () => {
  it("dönüş URL'sinden kod ve hata ayrıştırılır", () => {
    expect(extractAuthCode("aura://auth/callback?code=abc-123")).toBe("abc-123");
    expect(extractAuthCode("aura://auth/callback#code=x%2By")).toBe("x+y");
    expect(extractAuthCode("aura://auth/callback?state=1")).toBeNull();
    expect(extractAuthError("aura://auth/callback?error=access_denied&error_description=User+cancelled")).toBe("access_denied");
    expect(extractAuthError("aura://auth/callback?code=1")).toBeNull();
  });

  it("oturum yokken signInWithOAuth (skipBrowserRedirect) → tarayıcı → exchangeCodeForSession", async () => {
    const { auth, calls } = fakeAuth();
    const opened: string[] = [];
    const r = await signInWithProvider(auth, "google", async (url, redirect) => {
      opened.push(`${url}|${redirect}`);
      return { type: "success", url: `${redirect}?code=pkce-1` };
    });
    expect(r).toEqual({ ok: true });
    expect(opened).toEqual([`https://sb.test/authorize?provider=google|${AUTH_REDIRECT}`]);
    expect(calls).toEqual([`oauth:google:${AUTH_REDIRECT}:true`, "exchange:pkce-1"]);
  });

  it("eski anonim oturum linkIdentity ile bağlanır (Apple dahil)", async () => {
    const { auth, calls } = fakeAuth();
    const r = await signInWithProvider(auth, "apple", async (_u, redirect) => ({ type: "success", url: `${redirect}?code=c2` }), { anonymous: true });
    expect(r.ok).toBe(true);
    expect(calls).toEqual(["link:apple", "exchange:c2"]);
  });

  it("tarayıcı iptali, sağlayıcı hatası ve değişim hatası ayrı sonuçlar verir; oturum açılmaz", async () => {
    const { auth, calls } = fakeAuth();
    expect(await signInWithProvider(auth, "google", async () => ({ type: "cancel" }))).toEqual({ ok: false, reason: "cancelled" });
    expect(await signInWithProvider(auth, "google", async () => ({ type: "success", url: `${AUTH_REDIRECT}?error=access_denied` }))).toMatchObject({ ok: false, reason: "cancelled" });
    expect(calls.filter((c) => c.startsWith("exchange"))).toHaveLength(0);
    const bad = fakeAuth({ exchangeCodeForSession: async () => ({ error: { message: "invalid_grant" } }) });
    expect(await signInWithProvider(bad.auth, "google", async () => ({ type: "success", url: `${AUTH_REDIRECT}?code=z` }))).toEqual({ ok: false, reason: "error", message: "invalid_grant" });
    const noUrl = fakeAuth({ signInWithOAuth: async () => ({ data: { url: null }, error: { message: "provider_disabled" } }) });
    expect(await signInWithProvider(noUrl.auth, "apple", async () => ({ type: "success" }))).toEqual({ ok: false, reason: "error", message: "provider_disabled" });
  });

  it("e-posta kodu yedeği: geçersiz e-posta/kod reddedilir; signInWithOtp → verifyOtp(type email); anonimde email_change", async () => {
    const { auth, calls } = fakeAuth();
    expect(await startEmailOtp(auth, "yanlış")).toEqual({ ok: false, reason: "invalid" });
    expect(await startEmailOtp(auth, "  Kisi@Ornek.com ")).toEqual({ ok: true, email: "kisi@ornek.com" });
    expect(await verifyEmailOtp(auth, "kisi@ornek.com", "12")).toEqual({ ok: false, reason: "invalid" });
    expect(await verifyEmailOtp(auth, "kisi@ornek.com", " 123456 ")).toEqual({ ok: true });
    await startEmailOtp(auth, "a@b.co", { anonymous: true });
    await verifyEmailOtp(auth, "a@b.co", "654321", { anonymous: true });
    expect(calls).toEqual(["otp:kisi@ornek.com:true", "verify:kisi@ornek.com:123456:email", "update:a@b.co", "verify:a@b.co:654321:email_change"]);
  });
});
