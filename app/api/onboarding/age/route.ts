import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { withGuard } from "@/lib/api/guard";
import { isFeatureEnabled } from "@/lib/config/flags";
import { createAdminClient } from "@/lib/db/admin";
import { AGE_BANDS, MIN_BIRTH_YEAR, currentYearIstanbul, isAdultByAgeBand, isAdultByBirthYear } from "@/lib/onboarding/age";

export const runtime = "nodejs";

/**
 * v2 (KB P#1/Ç1, CONTRACTS_V2 §5): { ageBand } → profiles.age_band + is_adult. under_18 bandı FEATURE_UNDER_18 kapalıyken
 * FEATURE_DISABLED ("yakında" ekranı; hiçbir şey yazılmaz). Eski istemci (mobil, M9'a kadar): { birthYear } aynen çalışır.
 */
const Input = z.union([
  z.object({ ageBand: z.enum(AGE_BANDS) }),
  z.object({ birthYear: z.number().int().min(MIN_BIRTH_YEAR) }),
]);

export const POST = withGuard({ schema: Input }, async ({ user, supabase, input }) => {
  const admin = createAdminClient();
  const now = new Date().toISOString();

  if ("ageBand" in input) {
    if (input.ageBand === "under_18" && !isFeatureEnabled("under18")) {
      throw new ApiError("FEATURE_DISABLED", "Bu yaş aralığı için hizmet henüz açık değil.");
    }
    const isAdult = isAdultByAgeBand(input.ageBand);
    const { error } = await admin.from("profiles").update({ age_band: input.ageBand, is_adult: isAdult, updated_at: now }).eq("id", user.id);
    if (error) throw new Error("profil güncellenemedi");
    // 18 altı (bayrak açıkken): hesapta kalır ama requireAdult kapıları bu sprintte kapalıdır (CONTRACTS_V2 §5).
    return Response.json({ isAdult, ageBand: input.ageBand });
  }

  const year = currentYearIstanbul();
  if (input.birthYear > year) throw new ApiError("BAD_INPUT", "Doğum yılı gelecekte olamaz.");
  const isAdult = isAdultByBirthYear(input.birthYear, year);
  const { error } = await admin.from("profiles").update({ birth_year: input.birthYear, is_adult: isAdult, updated_at: now }).eq("id", user.id);
  if (error) throw new Error("profil güncellenemedi");
  if (!isAdult) {
    // Eski akış (SPEC 4.1 adım 3): 18 altı → devam yok, oturum kapatılır.
    await supabase.auth.signOut();
  }
  return Response.json({ isAdult });
});
