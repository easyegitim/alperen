import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useState } from "react";
import { Alert } from "react-native";
import { isApiErrorBody } from "@/lib/api/errors";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { useSession } from "@/mobile/src/features/session/SessionProvider";
import { env } from "@/mobile/src/lib/env";
import { scoped } from "@/mobile/src/lib/i18n";
import { getSupabase } from "@/mobile/src/lib/supabase";
import { exportFileName, fileNameFromDisposition } from "./exportName";

const t = scoped("account.export");

/** F15 "Verimi indir" (mobil): GET /api/me/export (bearer) → önbellek dosyası → paylaşım/kaydetme sayfası; sonra silinir. */
export function DataExport() {
  const { configured } = useSession();
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    let file: File | null = null;
    try {
      const { data } = configured ? await getSupabase().auth.getSession() : { data: { session: null } };
      const token = data.session?.access_token;
      const res = await fetch(`${env.apiUrl}/api/me/export`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null);
        Alert.alert(isApiErrorBody(body) && body.error.code === "RATE_LIMITED" ? t("rateLimited") : t("error"));
        return;
      }
      const json = await res.text();
      file = new File(Paths.cache, fileNameFromDisposition(res.headers.get("content-disposition"), exportFileName()));
      file.write(json);
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: "application/json", dialogTitle: t("shareTitle"), UTI: "public.json" });
      Alert.alert(t("done"));
    } catch {
      Alert.alert(t("error"));
    } finally {
      try {
        file?.delete();
      } catch {
        // önbellek
      }
      setBusy(false);
    }
  }

  return (
    <Card title={t("title")} description={t("description")}>
      <Button title={busy ? t("busy") : t("button")} variant="outline" busy={busy} onPress={download} />
    </Card>
  );
}
