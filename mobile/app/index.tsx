import { router } from "expo-router";
import { Linking, Pressable, View } from "react-native";
import { track } from "@/lib/analytics";
import { LEGAL_SLUGS } from "@/lib/consent";
import { AGE_GATE_PATH } from "@/lib/onboarding/gate";
import { Button } from "@/mobile/src/components/ui/Button";
import { Screen } from "@/mobile/src/components/ui/Screen";
import { Text } from "@/mobile/src/components/ui/Text";
import { useSession } from "@/mobile/src/features/session/SessionProvider";
import { env } from "@/mobile/src/lib/env";
import { t } from "@/mobile/src/lib/i18n";
import { radius, spacing, useTheme } from "@/mobile/src/theme";

/**
 * Açılış (SPEC 4.2 "/"; KB §3.1 v2): başlık, 3 adım, CTA, yasal linkler (web'de açılır). Anonim oturum KALKTI (KB P#2,
 * CONTRACTS_V2 §2.3): CTA yaş bandına gider; hesap taramadan önce Google/Apple ile açılır. Oturum varsa sekmelere
 * (kapı eksik adıma yönlendirir). Fiyatlar ve SSS web sitesinde; "ücretsiz" sözü yok (R2-Ö5).
 */
export default function Landing() {
  const { colors } = useTheme();
  const { configured, user, loading } = useSession();

  function onStart() {
    track("landing_cta_clicked");
    if (user && !user.is_anonymous) {
      router.push("/(tabs)/analiz");
      return;
    }
    router.push(AGE_GATE_PATH);
  }

  const steps = ["s1", "s2", "s3"] as const;

  return (
    <Screen>
      <View style={{ gap: spacing.sm, paddingTop: spacing.lg }}>
        <Text variant="small" style={{ textTransform: "uppercase", letterSpacing: 1 }}>{t("landing.heroEyebrow")}</Text>
        <Text variant="title" accessibilityRole="header">{t("landing.heroTitle")}</Text>
        <Text variant="muted">{t("landing.heroSubtitle")}</Text>
        <Text variant="small">{t("landing.heroNote")}</Text>
      </View>

      <Button title={loading ? t("common.loading") : t("common.startAnalysis")} size="lg" onPress={onStart} disabled={loading || !configured} />
      {!configured ? <Text variant="small" accessibilityRole="alert">{t("auth.configError")}</Text> : null}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }} accessibilityLabel={t("landing.trustLabel")}>
        {(["photo", "adult", "fair"] as const).map((k) => (
          <View key={k} style={{ paddingHorizontal: 10, height: 26, borderRadius: radius.full, backgroundColor: colors.muted, justifyContent: "center" }}>
            <Text variant="small">{t(`landing.trust.${k}`)}</Text>
          </View>
        ))}
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text variant="heading" accessibilityRole="header">{t("landing.howTitle")}</Text>
        {steps.map((s, i) => (
          <View key={s} style={{ flexDirection: "row", gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg }}>
            <Text variant="heading" style={{ color: colors.brand }}>{i + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: "600" }}>{t(`landing.steps.${s}.title`)}</Text>
              <Text variant="muted">{t(`landing.steps.${s}.body`)}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={{ gap: spacing.xs, paddingBottom: spacing.xl }}>
        <Text variant="small">{t("common.adultOnly")} {t("common.photoNotStored")}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {LEGAL_SLUGS.map((slug) => (
            <Pressable key={slug} accessibilityRole="link" onPress={() => void Linking.openURL(`${env.apiUrl}/yasal/${slug}`)} style={{ minHeight: 32, justifyContent: "center" }}>
              <Text variant="small" style={{ textDecorationLine: "underline" }}>{t(`legal.links.${slug}`)}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </Screen>
  );
}
