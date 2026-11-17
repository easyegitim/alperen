import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AnalyticsProvider } from "@/mobile/src/features/analytics/AnalyticsProvider";
import { sweepTransientFiles } from "@/mobile/src/features/capture/transientFiles";
import { SessionProvider } from "@/mobile/src/features/session/SessionProvider";
import { t } from "@/mobile/src/lib/i18n";
import { initMonitoring, wrapRoot } from "@/mobile/src/lib/monitoring";
import { useTheme } from "@/mobile/src/theme";

initMonitoring();
// Açılışta önceki oturumdan kalan geçici görseller (önbellek: selfie, bekleyen set kopyaları, galeri/manipulator çıktıları)
// silinir; bellekte referans yoktur (SPEC-MOBILE M7). İlerleme fotoğrafları (belge dizini) dokunulmaz.
sweepTransientFiles();

function Root() {
  const { colors, scheme } = useTheme();
  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="hesap" options={{ headerShown: true, title: "Hesap", headerBackTitle: "Geri" }} />
        {/* v2 rota haritası (CONTRACTS_V2 Sprint 3 S3.1): baslangic/* (W7a), tara (W7a), analiz/[id] (W7a kilitli + W7b açık),
            premium (W7a), plan/[id]/{index,anket} (W7b). Ekranlar kendi başlıklarını Stack.Screen ile ayarlar. */}
        <Stack.Screen name="baslangic" />
        <Stack.Screen name="tara" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="analiz/[id]" options={{ headerShown: true, title: t("nav.analysis"), headerBackTitle: "Geri" }} />
        <Stack.Screen name="premium" options={{ headerShown: true, title: t("paywall.v2.title"), headerBackTitle: "Geri", presentation: "modal" }} />
        <Stack.Screen name="plan/[id]/index" options={{ headerShown: true, title: t("nav.plan"), headerBackTitle: "Geri" }} />
        <Stack.Screen name="plan/[id]/anket" options={{ headerShown: true, title: t("questionnaire.v2.title"), headerBackTitle: "Geri" }} />
      </Stack>
    </>
  );
}

/** Kök düzen: güvenli alan, oturum sağlayıcı, analitik (izinle), tema. Kapılar (tabs) ve onboarding düzenlerinde. */
function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <AnalyticsProvider />
        <Root />
      </SessionProvider>
    </SafeAreaProvider>
  );
}

export default wrapRoot(RootLayout);
