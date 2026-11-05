import { Stack, router } from "expo-router";
import { useState } from "react";
import { Alert, View } from "react-native";
import { track } from "@/lib/analytics";
import { AGE_BANDS, type AgeBand } from "@/lib/onboarding/age";
import { GENDER_PATH } from "@/lib/onboarding/gate";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { OptionRow } from "@/mobile/src/components/ui/OptionRow";
import { Screen } from "@/mobile/src/components/ui/Screen";
import { Text } from "@/mobile/src/components/ui/Text";
import { ageBandOutcome, writeOnboardingDraft } from "@/mobile/src/features/onboarding/draft";
import { useSession } from "@/mobile/src/features/session/SessionProvider";
import { ApiClientError } from "@/mobile/src/lib/api";
import { isMobileFeatureEnabled } from "@/mobile/src/lib/flags";
import { scoped } from "@/mobile/src/lib/i18n";
import { radius, spacing, useTheme } from "@/mobile/src/theme";

const t = scoped("onboarding.age");

/**
 * KB §3.1 adım 1 (P#1/Ç1): yaş bandı listesi; yaş sınırı yok, 18 altı bandı bayrakla (kapalıyken "yakında"). Doğum yılı
 * artık sorulmaz. Oturum varsa seçim hemen sunucuya yazılır; yoksa taslağa girer ve girişten sonra yazılır.
 */
export default function AgeBandScreen() {
  const { colors } = useTheme();
  const { user, aura } = useSession();
  const signedIn = Boolean(user && !user.is_anonymous);
  const under18Enabled = isMobileFeatureEnabled("under18");
  const [band, setBand] = useState<AgeBand | null>(null);
  const [busy, setBusy] = useState(false);
  const [soon, setSoon] = useState(false);

  async function submit() {
    if (!band) return;
    if (ageBandOutcome(band, under18Enabled) === "soon") {
      track("onboarding_step_completed", { step: "age_under18_soon" });
      setSoon(true);
      return;
    }
    setBusy(true);
    try {
      await writeOnboardingDraft({ ageBand: band });
      if (signedIn) {
        const res = await aura.onboarding.age(band);
        if (ageBandOutcome(band, under18Enabled, res?.isAdult) === "soon") {
          track("onboarding_step_completed", { step: "age_under18_soon" });
          setSoon(true);
          return;
        }
      }
      track("onboarding_step_completed", { step: "age" });
      router.push(GENDER_PATH);
    } catch (e) {
      if (e instanceof ApiClientError && e.code === "FEATURE_DISABLED") setSoon(true);
      else Alert.alert(t("error"));
    } finally {
      setBusy(false);
    }
  }

  if (soon) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: t("bandTitle"), headerBackTitle: "Geri" }} />
        <Screen>
          <Card title={t("under18SoonTitle")} description={t("under18SoonBody")}>
            <Button title={t("changeBand")} variant="outline" onPress={() => setSoon(false)} />
            <Button title={t("backHome")} variant="ghost" onPress={() => router.replace("/")} />
          </Card>
        </Screen>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t("bandTitle"), headerBackTitle: "Geri" }} />
      <Screen>
        <Card title={t("bandTitle")} description={t("bandDescription")}>
          <View style={{ gap: spacing.sm }} accessibilityRole="radiogroup">
            {AGE_BANDS.map((b) => {
              const soonBand = b === "under_18" && !under18Enabled;
              return (
                <View key={b}>
                  <OptionRow kind="radio" selected={band === b} onPress={() => setBand(b)} label={t(`bands.${b}`)} hint={soonBand ? t("soonTag") : undefined} />
                </View>
              );
            })}
          </View>
          <Button title={t("continue")} size="lg" disabled={!band} busy={busy} onPress={() => void submit()} />
          <View style={{ padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.muted }}>
            <Text variant="small">{t("bandNote")}</Text>
          </View>
        </Card>
      </Screen>
    </>
  );
}
