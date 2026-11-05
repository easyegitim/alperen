import { Text as RNText, type TextProps } from "react-native";
import { useTheme } from "@/mobile/src/theme";

type Props = TextProps & { variant?: "title" | "heading" | "body" | "muted" | "small" };

const sizes = { title: 28, heading: 20, body: 16, muted: 14, small: 12 } as const;

export function Text({ variant = "body", style, ...rest }: Props) {
  const { colors } = useTheme();
  const color = variant === "muted" || variant === "small" ? colors.mutedForeground : colors.foreground;
  const fontWeight = variant === "title" || variant === "heading" ? "600" : "400";
  return <RNText {...rest} style={[{ color, fontSize: sizes[variant], fontWeight, lineHeight: sizes[variant] * 1.4 }, style]} />;
}
