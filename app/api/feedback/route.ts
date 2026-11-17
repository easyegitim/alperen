import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { noContent, withGuard } from "@/lib/api/guard";
import { createAdminClient } from "@/lib/db/admin";

export const runtime = "nodejs";

const Input = z.object({
  targetType: z.enum(["score", "report", "tryon", "exercise"]),
  targetId: z.uuid().optional(),
  rating: z.union([z.literal(-1), z.literal(1)]).optional(),
  reason: z.string().trim().max(500).optional(),
  isAbuseReport: z.boolean().optional(),
});

/** SPEC 14 / F18: POST /api/feedback → 204; kullanıcı başına günde 50. */
export const POST = withGuard({ schema: Input }, async ({ user, supabase, input }) => {
  const admin = createAdminClient();
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await admin.from("feedback").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", since);
  if ((count ?? 0) >= 50) throw new ApiError("RATE_LIMITED", "Günlük geri bildirim sınırına ulaştın.");
  const { error } = await supabase.from("feedback").insert({
    user_id: user.id,
    target_type: input.targetType,
    target_id: input.targetId ?? null,
    rating: input.rating ?? null,
    reason: input.reason ?? null,
    is_abuse_report: Boolean(input.isAbuseReport),
  });
  if (error) throw new Error("feedback insert failed");
  return noContent();
});
