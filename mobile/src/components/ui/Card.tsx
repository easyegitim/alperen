import type { PropsWithChildren } from "react";
import { View, type ViewStyle } from "react-native";
import { radius, spacing, useTheme } from "@/mobile/src/theme";
import { Text } from "./Text";

type Props = PropsWithChildren<{ title?: string; description?: string; style?: ViewStyle }>;

export function Card({ title, description, children, style }: Props) {
  const { colors } = useTheme();
  return (
    <View style={[{ gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.card }, style]}>
      {title ? (
        <View style={{ gap: spacing.xs }}>
          <Text variant="heading" accessibilityRole="header">{title}</Text>
          {description ? <Text variant="muted">{description}</Text> : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}
