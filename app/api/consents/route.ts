import { z } from "zod";
import { offersAnalysisDeletion } from "@/lib/account/consents";
import { ApiError } from "@/lib/api/errors";
import { noContent, withGuard } from "@/lib/api/guard";
import { markBoundPurchasesConsumed } from "@/lib/billing/purchases";
import { CONSENT_DOC, CONSENT_TYPES } from "@/lib/consent";
import { createAdminClient } from "@/lib/db/admin";
import { getLegalVersion } from "@/lib/legal/docs";

export const runtime = "nodejs";

const Input = z.object({
  type: z.enum(CONSENT_TYPES),
  granted: z.boolean(),
  textVersion: z.string().min(1).max(40),
  /** SPEC 16.2: biometric_processing geri alınırken "geçmiş analizlerin de silinsin mi?" (varsayılan evet). */
  deleteAnalyses: z.boolean().optional(),
});

/** SPEC 14: POST /api/consents { type, granted, textVersion, deleteAnalyses? } → 204. textVersion güncel olmalı. */
export const POST = withGuard({ schema: Input }, async ({ user, supabase, input }) => {
  const current = await getLegalVersion(CONSENT_DOC[input.type]);
  if (input.textVersion !== current) {
    throw new ApiError("BAD_INPUT", "Metin sürümü güncel değil; sayfayı yenile.");
  }
  // Kullanıcının kendi istemcisi: RLS p_consents_insert (user_id = auth.uid()) uygulanır. Geçmiş kayıt silinmez.
  const { error } = await supabase
    .from("consents")
    .insert({ user_id: user.id, type: input.type, granted: input.granted, text_version: input.textVersion });
  if (error) throw new Error("rıza kaydedilemedi");

  // Geri alma etkisi: yalnız biometric_processing + deleteAnalyses (varsayılan evet) → analyses, coach_reports ve
  // fotoğraflardan türetilmiş set önbelleği (analysis_sets: skor + rapor, KB Ç11/K21) silinir. Tabloların tarayıcı
  // politikası yoktur; silme service role ile ve yalnız bu kullanıcının satırlarında. Bağlı tek seferlik satın almalar
  // tüketilmiş kalır (analysis_id FK "set null" olsa da consumed_at dolu; bir satın alma = bir rapor).
  if (offersAnalysisDeletion(input.type, input.granted) && input.deleteAnalyses !== false) {
    const admin = createAdminClient();
    await markBoundPurchasesConsumed(admin, user.id);
    const { error: e1 } = await admin.from("coach_reports").delete().eq("user_id", user.id);
    if (e1) throw new Error("raporlar silinemedi");
    const { error: e2 } = await admin.from("analyses").delete().eq("user_id", user.id);
    if (e2) throw new Error("analizler silinemedi");
    const { error: e3 } = await admin.from("analysis_sets").delete().eq("user_id", user.id);
    // 0010 uygulanmamış ortamda tablo yoktur; diğer hatalar gerçek.
    if (e3 && !["42P01", "PGRST205"].includes(e3.code ?? "")) throw new Error("set önbelleği silinemedi");
  }
  return noContent();
});
