import { ApiError } from "@/lib/api/errors";
import { withGuard } from "@/lib/api/guard";
import { getPremiumStatus } from "@/lib/api/premium";
import { getTeaserConfig } from "@/lib/config/teaser";
import { createAdminClient } from "@/lib/db/admin";
import { toClientAnalysis, type AnalysisRow } from "@/lib/score/present";
import { selectAnalysisRows } from "@/lib/score/rowColumns";
import tr from "@/messages/tr.json";

export const runtime = "nodejs";

const DAILY_LIMIT = 3;

/**
 * KVKK m. 11 tam kopya başvurusu notu (engine spec §8, UI spec R16). Uygulama içi dışa aktarma kilit kırpmalı kalır;
 * not, ayrı başvuru yolunu gösterir. Yol ve adres kullanıcı + hukukçu onayıyla belirlenir: KVKK_REQUEST_ADDRESS
 * tanımlanana kadar not gönderilmez (null), böylece yer tutucu bir adres kullanıcıya gösterilmez.
 */
function kvkkExportNote(env: Record<string, string | undefined> = process.env): string | null {
  const address = env.KVKK_REQUEST_ADDRESS?.trim();
  return address ? tr.account.export.kvkkNote.replace("{address}", address) : null;
}

/**
 * SPEC 14 / Faz 13 madde 3: GET /api/me/export → JSON dosyası; günde 3.
 * İçerik: profil, rızalar (tüm geçmiş), analizler, raporlar, rutin, abonelik, uzman talepleri, deneme olayları.
 * Kilitli değerler burada da sunulmaz (CLAUDE.md: null + locked:true); fotoğraf/landmark zaten saklanmaz.
 */
export const GET = withGuard({}, async ({ user, supabase }) => {
  const admin = createAdminClient();
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await admin.from("data_exports").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", since);
  if ((count ?? 0) >= DAILY_LIMIT) {
    throw new ApiError("RATE_LIMITED", "Günde en fazla 3 dışa aktarma yapabilirsin.", new Date(Date.now() + 86_400_000).toISOString());
  }
  await admin.from("data_exports").insert({ user_id: user.id });

  const { premium } = await getPremiumStatus(supabase, user.id);
  const teaser = getTeaserConfig();

  // Kullanıcının kendi istemcisi (RLS) ile okunabilen tablolar
  const [profile, consents, routineItems, routineLogs, subscription, referrals, tryons] = await Promise.all([
    supabase.from("profiles").select("birth_year, is_adult, locale, questionnaire, onboarding_completed_at, deletion_requested_at, created_at").eq("id", user.id).maybeSingle(),
    supabase.from("consents").select("type, granted, text_version, created_at").eq("user_id", user.id).order("created_at", { ascending: true }),
    supabase.from("routine_items").select("id, kind, ref_id, slot, title, position, active, created_at").eq("user_id", user.id),
    supabase.from("routine_logs").select("item_id, log_date, done").eq("user_id", user.id),
    supabase.from("subscriptions").select("provider, plan, status, current_period_start, current_period_end, cancel_at_period_end, updated_at").eq("user_id", user.id).maybeSingle(),
    supabase.from("referral_requests").select("ref_code, specialty, status, shared_analysis_id, created_at").eq("user_id", user.id),
    supabase.from("tryon_events").select("preset_id, status, created_at").eq("user_id", user.id),
  ]);

  // analyses / coach_reports: tarayıcı politikası yok → service role, yalnız bu kullanıcı, teaser kırpmasıyla
  const { data: analysesRaw } = await selectAnalysisRows((cols) =>
    admin.from("analyses").select(cols).eq("user_id", user.id).order("created_at", { ascending: true }),
  );
  const analyses = ((analysesRaw as AnalysisRow[] | null) ?? []).map((a) => toClientAnalysis(a, premium, teaser.mode, teaser.subscore));

  let reports: unknown[] = [];
  if (premium) {
    const { data } = await admin.from("coach_reports").select("id, analysis_id, report, is_fallback, prompt_version, created_at").eq("user_id", user.id);
    reports = data ?? [];
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    format: "aura-export/1",
    kvkkNote: kvkkExportNote(),
    account: { id: user.id, email: user.email ?? null, isAnonymous: Boolean(user.is_anonymous), createdAt: user.created_at },
    profile: profile.data ?? null,
    consents: consents.data ?? [],
    analyses,
    reports: premium ? reports : { locked: true, note: "Koç raporları premium içeriktir; dışa aktarmaya premiumda dahil edilir." },
    routine: { items: routineItems.data ?? [], logs: routineLogs.data ?? [] },
    subscription: subscription.data ?? null,
    expertRequests: referrals.data ?? [],
    tryonEvents: tryons.data ?? [],
    notes: [
      "Fotoğraflar, kamera kareleri ve 478 noktalı yüz dizisi hiçbir zaman saklanmaz; bu dosyada yer almaz.",
      "İlerleme fotoğrafların yalnız cihazındaki tarayıcıda (IndexedDB) durur; sunucuda kopyası yoktur.",
    ],
  };

  const day = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="aura-verilerim-${day}.json"`,
      "cache-control": "no-store",
    },
  });
});
