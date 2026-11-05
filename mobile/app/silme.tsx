import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { purgeDateFor } from "@/lib/account/consents";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { Screen } from "@/mobile/src/components/ui/Screen";
import { Text } from "@/mobile/src/components/ui/Text";
import { useSession } from "@/mobile/src/features/session/SessionProvider";
import { scoped, t as tt } from "@/mobile/src/lib/i18n";
import { getSupabase } from "@/mobile/src/lib/supabase";

const t = scoped("deletion");
const fmt = (iso: string) => new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });

/** /silme: silme talebi bekleyen hesap; 7 gün içinde iptal (POST /api/me/delete/cancel) veya çıkış. */
export default function DeletionPending() {
  const { user, api, signOut } = useSession();
  const [requestedAt, setRequestedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    let active = true;
    void getSupabase().from("profiles").select("deletion_requested_at").eq("id", user.id).maybeSingle().then(({ data }) => {
      if (!active) return;
      if (!data?.deletion_requested_at) router.replace("/hesap");
      else setRequestedAt(String(data.deletion_requested_at));
    });
    return () => {
      active = false;
    };
  }, [user]);

  async function cancel() {
    setBusy(true);
    try {
      await api.post("/api/me/delete/cancel", {});
      Alert.alert(t("canceled"));
      router.replace("/(tabs)/analiz");
    } catch {
      Alert.alert(t("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Card title={t("title")} description={requestedAt ? t("body", { requested: fmt(requestedAt), purge: fmt(purgeDateFor(requestedAt).toISOString()) }) : undefined}>
        <Button title={t("cancelButton")} size="lg" busy={busy} onPress={cancel} />
        <Text variant="small">{t("keepHint")}</Text>
        <Button title={tt("auth.signOut")} variant="outline" onPress={async () => { await signOut(); router.replace("/"); }} />
      </Card>
    </Screen>
  );
}
