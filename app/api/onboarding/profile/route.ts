import { z } from "zod";
import { noContent, withGuard } from "@/lib/api/guard";
import { createAdminClient } from "@/lib/db/admin";
import { PRESENTATIONS } from "@/lib/questionnaire";

export const runtime = "nodejs";

const Input = z.object({ presentation: z.enum(PRESENTATIONS) });

/**
 * KB §3.1/2: cinsiyet (erkek / kadın / belirtmek istemiyorum) ödeme öncesi; tek kaynak profiles.presentation
 * (CONTRACTS_V2 §5). Yalnız öneri ve örnekler için; skor ölçeği herkese aynıdır (K1). Yaş kapısı gerekmez (yaş→cinsiyet sırası).
 */
export const POST = withGuard({ schema: Input }, async ({ user, input }) => {
  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update({ presentation: input.presentation, updated_at: new Date().toISOString() }).eq("id", user.id);
  if (error) throw new Error("profil güncellenemedi");
  return noContent();
});
