import { z } from "zod";
import { withGuard } from "@/lib/api/guard";
import { createAdminClient } from "@/lib/db/admin";

export const runtime = "nodejs";

/** SPEC 12.3 adım 6: gelir kayıtları elle girilir (faturalama muhasebede). */
export const POST = withGuard(
  {
    schema: z.object({
      referralId: z.uuid(),
      amountTry: z.number().min(0).max(1_000_000),
      model: z.enum(["commission", "listing_fee", "lead_fee", "none"]),
      invoicedAt: z.string().optional(),
      notes: z.string().max(500).optional(),
    }),
    requireAdmin: true,
  },
  async ({ input }) => {
    const { data, error } = await createAdminClient()
      .from("referral_revenue")
      .insert({ referral_id: input.referralId, amount_try: input.amountTry, model: input.model, invoiced_at: input.invoicedAt ?? null, notes: input.notes ?? null })
      .select("id")
      .single();
    if (error) throw new Error("revenue insert failed");
    return Response.json(data, { status: 201 });
  },
);
