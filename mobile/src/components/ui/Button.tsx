import { ActivityIndicator, Pressable, Text, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import { radius, spacing, useTheme } from "@/mobile/src/theme";

type Props = Omit<PressableProps, "style" | "children"> & {
  title: string;
  variant?: "primary" | "outline" | "ghost" | "destructive";
  size?: "md" | "lg";
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Erişilebilir buton: role=button, min 44 px dokunma alanı, disabled/busy durumları. */
export function Button({ title, variant = "primary", size = "md", busy, disabled, style, ...rest }: Props) {
  const { colors } = useTheme();
  const bg = variant === "primary" ? colors.primary : variant === "destructive" ? colors.destructive : "transparent";
  const fg = variant === "primary" ? colors.primaryForeground : variant === "destructive" ? "#ffffff" : colors.foreground;
  const border = variant === "outline" ? colors.border : "transparent";
  const isDisabled = Boolean(disabled || busy);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: Boolean(busy) }}
      disabled={isDisabled}
      {...rest}
      style={({ pressed }) => [
        {
          minHeight: size === "lg" ? 52 : 44,
          paddingHorizontal: spacing.md,
          borderRadius: radius.md,
          backgroundColor: bg,
          borderWidth: 1,
          borderColor: border,
          alignItems: "center",
          justifyContent: "center",
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontSize: 16, fontWeight: "600" }}>{title}</Text>}
    </Pressable>
  );
}
