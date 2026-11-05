import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Modal, ScrollView, View } from "react-native";
import { track } from "@/lib/analytics";
import { CONSENT_DOC } from "@/lib/consent";
import type { ClientAnalysisSummary } from "@/lib/score/present";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { Input } from "@/mobile/src/components/ui/Input";
import { OptionRow } from "@/mobile/src/components/ui/OptionRow";
import { Screen } from "@/mobile/src/components/ui/Screen";
import { Text } from "@/mobile/src/components/ui/Text";
import { buildExpertsPath, latestCompletedAnalysisId, SPECIALTY_IDS, specialtyName, toRequestBody, validateRequestForm, type Partner, type RequestForm } from "@/mobile/src/features/experts/model";
import { readConsentState, type LegalDocDto } from "@/mobile/src/features/onboarding/consents";
import { useSession } from "@/mobile/src/features/session/SessionProvider";
import { ApiClientError } from "@/mobile/src/lib/api";
import { isMobileFeatureEnabled } from "@/mobile/src/lib/flags";
import { scoped } from "@/mobile/src/lib/i18n";
import { getSupabase } from "@/mobile/src/lib/supabase";
import { radius, spacing, useTheme } from "@/mobile/src/theme";

const t = scoped("experts");
const EMPTY_FORM: RequestForm = { name: "", contact: "", message: "" };

/**
 * /uzman (SPEC 12.3, SPEC-MOBILE M8): uzmanlık + şehir filtresi, partner kartı (fiyat/kampanya/önce-sonra yok),
 * ön görüşme talebi (ad, iletişim, mesaj, isteğe bağlı analiz özeti; fotoğraf asla). Flag kapalıysa içerik yok;
 * sunucu FEATURE_EXPERT_NETWORK=false iken 404 (FEATURE_DISABLED) döner ve ekran aynı mesajı gösterir.
 */
