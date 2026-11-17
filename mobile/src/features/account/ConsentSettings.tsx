import { useEffect, useState } from "react";
import { Alert, Modal, View } from "react-native";
import { MANAGEABLE_CONSENTS, offersAnalysisDeletion, revokeEffects, type ManageableConsent } from "@/lib/account/consents";
import { track } from "@/lib/analytics";
import { CONSENT_DOC, type ConsentState } from "@/lib/consent";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { OptionRow } from "@/mobile/src/components/ui/OptionRow";
import { SwitchRow } from "@/mobile/src/components/ui/SwitchRow";
import { Text } from "@/mobile/src/components/ui/Text";
import { setAnalyticsConsent } from "@/mobile/src/features/analytics/consent";
import { readConsentState, type LegalDocDto } from "@/mobile/src/features/onboarding/consents";
import { useSession } from "@/mobile/src/features/session/SessionProvider";
import { scoped } from "@/mobile/src/lib/i18n";
import { getSupabase } from "@/mobile/src/lib/supabase";
import { radius, spacing, useTheme } from "@/mobile/src/theme";

const t = scoped("account.consents");

/** SPEC 16.2 (mobil): /hesap rıza anahtarları; geri alma etkileri; biometric_processing için analiz silme sorusu. */
export function ConsentSettings() {
  const { colors } = useTheme();
  const { api } = useSession();
  const [versions, setVersions] = useState<Record<ManageableConsent, string> | null>(null);
  const [state, setState] = useState<Record<ManageableConsent, boolean> | null>(null);
  const [busy, setBusy] = useState<ManageableConsent | null>(null);
  const [pending, setPending] = useState<ManageableConsent | null>(null);
  const [deleteAnalyses, setDeleteAnalyses] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      const slugs = [...new Set(MANAGEABLE_CONSENTS.map((k) => CONSENT_DOC[k]))];
      const docs = await Promise.all(slugs.map((s) => api.get<LegalDocDto>(`/api/legal/${s}`)));
      const bySlug = new Map(slugs.map((s, i) => [s, docs[i]?.version ?? ""]));
      const v = {} as Record<ManageableConsent, string>;
      for (const k of MANAGEABLE_CONSENTS) v[k] = bySlug.get(CONSENT_DOC[k]) ?? "";
      const initial: ConsentState = await readConsentState(getSupabase());
      const s = {} as Record<ManageableConsent, boolean>;
      for (const k of MANAGEABLE_CONSENTS) s[k] = Boolean(initial[k]?.granted && initial[k]?.textVersion === v[k]);
      if (!active) return;
      setVersions(v);
      setState(s);
    })().catch(() => {
      if (active) setState(null);
    });
    return () => {
      active = false;
    };
  }, [api]);

  async function apply(type: ManageableConsent, granted: boolean, withDelete?: boolean) {
    if (!versions) return;
    setBusy(type);
    try {
      await api.post("/api/consents", { type, granted, textVersion: versions[type], ...(withDelete !== undefined ? { deleteAnalyses: withDelete } : {}) });
      track("consent_updated", { type, granted });
      setState((s) => (s ? { ...s, [type]: granted } : s));
      if (type === "analytics_cookies") await setAnalyticsConsent(granted);
      Alert.alert(granted ? t("granted") : withDelete ? t("revokedAndDeleted") : t("revoked"));
    } catch {
      Alert.alert(t("error"));
    } finally {
      setBusy(null);
    }
  }

  function onToggle(type: ManageableConsent, next: boolean) {
    if (offersAnalysisDeletion(type, next)) {
      setDeleteAnalyses(true);
      setPending(type);
      return;
    }
    void apply(type, next);
  }

  return (
    <Card title={t("title")} description={t("description")}>
      {!state ? <Text variant="muted">…</Text> : null}
      {state
        ? MANAGEABLE_CONSENTS.map((k) => (
            <SwitchRow
              key={k}
              label={t(`items.${k}.title`)}
              hint={`${t(`items.${k}.body`)}${state[k] ? ` ${t("ifRevoked")} ${revokeEffects(k).map((e) => t(`effects.${e}`)).join(" ")}` : ""}`}
              value={state[k]}
              disabled={busy !== null}
              onChange={(v) => onToggle(k, v)}
            />
          ))
        : null}
      <Text variant="small">{t("historyNote")}</Text>
      <Modal visible={pending !== null} transparent animationType="fade" onRequestClose={() => setPending(null)}>
        <View style={{ flex: 1, justifyContent: "center", padding: spacing.lg, backgroundColor: "rgba(0,0,0,0.5)" }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm }}>
            <Text variant="heading">{t("revokeBiometricTitle")}</Text>
            <Text variant="muted">{t("revokeBiometricBody")}</Text>
            <OptionRow kind="checkbox" label={t("deletePastAnalyses")} hint={t("deletePastAnalysesHint")} selected={deleteAnalyses} onPress={() => setDeleteAnalyses((v) => !v)} />
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <Button title={t("keep")} variant="outline" style={{ flex: 1 }} onPress={() => setPending(null)} />
              <Button
                title={t("confirmRevoke")}
                variant="destructive"
                style={{ flex: 1 }}
                onPress={() => {
                  const type = pending;
                  setPending(null);
                  if (type) void apply(type, false, deleteAnalyses);
                }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </Card>
  );
}
