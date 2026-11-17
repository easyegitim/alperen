import { Switch, View } from "react-native";
import { spacing, useTheme } from "@/mobile/src/theme";
import { Text } from "./Text";

type Props = { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean };

export function SwitchRow({ label, hint, value, onChange, disabled }: Props) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, minHeight: 44 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontWeight: "500" }}>{label}</Text>
        {hint ? <Text variant="small">{hint}</Text> : null}
      </View>
      <Switch accessibilityLabel={label} value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: colors.foreground, false: colors.border }} />
    </View>
  );
}
