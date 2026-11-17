export const runtime = "nodejs";

/** SPEC 14: GET /api/health → { ok: true }. Gizli bilgi, sürüm veya ortam ayrıntısı dönmez. */
export function GET() {
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
