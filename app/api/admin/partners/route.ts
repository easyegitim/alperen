import { z } from "zod";
import { withGuard } from "@/lib/api/guard";
import { createAdminClient } from "@/lib/db/admin";

export const runtime = "nodejs";

export const PartnerInput = z.object({
  name: z.string().trim().min(2).max(120),
  kind: z.enum(["doctor", "clinic", "dietitian", "psychologist", "dentist"]),
  specialties: z.array(z.string().min(2).max(40)).min(1).max(6),
  city: z.string().trim().min(2).max(60),
  institution: z.string().trim().max(120).optional().nullable(),
  license_no: z.string().trim().min(2).max(60),
  contact_email: z.email(),
  commercial_model: z.enum(["commission", "listing_fee", "lead_fee", "none"]).default("none"),
  commission_rate: z.number().min(0).max(100).optional().nullable(),
  active: z.boolean().default(false),
  verified: z.boolean().default(false),
});

const COLS = "id, name, kind, specialties, city, institution, license_no, contact_email, commercial_model, commission_rate, active, verified_at, created_at";

export const GET = withGuard({ requireAdmin: true }, async () => {
  const { data } = await createAdminClient().from("partners").select(COLS).order("created_at", { ascending: false });
  return Response.json(data ?? []);
});

export const POST = withGuard({ schema: PartnerInput, requireAdmin: true }, async ({ input }) => {
  const { verified, ...rest } = input;
  const { data, error } = await createAdminClient().from("partners").insert({ ...rest, verified_at: verified ? new Date().toISOString() : null }).select(COLS).single();
  if (error) throw new Error("partner insert failed");
  return Response.json(data, { status: 201 });
});
