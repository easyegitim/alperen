import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { QuestionnaireV2Schema, type QuestionnaireV2 } from "@/lib/questionnaireV2";
import type { PhotoDetections } from "@/lib/score/present";
import { Screen } from "@/mobile/src/components/ui/Screen";
import { Text } from "@/mobile/src/components/ui/Text";
import { QuestionnaireWizardV2 } from "@/mobile/src/features/plan/QuestionnaireWizardV2";
import { useSession } from "@/mobile/src/features/session/SessionProvider";
import { t } from "@/mobile/src/lib/i18n";
import { getSupabase } from "@/mobile/src/lib/supabase";

type Profile = { questionnaire?: QuestionnaireV2; presentation: "male" | "female" | "unspecified"; under18: boolean; detections: PhotoDetections | null };

/**
 * /plan/[id]/anket — Kişiselleştirme anketi v2 (KB §3.2/5–6, Ç17; CONTRACTS_V2 S2.3/S3.1): web (gated)/plan/[id]/anket eşi.
 * Mevcut cevaplar profiles.questionnaire_v2'den (RLS, kendi satırı); sunum ve yaş bandı profilden. Gözlük/başörtüsü
 * tahmini GET /api/analyses/[id] `detections` alanından (yalnız açık sonuçta; yoksa null → seçim zorunlu, Ç17). Skoru değiştirmez.
 */
export default function PlanQuestionnaireScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, aura } = useSession();
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      let out: Profile = { presentation: "unspecified", under18: false, detections: null };
      if (user) {
        try {
          const { data } = await getSupabase().from("profiles").select("presentation, age_band, questionnaire_v2").eq("id", user.id).maybeSingle();
          const q = QuestionnaireV2Schema.safeParse(data?.questionnaire_v2);
          const pres = data?.presentation;
          out = {
            ...out,
            questionnaire: q.success ? q.data : undefined,
            presentation: pres === "male" || pres === "female" ? pres : "unspecified",
            under18: data?.age_band === "under_18",
          };
        } catch {
          // sütun yoksa (migration 0013 uygulanmamış) boş form
        }
        if (id) {
          // Fotoğraftan görülen gözlük/baş örtüsü (fotoğraf gelmez; yalnız iki boolean). Hata → null (kullanıcı seçer).
          const a = await aura.analyses.get(id).catch(() => null);
          out = { ...out, detections: a && "detections" in a ? (a.detections ?? null) : null };
        }
      }
      if (active) setProfile(out);
    })();
    return () => {
      active = false;
    };
  }, [user, aura, id]);

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t("questionnaire.v2.title"), headerBackTitle: "Geri" }} />
      <Screen>
        {profile && id ? (
          <QuestionnaireWizardV2 analysisId={id} initial={profile.questionnaire} prefill={profile.detections ?? { glassesDetected: null, headCoveringDetected: null }} presentation={profile.presentation} under18={profile.under18} />
        ) : (
          <Text variant="muted">{t("common.loading")}</Text>
        )}
      </Screen>
    </>
  );
}
