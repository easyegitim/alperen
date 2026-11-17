import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Linking, Platform, Pressable, View } from "react-native";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { Screen } from "@/mobile/src/components/ui/Screen";
import { Text } from "@/mobile/src/components/ui/Text";
import { ConsentSettings } from "@/mobile/src/features/account/ConsentSettings";
import { DataExport } from "@/mobile/src/features/account/DataExport";
import { DeleteAccount } from "@/mobile/src/features/account/DeleteAccount";
import { LinkAccount } from "@/mobile/src/features/auth/LinkAccount";
import { LEGAL_SLUGS } from "@/lib/consent";
import { env } from "@/mobile/src/lib/env";
import { storeManageUrl } from "@/mobile/src/features/billing/plans";
import { ensurePurchases, isPurchasesConfigured, restore } from "@/mobile/src/features/billing/purchases";
import { useSession } from "@/mobile/src/features/session/SessionProvider";
import { scoped, t } from "@/mobile/src/lib/i18n";
import { spacing } from "@/mobile/src/theme";

const ts = scoped("account.subscription");
const tp = scoped("pricing");
type Status = { premium: boolean; plan: string | null; periodEnd: string | null; cancelAtPeriodEnd: boolean };

/** /hesap (M7): e-posta/anonim, hesap bağlama, plan ve mağaza yönetimi, rızalar, verimi indir, yasal metinler, hesabımı sil, çıkış. */
export default function AccountScreen() {
  const { user, signOut, api } = useSession();
  const [linked, setLinked] = useState(!(user?.is_anonymous ?? true));
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void api.get<Status>("/api/billing/status").then(setStatus).catch(() => setStatus(null));
  }, [api]);
  useEffect(load, [load]);

  const end = status?.periodEnd ? new Date(status.periodEnd).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" }) : null;
  const planName = status?.plan ? (status.plan === "week_pass" ? ts("weekPass") : tp(`plans.${status.plan}.name`)) : ts("free");

  async function restorePurchases() {
    if (!user || !isPurchasesConfigured()) return;
    setBusy(true);
    try {
      await ensurePurchases(user.id);
      await restore();
      await api.post("/api/billing/sync", {}).catch(() => null);
      load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={{ gap: spacing.xs }}>
        <Text variant="heading" accessibilityRole="header">{linked ? t("account.emailLabel") : t("account.anonymous")}</Text>
        <Text variant="muted">{linked ? (user?.email ?? "") : t("account.anonymousHint")}</Text>
      </View>

      {!linked ? <LinkAccount onLinked={() => setLinked(true)} /> : null}

      <Card title={ts("title")} description={`${planName}${end ? ` · ${status?.cancelAtPeriodEnd ? ts("endsOn", { date: end }) : ts("renewsOn", { date: end })}` : ""}`}>
        {status?.premium ? (
          <>
            <Text variant="small">{ts("storeManaged")}</Text>
            <Button title={ts("manageInStore")} variant="outline" onPress={() => void Linking.openURL(storeManageUrl(Platform.OS))} />
          </>
        ) : (
          <Button title={ts("upgrade")} onPress={() => router.push("/premium")} />
        )}
        {isPurchasesConfigured() && linked ? <Button title={ts("restore")} variant="ghost" busy={busy} onPress={restorePurchases} /> : null}
      </Card>

      <ConsentSettings />
      <DataExport />
      <Card title={t("account.legalTitle")}>
        {LEGAL_SLUGS.map((slug) => (
          <Pressable key={slug} accessibilityRole="link" onPress={() => void Linking.openURL(`${env.apiUrl}/yasal/${slug}`)}>
            <Text style={{ textDecorationLine: "underline" }}>{t(`legal.links.${slug}`)}</Text>
          </Pressable>
        ))}
      </Card>
      <DeleteAccount />

      <Button
        title={t("auth.signOut")}
        variant="outline"
        onPress={async () => {
          await signOut();
          Alert.alert(t("auth.signedOut"));
          router.replace("/");
        }}
      />
    </Screen>
  );
}