export default function ExpertsScreen() {
  const { colors } = useTheme();
  const { api } = useSession();
  const { alan } = useLocalSearchParams<{ alan?: string }>();
  const enabled = isMobileFeatureEnabled("expertNetwork");
  const [specialty, setSpecialty] = useState(typeof alan === "string" && SPECIALTY_IDS.includes(alan) ? alan : "");
  const [city, setCity] = useState("");
  const [cityQuery, setCityQuery] = useState("");
  const [partners, setPartners] = useState<Partner[] | null>(null);
  const [disabled, setDisabled] = useState(!enabled);
  const [selected, setSelected] = useState<Partner | null>(null);
  const [form, setForm] = useState<RequestForm>(EMPTY_FORM);
  const [share, setShare] = useState(false);
  const [lastAnalysisId, setLastAnalysisId] = useState<string | null>(null);
  const [sharing, setSharing] = useState<{ has: boolean; version: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  // Partner listesi
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    api
      .get<Partner[]>(buildExpertsPath(specialty, cityQuery))
      .then((list) => {
        if (active) setPartners(list ?? []);
      })
      .catch((e: unknown) => {
        if (!active) return;
        if (e instanceof ApiClientError && e.code === "FEATURE_DISABLED") setDisabled(true);
        setPartners([]);
      });
    return () => {
      active = false;
    };
  }, [api, enabled, specialty, cityQuery]);

  // Son analiz + expert_data_sharing rıza sürümü (özet paylaşımı için)
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void (async () => {
      const [list, doc, state] = await Promise.all([
        api.get<ClientAnalysisSummary[]>("/api/analyses").catch(() => null),
        api.get<LegalDocDto>(`/api/legal/${CONSENT_DOC.expert_data_sharing}`).catch(() => null),
        readConsentState(getSupabase()).catch(() => null),
      ]);
      if (!active) return;
      setLastAnalysisId(latestCompletedAnalysisId(list));
      const version = doc?.version ?? "";
      const c = state?.expert_data_sharing;
      setSharing({ has: Boolean(version && c?.granted && c.textVersion === version), version });
    })();
    return () => {
      active = false;
    };
  }, [api, enabled]);

  const open = useCallback((p: Partner) => {
    setSelected(p);
    setDone(null);
    setForm(EMPTY_FORM);
    setShare(false);
  }, []);

  async function submit() {
    if (!selected) return;
    const invalid = validateRequestForm(form);
    if (invalid) {
      Alert.alert(t("errors.BAD_INPUT"));
      return;
    }
    setBusy(true);
    try {
      const shareId = share && lastAnalysisId ? lastAnalysisId : null;
      if (shareId && sharing && !sharing.has) {
        if (!sharing.version) throw new ApiClientError(0, null);
        await api.post("/api/consents", { type: "expert_data_sharing", granted: true, textVersion: sharing.version });
        track("consent_updated", { type: "expert_data_sharing", granted: true });
        setSharing({ ...sharing, has: true });
      }
      const res = await api.post<{ requestId: string; refCode: string }>("/api/experts/requests", toRequestBody(selected.id, form, shareId));
      track("expert_request_sent", { specialty: selected.specialties[0] ?? "" });
      setDone(res?.refCode ?? "");
    } catch (e) {
      const code = e instanceof ApiClientError ? e.code : "NETWORK";
      const known = ["RATE_LIMITED", "CONSENT_REQUIRED", "BAD_INPUT", "FEATURE_DISABLED", "NETWORK"];
      Alert.alert(t(`errors.${known.includes(code) ? code : "GENERIC"}`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t("title"), headerBackTitle: "Geri" }} />
      <Screen>
        {disabled ? (
          <Text variant="muted">{t("disabled")}</Text>
        ) : (
          <View style={{ gap: spacing.md }}>
            <Text variant="muted">{t("intro")}</Text>
            <View style={{ gap: spacing.xs }}>
              <Text style={{ fontWeight: "500" }}>{t("specialty")}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }}>
                {["", ...SPECIALTY_IDS].map((id) => (
                  <Button key={id || "all"} title={id ? specialtyName(id) : t("all")} variant={specialty === id ? "primary" : "outline"} onPress={() => setSpecialty(id)} accessibilityState={{ selected: specialty === id }} />
                ))}
              </ScrollView>
            </View>
            <Input label={t("city")} placeholder={t("cityPlaceholder")} value={city} onChangeText={setCity} onBlur={() => setCityQuery(city)} onSubmitEditing={() => setCityQuery(city)} returnKeyType="search" autoCapitalize="words" />
            <Text variant="small">{t("disclaimer")}</Text>
            {partners === null ? <Text variant="muted">{t("loading")}</Text> : partners.length === 0 ? <Text variant="muted">{t("empty")}</Text> : null}
            {(partners ?? []).map((p) => (
              <Card key={p.id} title={p.verified_at ? `${p.name} · ✓ ${t("verified")}` : p.name} description={`${p.specialties.map(specialtyName).join(" · ")} · ${p.city}${p.institution ? ` · ${p.institution}` : ""}`}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }}>
                  <Text variant="small" style={{ flex: 1 }}>
                    {t("license")}: {p.license_no}
                  </Text>
                  <Button title={t("request")} onPress={() => open(p)} />
                </View>
              </Card>
            ))}
          </View>
        )}
      </Screen>

      <Modal visible={selected !== null} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" }}>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: "90%" }} contentContainerStyle={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.md, gap: spacing.sm }}>
            <Text variant="heading">{t("formTitle", { name: selected?.name ?? "" })}</Text>
            <Text variant="muted">{t("formBody")}</Text>
            {done !== null ? (
              <>
                <Text>{t("sent", { ref: done })}</Text>
                <Button title={t("close")} onPress={() => setSelected(null)} />
              </>
            ) : (
              <>
                <Input label={t("name")} value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} autoCapitalize="words" maxLength={80} />
                <Input label={t("contact")} placeholder={t("contactPlaceholder")} value={form.contact} onChangeText={(v) => setForm({ ...form, contact: v })} autoCapitalize="none" keyboardType="email-address" maxLength={120} />
                <Input label={t("message")} value={form.message} onChangeText={(v) => setForm({ ...form, message: v })} multiline maxLength={600} style={{ minHeight: 88, textAlignVertical: "top", paddingVertical: spacing.sm }} />
                {lastAnalysisId ? <OptionRow kind="checkbox" label={t("share")} hint={t("shareHint")} selected={share} onPress={() => setShare((v) => !v)} /> : null}
                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  <Button title={t("close")} variant="outline" style={{ flex: 1 }} disabled={busy} onPress={() => setSelected(null)} />
                  <Button title={t("send")} style={{ flex: 1 }} busy={busy} disabled={busy || (share && !!lastAnalysisId && !sharing)} onPress={() => void submit()} />
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}
