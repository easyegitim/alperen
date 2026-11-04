import { Stack, router } from "expo-router";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { Screen } from "@/mobile/src/components/ui/Screen";
import { scoped, t } from "@/mobile/src/lib/i18n";

const ts = scoped("mobile.stub");

/**
 * /baslangic/giris — Taramadan önce Google / Apple girişi (KB §3.1/3 KARAR; e-posta OTP AÇIK §11.11, yedek olarak kalır).
 * Sahip: W7a. Yer tutucu: W7a mobile/src/features/auth (LinkAccount'taki PKCE akışı: signInWithOAuth/linkIdentity +
 * expo-web-browser openAuthSessionAsync + exchangeCodeForSession) üzerine kurar; auth.signIn.* metinleri web ile aynı.
 * Anonim oturum v2'de kalkar (CONTRACTS_V2 §2.3 "Anonim oturum yok"); Apple, Google varsa zorunlu (Apple 4.8).
 */
export default function SignInStub() {
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t("auth.signIn.title"), headerBackTitle: "Geri" }} />
      <Screen>
        <Card title={ts("title")} description={ts("body")}>
          <Button title={ts("back")} variant="outline" onPress={() => router.back()} />
        </Card>
      </Screen>
    </>
  );
}
