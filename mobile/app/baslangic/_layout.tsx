import { Stack } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useSession } from "@/mobile/src/features/session/SessionProvider";
import { useTheme } from "@/mobile/src/theme";

/**
 * Onboarding grubu (KB §3.1 v2): yaş, cinsiyet ve giriş ekranları OTURUMSUZ açılır (web (app)/layout PUBLIC_ONBOARDING_PATHS);
 * izinler ekranı oturumu kendisi ister. Adım kapıları her ekranda.
 */
export default function OnboardingLayout() {
  const { colors } = useTheme();
  const { loading } = useSession();
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.foreground} />
      </View>
    );
  }
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />;
}
