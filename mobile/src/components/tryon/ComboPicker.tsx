import { useState } from "react";
import { Pressable, View } from "react-native";
import type { Preset, PresetKind } from "@/content/types";
import type { TryonPresets } from "@/lib/tryon/types";
import { Button } from "@/mobile/src/components/ui/Button";
import { Text } from "@/mobile/src/components/ui/Text";
import { SLOTS, canRunSelection, partCount, pickablePresets, togglePreset, type Presentation } from "@/mobile/src/features/tryon/request";
import { scoped } from "@/mobile/src/lib/i18n";
import { radius, spacing, useTheme } from "@/mobile/src/theme";

const t = scoped("tryon");

type Props = { mode: "style" | "combo"; value: TryonPresets; onChange: (v: TryonPresets) => void; onRun: () => void; recommended: readonly string[]; presentation: Presentation; disabled?: boolean };

/** Kombin seçimi (KB §7.1; PLAN 5b): üç yuva (saç, sakal, renk), yuva başına tek seçim; gizli presetler listede yok; 44 pt hedefler. */
export function ComboPicker({ mode, value, onChange, onRun, recommended, presentation, disabled }: Props) {
  const { colors } = useTheme();
  const [slot, setSlot] = useState<PresetKind>("hair");
  const list = pickablePresets(slot, presentation);
  const canRun = canRunSelection(mode, value);
  const parts = partCount(value);
  const chosenName = (k: PresetKind) => (value[k] ? pickablePresets(k, "unspecified").find((p) => p.id === value[k])?.nameTr : undefined);
  const pick = (p: Preset) => onChange(togglePreset(mode, value, p));
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: "row", gap: spacing.xs }} accessibilityLabel={t("v2.combo.title")}>
        {SLOTS.map((k) => {
          const chosen = chosenName(k);
          return (
            <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: slot === k }} onPress={() => setSlot(k)} style={{ flex: 1, minHeight: 64, borderRadius: radius.lg, borderWidth: 1, borderColor: slot === k ? colors.brand : colors.border, backgroundColor: chosen ? colors.brandSoft : colors.card, padding: spacing.sm, gap: 2 }}>
              <Text variant="small" style={{ fontWeight: "600" }}>{t(`v2.combo.slot.${k}`)}{chosen ? " ✓" : ""}</Text>
              <Text style={{ fontSize: 13, fontWeight: "600", color: chosen ? colors.foreground : colors.mutedForeground }} numberOfLines={2}>{chosen ?? t("v2.combo.none")}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
        {list.map((p) => {
          const selected = value[p.kind] === p.id;
          return (
            <Pressable key={p.id} accessibilityRole="button" accessibilityState={{ selected, disabled: Boolean(disabled) }} disabled={disabled} onPress={() => pick(p)} style={{ width: "48%", minHeight: 88, padding: spacing.sm, borderWidth: 1, borderColor: selected ? colors.brand : colors.border, backgroundColor: selected ? colors.brandSoft : colors.card, borderRadius: radius.lg, opacity: disabled ? 0.5 : 1, gap: 2 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: colors.brand, fontWeight: "700" }}>{selected ? "✓" : " "}</Text>
                {recommended.includes(p.id) ? <Text variant="small" style={{ color: colors.brand, fontWeight: "600" }}>★ {t("recommendedBadge")}</Text> : null}
              </View>
              <Text style={{ fontWeight: "600", fontSize: 15 }}>{p.nameTr}</Text>
              {p.noteTr ? <Text variant="small" numberOfLines={2}>{p.noteTr}</Text> : null}
            </Pressable>
          );
        })}
      </View>
      {mode === "combo" ? (
        <View style={{ gap: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.sm, backgroundColor: colors.card }}>
          <Text variant="small">{canRun ? t("v2.combo.hint") : t("v2.combo.needBoth")}</Text>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Button title="✕" variant="outline" accessibilityLabel={t("v2.combo.clear")} disabled={parts === 0 || disabled} onPress={() => onChange({})} />
            <Button title={t("v2.combo.run")} size="lg" style={{ flex: 1 }} disabled={!canRun || disabled} onPress={onRun} />
          </View>
        </View>
      ) : (
        <Button title={t("retry")} size="lg" disabled={!canRun || disabled} onPress={onRun} />
      )}
    </View>
  );
}
