"use client";

import { ArrowRight, KeyRound, LoaderCircle, Mail, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { track } from "@/lib/analytics";
import { postJson } from "@/lib/api/client";
import { TEST_PASSWORD_MIN_LENGTH, testPasswordLoginEnabled } from "@/lib/auth/testLogin";
import { createClient } from "@/lib/db/browser";
import { AGE_GATE_PATH } from "@/lib/onboarding/gate";
import { clearDraft, readDraft } from "@/lib/onboarding/draft";

type Provider = "google" | "apple";

type Props = {
  /** Sunucudan: oturum var mı, anonim mi (eski oturumlar linkIdentity ile bağlanır), profil alanları yazılmış mı. */
  session: { signedIn: boolean; anonymous: boolean; hasAgeBand: boolean; hasPresentation: boolean };
  /** Giriş sonrası dönülecek yol (bu sayfa: taslak sunucuya yazılır, sonra izinlere geçilir). */
  returnPath: string;
  nextPath: string;
  authError?: boolean;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_RE = /^\d{6}$/;
/** Yalnız yerel/ekip içi test (lib/auth/testLogin.ts); üretimde tanımsız → kapalı. */
const TEST_PASSWORD_LOGIN = testPasswordLoginEnabled(process.env.NEXT_PUBLIC_TEST_PASSWORD_LOGIN);

/**
 * KB §3.1 adım 3 (P#2): taramadan önce Google ya da Apple ile giriş. Anonim oturum kalktı. E-posta (tek kullanımlık kod)
 * KB §11.11'de AÇIK olduğu için yedek seçenek olarak duruyor ve bu söylenir. Giriş olunca sessionStorage'daki yaş bandı ve
 * cinsiyet sunucuya yazılır, taslak silinir, izinlere geçilir. Apple web girişi Apple Developer yapılandırması ister (insan işi).
 */
export function SignIn({ session, returnPath, nextPath, authError }: Props) {
  const t = useTranslations("auth.signIn");
  const ta = useTranslations("auth");
  const router = useRouter();
  const [busy, setBusy] = useState<Provider | "email" | "flush" | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [password, setPassword] = useState("");
  const [flushState, setFlushState] = useState<"idle" | "running" | "missing" | "error">("idle");
  const flushedRef = useRef(false);

  useEffect(() => {
    if (authError) toast.error(t("error"));
  }, [authError, t]);

  // Giriş var: taslağı sunucuya yaz (yalnız bir kez), sonra izinlere.
  useEffect(() => {
    if (!session.signedIn || session.anonymous || flushedRef.current) return;
    flushedRef.current = true;
    void flush();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnız ilk yüklemede
  }, [session.signedIn, session.anonymous]);

  async function flush() {
    setFlushState("running");
    const draft = readDraft();
    const ageBand = draft.ageBand;
    const presentation = draft.presentation;
    if ((!ageBand && !session.hasAgeBand) || (!presentation && !session.hasPresentation)) {
      setFlushState("missing");
      return;
    }
    try {
      if (ageBand && !session.hasAgeBand) await postJson("/api/onboarding/age", { ageBand });
      if (presentation && !session.hasPresentation) await postJson("/api/onboarding/profile", { presentation });
      clearDraft();
      track("onboarding_step_completed", { step: "account" });
      router.replace(nextPath);
    } catch {
      setFlushState("error");
      flushedRef.current = false;
    }
  }

  async function oauth(provider: Provider) {
    setBusy(provider);
    track("sign_in_started", { method: provider });
    try {
      const supabase = createClient();
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(returnPath)}`;
      const { error } = session.anonymous
        ? await supabase.auth.linkIdentity({ provider, options: { redirectTo } })
        : await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } });
      if (error) {
        toast.error(t("error"));
        setBusy(null);
      }
      // Başarıda tarayıcı sağlayıcıya yönlenir; callback bu sayfaya döner.
    } catch {
      toast.error(t("error"));
      setBusy(null);
    }
  }

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    const value = email.trim().toLowerCase();
    if (!EMAIL_RE.test(value)) {
      toast.error(ta("invalidEmail"));
      return;
    }
    setBusy("email");
    track("sign_in_started", { method: "email" });
    try {
      const supabase = createClient();
      const { error } = session.anonymous
        ? await supabase.auth.updateUser({ email: value })
        : await supabase.auth.signInWithOtp({ email: value, options: { shouldCreateUser: true } });
      if (error) {
        toast.error(t("error"));
        return;
      }
      setEmail(value);
      setCodeSent(true);
    } finally {
      setBusy(null);
    }
  }

  async function verifyCode(e: FormEvent) {
    e.preventDefault();
    const token = code.trim();
    if (!CODE_RE.test(token)) {
      toast.error(ta("invalidCode"));
      return;
    }
    setBusy("email");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.verifyOtp({ email, token, type: session.anonymous ? "email_change" : "email" });
      if (error) {
        toast.error(t("error"));
        return;
      }
      track("account_linked", { method: "email" });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function passwordSignIn(e: FormEvent) {
    e.preventDefault();
    const value = email.trim().toLowerCase();
    if (!EMAIL_RE.test(value) || password.length < TEST_PASSWORD_MIN_LENGTH) {
      toast.error(t("testLogin.invalid"));
      return;
    }
    setBusy("email");
    track("sign_in_started", { method: "email" });
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email: value, password });
      if (error) {
        // Teşhis için yalnız hata kodu (e-posta/şifre yazılmaz).
        console.warn("[auth] test login failed", error.code ?? error.status ?? "unknown");
        toast.error(t("testLogin.failed"));
        return;
      }
      track("account_linked", { method: "email" });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (session.signedIn && !session.anonymous) {
    if (flushState === "missing") {
      return (
        <div className="space-y-4 rounded-2xl border bg-card p-5 shadow-card">
          <p className="text-sm">{t("choicesMissing")}</p>
          <Button asChild className="w-full">
            <Link href={AGE_GATE_PATH}>{t("backToStart")}</Link>
          </Button>
        </div>
      );
    }
    if (flushState === "error") {
      return (
        <div className="space-y-4 rounded-2xl border bg-card p-5 shadow-card">
          <p role="alert" className="text-sm">
            {t("saveError")}
          </p>
          <Button className="w-full" onClick={() => void flush()}>
            {t("retry")}
          </Button>
        </div>
      );
    }
    return (
      <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground" role="status">
        <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
        {t("finishing")}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <span className="grid size-14 place-items-center rounded-2xl bg-brand-soft text-brand" aria-hidden="true">
          <ShieldCheck className="size-6" />
        </span>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("body")}</p>
        </div>
      </div>

      {TEST_PASSWORD_LOGIN ? (
        <form onSubmit={passwordSignIn} className="space-y-3 rounded-2xl border border-brand/40 bg-card p-4 shadow-card" aria-labelledby="test-login-title">
          <p id="test-login-title" className="flex items-center gap-2 text-sm font-semibold">
            <KeyRound aria-hidden="true" className="size-4 text-brand" />
            {t("testLogin.title")}
          </p>
          <p className="text-[11px] leading-relaxed text-muted-foreground">{t("testLogin.note")}</p>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{ta("emailLabel")}</span>
            <Input type="email" name="email" autoComplete="email" inputMode="email" placeholder={ta("emailPlaceholder")} value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{t("testLogin.password")}</span>
            <Input type="password" name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <Button type="submit" size="lg" className="w-full" disabled={busy !== null}>
            {t("testLogin.submit")}
            <ArrowRight aria-hidden="true" />
          </Button>
        </form>
      ) : null}

      <div className="grid gap-2">
        <Button size="lg" className="w-full" disabled={busy !== null} onClick={() => void oauth("google")}>
          <GoogleMark />
          {t("google")}
        </Button>
        <Button size="lg" variant="outline" className="w-full" disabled={busy !== null} onClick={() => void oauth("apple")}>
          <AppleMark />
          {t("apple")}
        </Button>
      </div>

      {!emailOpen ? (
        <button
          type="button"
          onClick={() => setEmailOpen(true)}
          className="mx-auto flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand underline-offset-4 hover:underline"
        >
          <Mail aria-hidden="true" className="size-4" />
          {t("email")}
        </button>
      ) : !codeSent ? (
        <form onSubmit={sendCode} className="space-y-3 rounded-2xl border bg-card p-4 shadow-card">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{ta("emailLabel")}</span>
            <Input type="email" name="email" autoComplete="email" inputMode="email" placeholder={ta("emailPlaceholder")} value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <Button type="submit" variant="outline" className="w-full" disabled={busy !== null}>
            {ta("sendCode")}
            <ArrowRight aria-hidden="true" />
          </Button>
          <p className="text-[11px] leading-relaxed text-muted-foreground">{t("emailNote")}</p>
        </form>
      ) : (
        <form onSubmit={verifyCode} className="space-y-3 rounded-2xl border bg-card p-4 shadow-card">
          <p className="text-sm text-muted-foreground">{ta("codeSentTo", { email })}</p>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{ta("codeLabel")}</span>
            <Input type="text" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder={ta("codePlaceholder")} value={code} onChange={(e) => setCode(e.target.value)} required />
          </label>
          <Button type="submit" className="w-full" disabled={busy !== null}>
            {ta("verify")}
          </Button>
          <Button type="button" variant="ghost" className="w-full" disabled={busy !== null} onClick={() => setCodeSent(false)}>
            {ta("changeEmail")}
          </Button>
        </form>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {t("legalNote")}{" "}
        <Link href="/yasal/kullanim-kosullari" className="font-semibold text-brand underline-offset-4 hover:underline">
          {t("terms")}
        </Link>
      </p>
    </div>
  );
}

/** Marka işaretleri (dekoratif; metin düğmede). */
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.6-.2-2.3H12v4.3h6.5c-.1 1.1-.8 2.7-2.3 3.8l3.7 2.9c2.2-2.1 3.6-5.2 3.6-8.7z" />
      <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.7-2.9c-1 .7-2.4 1.2-4.2 1.2-3.2 0-5.9-2.1-6.8-5.1L1.3 17.2C3.3 21.2 7.3 24 12 24z" />
      <path fill="#FBBC05" d="M5.2 14.3c-.3-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3V6.8H1.3C.5 8.4 0 10.1 0 12s.5 3.6 1.3 5.2l3.9-2.9z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3 .8 3.7 1.4l2.7-2.6C16.9 2 14.5 1 12 1 7.3 1 3.3 3.8 1.3 7.8l3.9 2.9c.9-3 3.6-5.9 6.8-5.9z" />
    </svg>
  );
}

function AppleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 fill-current" aria-hidden="true">
      <path d="M16.4 12.7c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8-1.6 0-3.1 1-4 2.4-1.7 3-.4 7.3 1.2 9.7.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8-.1 0-2.6-1-2.6-3.8zM14 5.5c.7-.8 1.1-2 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4z" />
    </svg>
  );
}
