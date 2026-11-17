import { useEffect, useState } from "react";
import { View } from "react-native";
import { track } from "@/lib/analytics";
import { claimErrorKey, type ClaimErrorKey } from "@/lib/referral/claim";
import { normalizeReferralCode } from "@/lib/referral/code";
import { Button } from "@/mobile/src/components/ui/Button";
import { Input } from "@/mobile/src/components/ui/Input";
import { Text } from "@/mobile/src/components/ui/Text";
import { useSession } from "@/mobile/src/features/session/SessionProvider";
import { ApiClientError } from "@/mobile/src/lib/api";
import { scoped } from "@/mobile/src/lib/i18n";
import { radius, spacing, useTheme } from "@/mobile/src/theme";

const t = scoped("referral.claim");

/**
 * Davet kodu girişi (KB P#15/Ç12): POST /api/referral { code } → 204 "claim"dir; ayrı rota yok. Bayrak kapalıyken
 * FEATURE_DISABLED. Kod rastgeledir, kişisel veri taşımaz; analitiğe kod gitmez (yalnız ok).
 */
type Props = {
  onDone?: () => void;
  /** Kapalı başlar ("Davet kodun var mı?" düğmesi), dokununca açılır (web collapsible). */
  collapsible?: boolean;
  /** Bayrak bilinmiyorsa GET /api/referral yoklanır; FEATURE_DISABLED (404) ise form hiç çizilmez (web ile aynı). */
  probe?: boolean;
};

export function ReferralClaimForm({ onDone, collapsible = false, probe = false }: Props) {
  const { colors } = useTheme();
  const { aura } = useSession();
  const [available, setAvailable] = useState<boolean | null>(probe ? null : true);
  const [open, setOpen] = useState(!collapsible);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<{ kind: "idle" } | { kind: "ok" } | { kind: "error"; key: ClaimErrorKey }>({ kind: "idle" });
  const normalized = normalizeReferralCode(code);

  useEffect(() => {
    if (!probe) return;
    let active = true;
    void aura.referral
      .get()
      .then((r) => {
        if (active) setAvailable(Boolean(r && typeof r.code === "string"));
      })
      .catch(() => {
        if (active) setAvailable(false);
      });
    return () => {
      active = false;
    };
  }, [aura, probe]);

  async function submit() {
    if (!normalized) {
      setState({ kind: "error", key: "format" });
      return;
    }
    setBusy(true);
    try {
      await aura.referral.claim(normalized);
      track("referral_claimed", { ok: true });
      setState({ kind: "ok" });
      onDone?.();
    } catch (e) {
      track("referral_claimed", { ok: false });
      setState({ kind: "error", key: e instanceof ApiClientError ? claimErrorKey(e.code, e.message) : "generic" });
    } finally {
      setBusy(false);
    }
  }

  if (available !== true) return null;
  if (!open) return <Button title={t("title")} variant="ghost" onPress={() => setOpen(true)} />;
  if (state.kind === "ok") {
    return (
      <View style={{ padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.brandSoft }}>
        <Text variant="small" style={{ color: colors.foreground, fontWeight: "600" }} accessibilityLiveRegion="polite">{t("success")}</Text>
      </View>
    );
  }
  return (
    <View style={{ gap: spacing.sm, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg }}>
      <Text style={{ fontWeight: "600" }}>{t("title")}</Text>
      <Text variant="small">{t("body")}</Text>
      <Input label={t("label")} placeholder={t("placeholder")} autoCapitalize="characters" autoCorrect={false} value={code} onChangeText={setCode} returnKeyType="done" onSubmitEditing={() => void submit()} />
      {state.kind === "error" ? (
        <Text variant="small" accessibilityRole="alert" style={{ color: colors.destructive }}>{t(`errors.${state.key}`)}</Text>
      ) : null}
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        {onDone || collapsible ? <Button title={t("skip")} variant="ghost" style={{ flex: 1 }} onPress={() => { setOpen(!collapsible); onDone?.(); }} disabled={busy} /> : null}
        <Button title={t("submit")} style={{ flex: 1 }} busy={busy} disabled={!normalized} onPress={() => void submit()} />
      </View>
    </View>
  );
}
