import { getLegalDoc, isLegalSlug } from "@/lib/legal/docs";

export const runtime = "nodejs";

/**
 * SPEC-MOBILE M2: GET /api/legal/[slug] → { slug, title, version, updatedAt, body }. Herkese açık (yasal metinler zaten
 * /yasal/[slug]'da açık); mobil uygulama aydınlatma metnini ve rıza sürümlerini buradan alır. Kişisel veri yok.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/legal/[slug]">) {
  const { slug } = await ctx.params;
  if (!isLegalSlug(slug)) return Response.json({ error: { code: "FEATURE_DISABLED", message: "Bulunamadı." } }, { status: 404 });
  const doc = await getLegalDoc(slug);
  return Response.json(
    { slug: doc.slug, title: doc.title, version: doc.version, updatedAt: doc.updatedAt, body: doc.body },
    { headers: { "cache-control": "public, max-age=300, stale-while-revalidate=3600" } },
  );
}
