import { TextInput, View, type TextInputProps } from "react-native";
import { radius, spacing, useTheme } from "@/mobile/src/theme";
import { Text } from "./Text";

type Props = TextInputProps & { label: string; hint?: string };

export function Input({ label, hint, style, ...rest }: Props) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={{ fontWeight: "500" }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.mutedForeground}
        {...rest}
        style={[
          { minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, color: colors.foreground, fontSize: 16, backgroundColor: colors.background },
          style,
        ]}
      />
      {hint ? <Text variant="small">{hint}</Text> : null}
    </View>
  );
}
