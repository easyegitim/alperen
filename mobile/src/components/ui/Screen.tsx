import type { PropsWithChildren } from "react";
import { ScrollView, View, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { spacing, useTheme } from "@/mobile/src/theme";

type Props = PropsWithChildren<{ scroll?: boolean; style?: ViewStyle; padded?: boolean }>;

/** Güvenli alan + tema arka planı; 360 px genişlikte 16 px kenar boşluğu. */
export function Screen({ children, scroll = true, style, padded = true }: Props) {
  const { colors } = useTheme();
  const inner = { padding: padded ? spacing.md : 0, gap: spacing.md, ...style };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top", "left", "right"]}>
      {scroll ? (
        <ScrollView contentContainerStyle={inner} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, inner]}>{children}</View>
      )}
    </SafeAreaView>
  );
}
