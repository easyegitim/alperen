import { Ionicons } from "@expo/vector-icons";
import { Pressable } from "react-native";
import type { Locked } from "@/lib/score/present";
import { Text } from "@/mobile/src/components/ui/Text";
import { useTheme } from "@/mobile/src/theme";

export const fmt1 = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Kilitli değer istemcide yoktur (null + locked); kilit simgesine dokununca paywall açılır. */
export function LockedValue({ v, big, onTap, aria }: { v: Locked<number | null>; big?: boolean; onTap: () => void; aria: string }) {
  const { colors } = useTheme();
  if (v.locked) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={aria} onPress={onTap} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Ionicons name="lock-closed" size={big ? 28 : 16} color={colors.mutedForeground} />
        <Text variant={big ? "title" : "body"} style={{ color: colors.mutedForeground }}>{big ? "●,●" : "●,●"}</Text>
      </Pressable>
    );
  }
  return <Text variant={big ? "title" : "body"} style={big ? { fontSize: 44, lineHeight: 52 } : { fontWeight: "600" }}>{v.value === null ? "–" : fmt1(v.value)}</Text>;
}
