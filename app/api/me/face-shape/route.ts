import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { withGuard } from "@/lib/api/guard";
import { FaceShapeKey } from "@/lib/score/contract";

export const runtime = "nodejs";

const Input = z.object({
  /** null = düzeltmeyi kaldır (cihaz/detaylı sonuç geçerli olur). */
  faceShape: FaceShapeKey.nullable(),
});

/**
 * PATCH /api/me/face-shape { faceShape } → { override } (KB §4.10, Ç8 "Bence değil"). profiles.face_shape_override;
 * kullanıcı kendi sütununu yazar (0010 grant). Ön değerlendirme ve detaylı sonuç değişmez; saç/sakal önerileri buna göre.
 */
export const PATCH = withGuard({ schema: Input, allowAnonymous: false }, async ({ user, supabase, input }) => {
  const { error } = await supabase.from("profiles").update({ face_shape_override: input.faceShape }).eq("id", user.id);
  if (error) throw new ApiError("INTERNAL", "Yüz şekli kaydedilemedi.");
  return Response.json({ override: input.faceShape });
});
