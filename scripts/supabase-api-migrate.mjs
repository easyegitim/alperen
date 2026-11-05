#!/usr/bin/env node
/**
 * Migration'ları Supabase Yönetim API'si (HTTPS) üzerinden uygular ve CLI ile aynı geçmiş tablosuna yazar.
 * Postgres portunun (5432/6543) dışarı kapalı olduğu ortamlar için `supabase db push --linked` eşdeğeri.
 * CLAUDE.md gereği yalnız açık onayla çalıştırılır (staging/production veritabanı değişikliği).
 *
 * Kullanım: SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=... node scripts/supabase-api-migrate.mjs [--dry-run]
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;
const dry = process.argv.includes("--dry-run");
if (!token || !ref) {
  console.error("SUPABASE_ACCESS_TOKEN ve SUPABASE_PROJECT_REF gerekli.");
  process.exit(1);
}
const API = `https://api.supabase.com/v1/projects/${ref}/database/query`;

async function query(sql) {
  const res = await fetch(API, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// CLI ile aynı geçmiş tablosu (supabase_migrations.schema_migrations)
await query(`create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);`);
const applied = new Set((await query("select version from supabase_migrations.schema_migrations order by version")).map((r) => String(r.version)));

const dir = path.join(process.cwd(), "supabase", "migrations");
const files = readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
let n = 0;
for (const f of files) {
  const version = f.split("_")[0];
  const name = f.replace(/^\d+_/, "").replace(/\.sql$/, "");
  if (applied.has(version)) {
    console.log(`atlandı (uygulanmış): ${f}`);
    continue;
  }
  const sql = readFileSync(path.join(dir, f), "utf8");
  if (dry) {
    console.log(`uygulanacak: ${f} (${sql.length} karakter)`);
    continue;
  }
  // Tek işlem: migration ve geçmiş kaydı birlikte; hata olursa ikisi de geri alınır.
  const record = `insert into supabase_migrations.schema_migrations (version, name, statements) values ('${version}', '${name.replace(/'/g, "''")}', array[$aura$${sql.replace(/\$aura\$/g, "")}$aura$])`;
  await query(`begin;\n${sql}\n${record};\ncommit;`);
  console.log(`uygulandı: ${f}`);
  n++;
}
console.log(dry ? "dry-run bitti" : `${n} migration uygulandı`);
