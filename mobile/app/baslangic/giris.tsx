import * as WebBrowser from "expo-web-browser";
import { Stack, router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Linking, Pressable, View } from "react-native";
import { track } from "@/lib/analytics";
import { AGE_GATE_PATH, CONSENTS_PATH } from "@/lib/onboarding/gate";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { Input } from "@/mobile/src/components/ui/Input";
import { Screen } from "@/mobile/src/components/ui/Screen";
import { Text } from "@/mobile/src/components/ui/Text";
import { signInWithProvider, startEmailOtp, verifyEmailOtp, type OAuthProvider } from "@/mobile/src/features/auth/oauth";
import { flushOnboardingDraft, readOnboardingDraft } from "@/mobile/src/features/onboarding/draft";
import { useSession } from "@/mobile/src/features/session/SessionProvider";
import { env } from "@/mobile/src/lib/env";
import { scoped } from "@/mobile/src/lib/i18n";
import { getSupabase } from "@/mobile/src/lib/supabase";
import { spacing, useTheme } from "@/mobile/src/theme";

const t = scoped("auth.signIn");
const ta = scoped("auth");
const tm = scoped("mobile.signIn");

type Flush = "idle" | "running" | "missing" | "error";

/**
 * KB §3.1 adım 3 (P#2): taramadan önce Google ya da Apple ile giriş (PKCE + sistem tarayıcısı, aura://auth/callback).
 * Apple, Google varsa zorunludur (Apple 4.8). E-posta tek kullanımlık kod KB §11.11'de AÇIK: yedek seçenek olarak durur
 * ve bu söylenir. Giriş olunca taslaktaki yaş bandı ve cinsiyet sunucuya yazılır, taslak silinir, izinlere geçilir.
 */
export default function SignInScreen() {
  const { colors } = useTheme();
  const { user, aura } = useSession();
  const signedIn = Boolean(user && !user.is_anonymous);
  const anonymous = Boolean(user?.is_anonymous);
  const [busy, setBusy] = useState<OAuthProvider | "email" | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [flush, setFlush] = useState<Flush>("idle");
  const flushedRef = useRef(false);

  const runFlush = useCallback(async () => {
    if (!user) return;
    setFlush("running");
    try {
      const { data } = await getSupabase().from("profiles").select("age_band, presentation").eq("id", user.id).maybeSingle();
      const plan = await flushOnboardingDraft(aura.onboarding, await readOnboardingDraft(), { hasAgeBand: Boolean(data?.age_band), hasPresentation: Boolean(data?.presentation) });
      if (plan.kind === "missing") {
        setFlush("missing");
        return;
      }
      track("onboarding_step_completed", { step: "account" });
      router.replace(CONSENTS_PATH);
    } catch {
      setFlush("error");
      flushedRef.current = false;
    }
  }, [user, aura]);

  useEffect(() => {
    if (!signedIn || flushedRef.current) return;
    flushedRef.current = true;
    void runFlush();
  }, [signedIn, runFlush]);

  async function oauth(provider: OAuthProvider) {
    setBusy(provider);
    track("sign_in_started", { method: provider });
    try {
      const r = await signInWithProvider(getSupabase().auth, provider, (url, redirect) => WebBrowser.openAuthSessionAsync(url, redirect), { anonymous });
      if (!r.ok) {
        Alert.alert(r.reason === "cancelled" ? t("cancelled") : t("error"));
        return;
      }
      track("account_linked", { method: provider });
      // Oturum değişikliği SessionProvider'dan gelir; effect taslağı yazar ve izinlere geçer.
    } catch {
      Alert.alert(t("error"));
    } finally {
      setBusy(null);
    }
  }

  async function sendCode() {
    setBusy("email");
    track("sign_in_started", { method: "email" });
    try {
      const r = await startEmailOtp(getSupabase().auth, email, { anonymous });
      if (!r.ok) {
        Alert.alert(r.reason === "invalid" ? ta("invalidEmail") : t("error"));
        return;
      }
      setEmail(r.email);
      setCodeSent(true);
    } finally {
      setBusy(null);
    }
  }

  async function verifyCode() {
    setBusy("email");
    try {
      const r = await verifyEmailOtp(getSupabase().auth, email, code, { anonymous });
      if (!r.ok) {
        Alert.alert(r.reason === "invalid" ? ta("invalidCode") : t("error"));
        return;
      }
      track("account_linked", { method: "email" });
    } finally {
      setBusy(null);
    }
  }

  if (signedIn) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: t("title"), headerBackTitle: "Geri" }} />
        <Screen>
          {flush === "missing" ? (
            <Card description={t("choicesMissing")}>
              <Button title={t("backToStart")} onPress={() => router.replace(AGE_GATE_PATH)} />
            </Card>
          ) : flush === "error" ? (
            <Card>
              <Text accessibilityRole="alert">{t("saveError")}</Text>
              <Button title={t("retry")} onPress={() => void runFlush()} />
            </Card>
          ) : (
            <Text variant="muted" accessibilityLiveRegion="polite" style={{ textAlign: "center", paddingVertical: spacing.xl }}>{t("finishing")}</Text>
          )}
        </Screen>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t("title"), headerBackTitle: "Geri" }} />
      <Screen>
        <Card title={t("title")} description={t("body")}>
          <View style={{ gap: spacing.sm }}>
            <Button title={t("google")} size="lg" disabled={busy !== null} busy={busy === "google"} onPress={() => void oauth("google")} />
            <Button title={t("apple")} size="lg" variant="outline" disabled={busy !== null} busy={busy === "apple"} onPress={() => void oauth("apple")} />
            <Text variant="small">{tm("openBrowser")}</Text>
          </View>
          {!emailOpen ? (
            <Pressable accessibilityRole="button" onPress={() => setEmailOpen(true)} style={{ minHeight: 44, justifyContent: "center", alignItems: "center" }}>
              <Text style={{ color: colors.brand, fontWeight: "600" }}>{tm("emailFallback")}</Text>
            </Pressable>
          ) : !codeSent ? (
            <View style={{ gap: spacing.sm }}>
              <Input label={ta("emailLabel")} placeholder={ta("emailPlaceholder")} keyboardType="email-address" autoCapitalize="none" autoComplete="email" value={email} onChangeText={setEmail} returnKeyType="send" onSubmitEditing={() => void sendCode()} />
              <Button title={ta("sendCode")} variant="outline" busy={busy === "email"} disabled={busy !== null} onPress={() => void sendCode()} />
              <Text variant="small">{t("emailNote")}</Text>
            </View>
          ) : (
            <View style={{ gap: spacing.sm }}>
              <Text variant="muted">{ta("codeSentTo", { email })}</Text>
              <Input label={ta("codeLabel")} placeholder={ta("codePlaceholder")} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" value={code} onChangeText={setCode} returnKeyType="done" onSubmitEditing={() => void verifyCode()} />
              <Button title={ta("verify")} busy={busy === "email"} disabled={busy !== null} onPress={() => void verifyCode()} />
              <Button title={ta("changeEmail")} variant="ghost" disabled={busy !== null} onPress={() => setCodeSent(false)} />
            </View>
          )}
          <Text variant="small">
            {t("legalNote")}{" "}
            <Text variant="small" style={{ color: colors.brand, fontWeight: "600" }} accessibilityRole="link" onPress={() => void Linking.openURL(`${env.apiUrl}/yasal/kullanim-kosullari`)}>
              {t("terms")}
            </Text>
          </Text>
        </Card>
      </Screen>
    </>
  );
}
