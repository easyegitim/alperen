/**
 * RLS testleri (SPEC Faz 2 madde 6). Yerel Supabase'e karşı çalışır:
 *   SUPABASE_TEST_URL, SUPABASE_TEST_ANON_KEY, SUPABASE_TEST_SERVICE_ROLE_KEY
 * Çalıştırma: pnpm test:rls  (pnpm test bu dosyayı içermez; atlama yok, ayrı komut.)
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} gerekli (yerel Supabase). Bkz. tests/rls/rls.test.ts başlığı.`);
  return v;
}

const URL = env("SUPABASE_TEST_URL");
const ANON = env("SUPABASE_TEST_ANON_KEY");
const SERVICE = env("SUPABASE_TEST_SERVICE_ROLE_KEY");

const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

type TestUser = { id: string; client: SupabaseClient };
const users: TestUser[] = [];

async function makeUser(tag: string): Promise<TestUser> {
  const email = `rls-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const password = `Pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("kullanıcı oluşturulamadı");
  const client = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  const u = { id: data.user.id, client };
  users.push(u);
  return u;
}

let a: TestUser;
let b: TestUser;

beforeAll(async () => {
  a = await makeUser("a");
  b = await makeUser("b");
});

afterAll(async () => {
  for (const u of users) await admin.auth.admin.deleteUser(u.id);
});

describe("profiles", () => {
  it("kullanıcı yalnız kendi profilini okur", async () => {
    const mine = await a.client.from("profiles").select("id");
    expect(mine.error).toBeNull();
    expect(mine.data?.map((r) => r.id)).toEqual([a.id]);
  });

  it("is_adult tarayıcıdan güncellenemez", async () => {
    const res = await a.client.from("profiles").update({ is_adult: true }).eq("id", a.id).select();
    expect(res.error).not.toBeNull();
    const check = await admin.from("profiles").select("is_adult").eq("id", a.id).single();
    expect(check.data?.is_adult).toBe(false);
  });

  it("questionnaire ve locale güncellenebilir", async () => {
    const res = await a.client.from("profiles").update({ questionnaire: { goals: ["hair"] }, locale: "tr" }).eq("id", a.id).select("questionnaire");
    expect(res.error).toBeNull();
    expect(res.data?.[0]?.questionnaire).toEqual({ goals: ["hair"] });
  });
});

describe("consents / routine (kendi satırları)", () => {
  it("A ekler, B okuyamaz", async () => {
    const ins = await a.client.from("consents").insert({ user_id: a.id, type: "kvkk_notice_ack", granted: true, text_version: "test" });
    expect(ins.error).toBeNull();
    const asB = await b.client.from("consents").select("id");
    expect(asB.error).toBeNull();
    expect(asB.data).toHaveLength(0);
    const asA = await a.client.from("consents").select("id");
    expect(asA.data?.length).toBeGreaterThanOrEqual(1);
  });

  it("B başkası adına consent ekleyemez", async () => {
    const ins = await b.client.from("consents").insert({ user_id: a.id, type: "marketing", granted: true, text_version: "test" });
    expect(ins.error).not.toBeNull();
  });

  it("routine_items çapraz okunamaz", async () => {
    const ins = await a.client.from("routine_items").insert({ user_id: a.id, kind: "habit", ref_id: "water", slot: "daily", title: "Su" });
    expect(ins.error).toBeNull();
    const asB = await b.client.from("routine_items").select("id");
    expect(asB.data).toHaveLength(0);
  });
});

describe("kilitli tablolar (analyses, coach_reports)", () => {
  it("authenticated rolüyle hiç okunamaz; satır varken bile boş döner", async () => {
    const row = await admin
      .from("analyses")
      .insert({ user_id: a.id, client_request_id: crypto.randomUUID(), status: "completed", overall: 6.4, potential: 7.6 })
      .select("id")
      .single();
    expect(row.error).toBeNull();
    const rep = await admin
      .from("coach_reports")
      .insert({ user_id: a.id, analysis_id: row.data!.id, model: "test", prompt_version: "v0", report: {} })
      .select("id")
      .single();
    expect(rep.error).toBeNull();

    const an = await a.client.from("analyses").select("*");
    expect(an.data ?? []).toHaveLength(0);
    const cr = await a.client.from("coach_reports").select("*");
    expect(cr.data ?? []).toHaveLength(0);
  });
});

describe("kota fonksiyonları", () => {
  it("reserve_analysis authenticated ile çağrılamaz", async () => {
    const res = await a.client.rpc("reserve_analysis", {
      p_user: a.id,
      p_client_request_id: crypto.randomUUID(),
      p_limit: 1,
      p_since: "-infinity",
    });
    expect(res.error).not.toBeNull();
  });

  it("reserve_tryon authenticated ile çağrılamaz", async () => {
    const res = await a.client.rpc("reserve_tryon", {
      p_user: a.id,
      p_client_request_id: crypto.randomUUID(),
      p_preset: "buzz_cut",
      p_model: "test",
      p_limit: 10,
      p_since: "-infinity",
    });
    expect(res.error).not.toBeNull();
  });
});

describe("partners", () => {
  it("yalnız aktif ve doğrulanmış partnerler görünür", async () => {
    const base = { kind: "doctor", specialties: ["dermatoloji"], city: "İstanbul", license_no: "X", contact_email: "p@example.test" };
    const hidden = await admin.from("partners").insert({ ...base, name: "Gizli", active: false }).select("id").single();
    const shown = await admin.from("partners").insert({ ...base, name: "Görünür", active: true, verified_at: new Date().toISOString() }).select("id").single();
    expect(hidden.error).toBeNull();
    expect(shown.error).toBeNull();
    const res = await a.client.from("partners").select("id").in("id", [hidden.data!.id, shown.data!.id]);
    expect(res.data?.map((r) => r.id)).toEqual([shown.data!.id]);
    await admin.from("partners").delete().in("id", [hidden.data!.id, shown.data!.id]);
  });
});
