import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Alert, Platform, View } from "react-native";
import { track } from "@/lib/analytics";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { Input } from "@/mobile/src/components/ui/Input";
import { Text } from "@/mobile/src/components/ui/Text";
import { scoped } from "@/mobile/src/lib/i18n";
import { getSupabase } from "@/mobile/src/lib/supabase";
import { spacing } from "@/mobile/src/theme";

const t = scoped("auth");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_RE = /^\d{6}$/;
export const AUTH_REDIRECT = "aura://auth/callback";

/** OAuth dönüş URL'sinden PKCE kodunu alır (hash veya query). Saf; test edilebilir. */
export function extractAuthCode(url: string): string | null {
  const m = /[?#&]code=([^&#]+)/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Anonim oturumu kalıcı hesaba çevirir (SPEC 2 D17, 15.2 adım 2; SPEC-MOBILE M2).
 * E-posta: updateUser({ email }) → kod → verifyOtp(email_change). Google/Apple: linkIdentity (PKCE) → sistem tarayıcısı →
 * aura://auth/callback?code → exchangeCodeForSession. Apple, Google varsa zorunludur (Apple 4.8).
 */
export function LinkAccount({ onLinked }: { onLinked?: () => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);

  async function sendCode() {
    const value = email.trim().toLowerCase();
    if (!EMAIL_RE.test(value)) {
      Alert.alert(t("invalidEmail"));
      return;
    }
    setBusy(true);
    try {
      const { error } = await getSupabase().auth.updateUser({ email: value });
      if (error) {
        Alert.alert(t("linkError", { message: error.message }));
        return;
      }
      setEmail(value);
      setStep("code");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    const token = code.trim();
    if (!CODE_RE.test(token)) {
      Alert.alert(t("invalidCode"));
      return;
    }
    setBusy(true);
    try {
      const { error } = await getSupabase().auth.verifyOtp({ email, token, type: "email_change" });
      if (error) {
        Alert.alert(t("linkError", { message: error.message }));
        return;
      }
      track("account_linked", { method: "email" });
      onLinked?.();
    } finally {
      setBusy(false);
    }
  }

  async function linkOAuth(provider: "google" | "apple") {
    setBusy(true);
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase.auth.linkIdentity({ provider, options: { redirectTo: AUTH_REDIRECT, skipBrowserRedirect: true } });
      if (error || !data.url) {
        Alert.alert(t("linkError", { message: error?.message ?? "url" }));
        return;
      }
      const res = await WebBrowser.openAuthSessionAsync(data.url, AUTH_REDIRECT);
      if (res.type !== "success") {
        Alert.alert(t("oauthCancelled"));
        return;
      }
      const authCode = extractAuthCode(res.url);
      if (!authCode) {
        Alert.alert(t("linkError", { message: "code" }));
        return;
      }
      const ex = await supabase.auth.exchangeCodeForSession(authCode);
      if (ex.error) {
        Alert.alert(t("linkError", { message: ex.error.message }));
        return;
      }
      track("account_linked", { method: provider === "google" ? "google" : "email" });
      onLinked?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t("linkTitle")} description={t("linkDescription")}>
      {step === "email" ? (
        <View style={{ gap: spacing.sm }}>
          <Input label={t("emailLabel")} placeholder={t("emailPlaceholder")} keyboardType="email-address" autoCapitalize="none" autoComplete="email" value={email} onChangeText={setEmail} />
          <Button title={t("sendCode")} busy={busy} onPress={sendCode} />
        </View>
      ) : (
        <View style={{ gap: spacing.sm }}>
          <Text variant="muted">{t("codeSentTo", { email })}</Text>
          <Input label={t("codeLabel")} placeholder={t("codePlaceholder")} keyboardType="number-pad" maxLength={6} value={code} onChangeText={setCode} />
          <Button title={t("verify")} busy={busy} onPress={verifyCode} />
          <Button title={t("changeEmail")} variant="ghost" onPress={() => setStep("email")} />
        </View>
      )}
      <View style={{ gap: spacing.sm }}>
        <Button title={t("googleContinue")} variant="outline" disabled={busy} onPress={() => void linkOAuth("google")} />
        {Platform.OS === "ios" ? <Button title={t("appleContinue")} variant="outline" disabled={busy} onPress={() => void linkOAuth("apple")} /> : null}
        <Text variant="small">{t("oauthHint")}</Text>
      </View>
    </Card>
  );
}
