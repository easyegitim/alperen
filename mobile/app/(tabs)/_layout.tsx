import { Ionicons } from "@expo/vector-icons";
import { Redirect, Tabs, router, type Href } from "expo-router";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useGate } from "@/mobile/src/features/session/useGate";
import { t } from "@/mobile/src/lib/i18n";
import { useTheme } from "@/mobile/src/theme";

const TABS = [
  { name: "analiz", title: t("nav.analysis"), icon: "scan-outline" },
  { name: "plan", title: t("nav.plan"), icon: "list-outline" },
  { name: "dene", title: t("nav.tryon"), icon: "color-wand-outline" },
  { name: "rutin", title: t("nav.routine"), icon: "checkmark-circle-outline" },
  { name: "ilerleme", title: t("nav.progress"), icon: "trending-up-outline" },
] as const;

/** Alt sekmeler (SPEC 4.2). Oturum/18+/onboarding kapısı: useGate web (gated) layout'uyla aynı kuralları uygular. */
export default function TabsLayout() {
  const { colors } = useTheme();
  const gate = useGate();
  if (!gate.ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.foreground} />
      </View>
    );
  }
  if (gate.redirect) return <Redirect href={gate.redirect as Href} />;

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: colors.background },
        headerTitleStyle: { color: colors.foreground },
        tabBarStyle: { backgroundColor: colors.background, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.foreground,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerRight: () => (
          <Pressable accessibilityRole="button" accessibilityLabel={t("common.account")} onPress={() => router.push("/hesap")} style={{ paddingHorizontal: 16 }}>
            <Ionicons name="person-circle-outline" size={26} color={colors.foreground} />
          </Pressable>
        ),
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{ title: tab.title, tabBarIcon: ({ color, size }) => <Ionicons name={tab.icon} size={size} color={color} /> }}
        />
      ))}
    </Tabs>
  );
}
