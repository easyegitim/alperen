import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Share, View } from "react-native";
import { track } from "@/lib/analytics";
import { Button } from "@/mobile/src/components/ui/Button";
import { Text } from "@/mobile/src/components/ui/Text";
import { useSession } from "@/mobile/src/features/session/SessionProvider";
import type { ReferralDto } from "@/mobile/src/lib/api";
import { scoped } from "@/mobile/src/lib/i18n";
import { radius, spacing, useTheme } from "@/mobile/src/theme";
import { ReferralClaimForm } from "./ReferralClaimForm";

const t = scoped("paywall.v2.referral");
const tc = scoped("referral.claim");

/**
 * Davet kilidi (KB P#15/Ç12, FEATURE_REFERRAL_UNLOCK): paywall sayfa 1'de davet kodu, ilerleme ve kod girişi.
 * GET /api/referral bayrak kapalıyken FEATURE_DISABLED → blok hiç çizilmez. Paylaşım metni yalnız kodu taşır.
 */
export function ReferralBlock() {
  const { colors } = useTheme();
  const { aura } = useSession();
  const [state, setState] = useState<ReferralDto | null>(null);
  const [claimOpen, setClaimOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void aura.referral
      .get()
      .then((r) => {
        if (!active || !r || typeof r.code !== "string") return;
        setState(r);
        track("referral_code_viewed");
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [aura]);

  if (!state) return null;

  async function share() {
    if (!state) return;
    try {
      await Share.share({ message: t("shareText", { code: state.code }) });
    } catch {
      // kullanıcı paylaşımı iptal etti
    }
  }

  return (
    <View style={{ gap: spacing.sm, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.card }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
        <Ionicons name="people-outline" size={16} color={colors.brand} />
        <Text style={{ fontWeight: "600" }} accessibilityRole="header">{t("title")}</Text>
      </View>
      <Text variant="small">{t("body")}</Text>
      <Text variant="small" style={{ fontWeight: "500", color: colors.foreground }} accessibilityLiveRegion="polite">{t("progress", { done: state.progress.done, total: state.progress.total })}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.muted }}>
        <View>
          <Text variant="small">{t("code")}</Text>
          <Text style={{ fontWeight: "700", letterSpacing: 1.5 }} selectable>{state.code}</Text>
        </View>
        <Button title={t("share")} variant="outline" onPress={() => void share()} />
      </View>
      {claimOpen ? <ReferralClaimForm onDone={() => setClaimOpen(false)} /> : <Button title={tc("title")} variant="ghost" onPress={() => setClaimOpen(true)} />}
    </View>
  );
}
