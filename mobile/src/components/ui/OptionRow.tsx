import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { radius, spacing, useTheme } from "@/mobile/src/theme";
import { Text } from "./Text";

type Props = { label: string; hint?: string; selected: boolean; kind: "radio" | "checkbox"; onPress: () => void };

/** Radyo/onay satırı: 44 px dokunma alanı, erişilebilir rol ve durum. */
export function OptionRow({ label, hint, selected, kind, onPress }: Props) {
  const { colors } = useTheme();
  const icon = kind === "radio" ? (selected ? "radio-button-on" : "radio-button-off") : selected ? "checkbox" : "square-outline";
  return (
    <Pressable
      accessibilityRole={kind}
      accessibilityState={{ checked: selected, selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        minHeight: 48,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderWidth: 1,
        borderRadius: radius.md,
        borderColor: selected ? colors.foreground : colors.border,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Ionicons name={icon} size={22} color={colors.foreground} />
      <View style={{ flex: 1 }}>
        <Text>{label}</Text>
        {hint ? <Text variant="small">{hint}</Text> : null}
      </View>
    </Pressable>
  );
}

export function RadioList<T extends string>({ options, value, label, onChange }: { options: readonly T[]; value?: T; label: (k: T) => string; onChange: (v: T) => void }) {
  return (
    <View style={{ gap: spacing.sm }} accessibilityRole="radiogroup">
      {options.map((k) => (
        <OptionRow key={k} kind="radio" label={label(k)} selected={value === k} onPress={() => onChange(k)} />
      ))}
    </View>
  );
}

export function CheckList<T extends string>({ options, selected, label, onChange, noneLabel }: { options: readonly T[]; selected: T[]; label: (k: T) => string; onChange: (v: T[]) => void; noneLabel?: string }) {
  const toggle = (k: T) => onChange(selected.includes(k) ? selected.filter((x) => x !== k) : [...selected, k]);
  return (
    <View style={{ gap: spacing.sm }}>
      {options.map((k) => (
        <OptionRow key={k} kind="checkbox" label={label(k)} selected={selected.includes(k)} onPress={() => toggle(k)} />
      ))}
      {noneLabel ? <OptionRow kind="checkbox" label={noneLabel} selected={selected.length === 0} onPress={() => onChange([])} /> : null}
    </View>
  );
}
