#!/usr/bin/env node
/**
 * Yerel prototip kurulumu (tek komut): Supabase Yönetim API'si ile
 *   1. migration'ları uygular (scripts/supabase-api-migrate.mjs),
 *   2. anonim girişi açar,
 *   3. anon + service_role anahtarlarını .env.local'e yazar (boş olanları),
 *   4. isteğe bağlı: bir kullanıcıyı premium yapar (--premium <user_id> | --premium latest),
 *   5. isteğe bağlı: test hesabına sınırsız hak verir (--unlimited <user_id> | --unlimited latest).
 * Her adım bağımsızdır; biri başarısız olursa elle yapılacak adımı yazar ve devam eder.
 *
 * Kullanım: SUPABASE_ACCESS_TOKEN=sbp_... SUPABASE_PROJECT_REF=xxxx [GEMINI_API_KEY=...] [ANTHROPIC_API_KEY=...] node scripts/dev-bootstrap.mjs [--premium latest]
 * ANTHROPIC_API_KEY verilirse Claude motoru da açılır: SCORE_ENGINE=hybrid.v1, AI_OBSERVE_PROVIDER=claude, AI_COACH_PROVIDER=claude.
 * Gizli değerler yalnız .env.local'e yazılır (depoya girmez); ekrana basılmaz.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import path from "node:path";

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;
if (!token || !ref) {
  console.error("SUPABASE_ACCESS_TOKEN ve SUPABASE_PROJECT_REF gerekli (Supabase → Account → Access Tokens; proje ref adres çubuğunda).");
  process.exit(1);
}
const args = process.argv.slice(2);
const premiumArg = args.includes("--premium") ? args[args.indexOf("--premium") + 1] : null;
const unlimitedArg = args.includes("--unlimited") ? args[args.indexOf("--unlimited") + 1] : null;
const API = `https://api.supabase.com/v1/projects/${ref}`;
const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

async function call(method, p, body) {
  const res = await fetch(`${API}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${method} ${p}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
const sql = (q) => call("POST", "/database/query", { query: q });

// .env.local
const envPath = path.join(process.cwd(), ".env.local");
if (!existsSync(envPath)) {
  copyFileSync(path.join(process.cwd(), ".env.example"), envPath);
  console.log(".env.local oluşturuldu (.env.example kopyası)");
}
let env = readFileSync(envPath, "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=([^\\n#]*)`, "m"))?.[1] ?? "").trim();
function set(k, v, force = false) {
  if (!force && get(k)) return false; // dolu değeri ezme (force: motor seçimi gibi gizli olmayan ayarlar)
  if (get(k) === v) return false;
  env = env.match(new RegExp(`^${k}=`, "m")) ? env.replace(new RegExp(`^${k}=[^\\n]*`, "m"), `${k}=${v}`) : `${env.trimEnd()}\n${k}=${v}\n`;
  return true;
}

// 1. migration'lar
console.log("\n[1/4] migration'lar");
const mig = spawnSync(process.execPath, [path.join("scripts", "supabase-api-migrate.mjs")], { stdio: "inherit", env: process.env });
if (mig.status !== 0) console.log("  ! migration başarısız; çıktıyı kontrol et (ağ veya token).");

// 2. anonim giriş
console.log("\n[2/4] anonim giriş");
try {
  await call("PATCH", "/config/auth", { external_anonymous_users_enabled: true });
  console.log("  açıldı");
} catch (e) {
  console.log(`  ! açılamadı (${e.message.split("\n")[0]}). Elle: Supabase → Authentication → Sign In / Providers → Anonymous sign-ins: açık.`);
}

// 3. anahtarlar
console.log("\n[3/4] anahtarlar → .env.local");
let keys = null;
for (const p of ["/api-keys?reveal=true", "/api-keys"]) {
  try {
    keys = await call("GET", p);
    if (Array.isArray(keys)) break;
  } catch {
    keys = null;
  }
}
const pick = (list, want) => list?.find((k) => k.name === want || k.type === want)?.api_key ?? null;
const anon = pick(keys, "anon") ?? pick(keys, "publishable");
const service = pick(keys, "service_role") ?? pick(keys, "secret");
let wrote = 0;
if (set("NEXT_PUBLIC_SUPABASE_URL", `https://${ref}.supabase.co`)) wrote++;
if (anon && set("NEXT_PUBLIC_SUPABASE_ANON_KEY", anon)) wrote++;
if (service && set("SUPABASE_SERVICE_ROLE_KEY", service)) wrote++;
if (process.env.GEMINI_API_KEY && set("GEMINI_API_KEY", process.env.GEMINI_API_KEY)) wrote++;
if (process.env.ANTHROPIC_API_KEY) {
  if (set("ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY)) wrote++;
  // Yalnız yerel prototip: Claude motoru (hybrid.v1) ve Claude koç raporu. Production bu betikle ayarlanmaz.
  for (const [k, v] of [["SCORE_ENGINE", "hybrid.v1"], ["AI_OBSERVE_PROVIDER", "claude"], ["AI_COACH_PROVIDER", "claude"]]) if (set(k, v, true)) wrote++;
}
writeFileSync(envPath, env);
console.log(`  ${wrote} değer yazıldı`);
if (!anon || !service) console.log("  ! anahtarlar API'den alınamadı. Elle: Supabase → Settings → API → anon ve service_role değerlerini .env.local'e yapıştır.");

// 4. premium
console.log("\n[4/4] premium");
if (!premiumArg) console.log("  atlandı (--premium <user_id> veya --premium latest ile bir kullanıcıyı premium yapabilirsin)");
else {
  try {
    let userId = premiumArg;
    if (premiumArg === "latest") {
      const rows = await sql("select id from auth.users order by created_at desc limit 1");
      userId = rows?.[0]?.id;
      if (!userId) throw new Error("auth.users boş; önce uygulamada 'Analizini başlat' de");
    }
    await sql(`insert into public.subscriptions (user_id, provider, plan, status, current_period_start, current_period_end)
      values ('${userId}', 'iyzico', 'monthly', 'active', now(), now() + interval '30 days')
      on conflict (user_id) do update set status = 'active', plan = 'monthly', current_period_end = now() + interval '30 days', updated_at = now()`);
    console.log(`  premium açıldı: ${userId}`);
  } catch (e) {
    console.log(`  ! olmadı (${e.message.split("\n")[0]}).`);
  }
}

// 5. sınırsız hak (test hesabı)
if (unlimitedArg) {
  console.log("\n[5/5] sınırsız hak");
  try {
    let userId = unlimitedArg;
    if (unlimitedArg === "latest") {
      const rows = await sql("select id from auth.users order by created_at desc limit 1");
      userId = rows?.[0]?.id;
      if (!userId) throw new Error("auth.users boş");
    }
    await sql(`update public.profiles set unlimited_quota = true, updated_at = now() where id = '${userId}'`);
    console.log(`  analiz/deneme/rapor limitleri kaldırıldı: ${userId}`);
  } catch (e) {
    console.log(`  ! olmadı (${e.message.split("\n")[0]}).`);
  }
}

console.log("\nSonraki adım:");
if (!get("GEMINI_API_KEY")) console.log("  - .env.local içine GEMINI_API_KEY=... yaz");
console.log("  - pnpm dev  →  http://localhost:3000  →  'Analizini başlat'");
console.log("  - tam skor için: SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=... pnpm dev:bootstrap --premium latest");
