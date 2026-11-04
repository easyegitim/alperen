import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { z, ZodType } from "zod";
import { CONSENT_DOC, type ConsentState, type ConsentType } from "@/lib/consent";
import { createClient } from "@/lib/db/server";
import { getLegalVersion } from "@/lib/legal/docs";
import { isAdminUser, isPhysicianUser } from "./admin";
import { parseBearer } from "./bearer";
import { ApiError, apiError } from "./errors";

/**
 * SPEC 14: her uçta aynı sıra — oturum → Zod → 18+ → gerekli rızalar → (premium, kota: Faz 6/8) → iş.
 * Loglara istek gövdesi veya kişisel veri yazılmaz.
 */
export type GuardContext<I> = { req: Request; user: User; supabase: SupabaseClient; input: I };

export type GuardOptions<S extends ZodType | undefined> = {
  schema?: S;
  /** Varsayılan true. false → anonim kullanıcı ANONYMOUS_NOT_ALLOWED alır (ödeme uçları). */
  allowAnonymous?: boolean;
  requireAdult?: boolean;
  requireConsents?: readonly ConsentType[];
  /** ADMIN_EMAILS dışındaki herkes için 404 biçiminde FEATURE_DISABLED (varlık sızdırılmaz). */
  requireAdmin?: boolean;
  /** PHYSICIAN_EMAILS dışındaki herkes için 404 (doktor kuyruğu; ADMIN_EMAILS yetmez). */
  requirePhysician?: boolean;
};

type InputOf<S> = S extends ZodType ? z.output<S> : undefined;

export function withGuard<S extends ZodType | undefined = undefined>(
  opts: GuardOptions<S>,
  handler: (ctx: GuardContext<InputOf<S>>) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req) => {
    try {
      const supabase = await createClient();
      // Bearer varsa token Supabase Auth'ta doğrulanır; yoksa çerez oturumu.
      const bearer = parseBearer(req.headers.get("authorization"));
      const {
        data: { user },
      } = await supabase.auth.getUser(bearer ?? undefined);
      if (!user) throw new ApiError("UNAUTHENTICATED", "Oturum gerekli.");
      if (opts.allowAnonymous === false && user.is_anonymous) {
        throw new ApiError("ANONYMOUS_NOT_ALLOWED", "Bu işlem için hesabını bağlaman gerekiyor.");
      }
      if (opts.requireAdmin && !isAdminUser(user)) throw new ApiError("FEATURE_DISABLED", "Bulunamadı.");
      if (opts.requirePhysician && !isPhysicianUser(user)) throw new ApiError("FEATURE_DISABLED", "Bulunamadı.");

      let input: unknown = undefined;
      if (opts.schema) {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          throw new ApiError("BAD_INPUT", "Geçersiz JSON gövdesi.");
        }
        const parsed = opts.schema.safeParse(body);
        if (!parsed.success) {
          const first = parsed.error.issues[0];
          throw new ApiError("BAD_INPUT", first ? `${first.path.join(".") || "gövde"}: ${first.message}` : "Geçersiz girdi.");
        }
        input = parsed.data;
      }

      if (opts.requireAdult) {
        const { data } = await supabase.from("profiles").select("is_adult").eq("id", user.id).maybeSingle();
        if (!data?.is_adult) throw new ApiError("NOT_ADULT", "Bu hizmet 18 yaş ve üzeri içindir.");
      }

      if (opts.requireConsents && opts.requireConsents.length > 0) {
        const state = await getConsentState(supabase);
        for (const type of opts.requireConsents) {
          const current = await getLegalVersion(CONSENT_DOC[type]);
          const c = state[type];
          if (!c?.granted || c.textVersion !== current) {
            throw new ApiError("CONSENT_REQUIRED", `Gerekli rıza eksik veya güncel değil: ${type}`);
          }
        }
      }

      return await handler({ req, user, supabase, input: input as InputOf<S> });
    } catch (e) {
      if (e instanceof ApiError) return apiError(e.code, e.message, e.retryAt);
      // Kişisel veri yok: yalnız hata adı ve mesajı.
      console.error("[api] beklenmeyen hata:", e instanceof Error ? `${e.name}: ${e.message}` : "bilinmeyen");
      return apiError("INTERNAL", "Beklenmeyen bir hata oluştu.");
    }
  };
}

/** Kullanıcının kendi güncel rızaları (current_consents görünümü, RLS'li). */
export async function getConsentState(supabase: SupabaseClient): Promise<ConsentState> {
  const { data, error } = await supabase.from("current_consents").select("type, granted, text_version");
  if (error) throw new ApiError("INTERNAL", "Rızalar okunamadı.");
  const state: ConsentState = {};
  for (const row of data ?? []) {
    state[row.type as ConsentType] = { granted: Boolean(row.granted), textVersion: String(row.text_version) };
  }
  return state;
}

export const noContent = () => new Response(null, { status: 204 });
