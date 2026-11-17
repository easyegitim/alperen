import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { withGuard } from "@/lib/api/guard";
import { createAdminClient } from "@/lib/db/admin";
import { recordLinkClick } from "@/lib/referral/links";

export const runtime = "nodejs";

const Input = z.object({ linkId: z.string().min(1).max(80) });

/** POST /api/links/click { linkId } → 204 (KB Ç4; PLAN 4g). FEATURE_PRODUCT_LINKS kapalıyken FEATURE_DISABLED. */
export const POST = withGuard({ schema: Input }, async ({ user, input }) => {
  const ok = await recordLinkClick(createAdminClient(), input.linkId, user.id);
  if (!ok) throw new ApiError("FEATURE_DISABLED", "Bulunamadı.");
  return new Response(null, { status: 204 });
});
