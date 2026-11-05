/**
 * P1 yolculuk yığını (YALNIZ SINAMA; `bun e2e/journey/stack.ts`, playwright.journey.config.ts webServer'ı açar):
 *
 *   1. Geçici v2 veritabanı (packages/llm testing: stub + göçler + seed + TYT müfredatı) + TYT cevap anahtarları
 *      (content/tyt-matematik/scripts/seed-keys.py --schema v2). Bağlanılan 'ogrenmen' veritabanına dokunmaz.
 *   2. Gerçek Postgres üzerinde Supabase uyumlu yerel köprü (bridge.ts; kurucunun yerel denemesiyle paylaşılır): Auth
 *      (e-posta kodu, sabit JOURNEY_OTP), PostgREST alt kümesi (tablo okuma/yazma, RPC) ve Storage (uploads/documents/figures).
 *      Her istek kendi işleminde `request.jwt.claims` + `set local role authenticated|anon|service_role` ile koşar: RLS,
 *      RPC'ler ve Storage politikaları (storage.objects) gerçektir; yalnız HTTP katmanı taklittir. Realtime yok.
 *   3. apps/worker (gerçek pg-boss, OGRENMEN_LLM=fake, Storage = bu köprü, service_role JWT'si).
 *   4. apps/web `next dev` (.next-journey; OGRENMEN_LLM=fake; koç: SupabaseChatStore — yalnız kullanıcının JWT'si ile bu
 *      köprünün RPC yolu (0028 koç RPC'leri) + sunucu anahtarı OGRENMEN_WEB_COACH_KEY (göçün ürettiği secure.server_keys
 *      'web_coach' değeri); web'e veritabanı adresi verilmez).
 *
 * Uçlar: /__ready (hepsi hazırsa 200), /__info ({dbUrl}); SIGTERM/SIGINT'te çocuklar durur, veritabanı silinir.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTempDatabase, REPO_ROOT, type TempDatabase } from '@ogrenmen/llm/testing';
import { httpOk, startBridge } from './bridge';
import { BRIDGE_PORT, BRIDGE_URL, JOURNEY_JWT_SECRET, JOURNEY_OTP, JOURNEY_WEB_PORT, JOURNEY_WEB_URL, LESSON_SERVICE_PORT, WORKER_HEALTH_PORT } from './config.mjs';

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORKER_DIR = path.join(REPO_ROOT, 'apps', 'worker');
const LOG_DIR = path.join(WEB_DIR, 'test-results', 'journey');
fs.mkdirSync(LOG_DIR, { recursive: true });
const log = (msg: string) => process.stdout.write(`[journey] ${msg}\n`);
const STORE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ogrenmen-journey-storage-'));

let db: TempDatabase;

// ------------------------------------------------------------------------------------------------ süreçler

const children: ChildProcess[] = [];
function startChild(name: string, cmd: string, args: string[], cwd: string, env: Record<string, string>): ChildProcess {
  const out = fs.openSync(path.join(LOG_DIR, `${name}.log`), 'w');
  const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', out, out] });
  child.on('exit', (code, signal) => {
    if (!stopping) log(`${name} çıktı (kod ${code}, sinyal ${signal}); günlük: test-results/journey/${name}.log`);
  });
  children.push(child);
  return child;
}

let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1_500));
  for (const c of children) if (c.exitCode === null) c.kill('SIGKILL');
  await db?.drop().catch((e: unknown) => log(`veritabanı silinemedi: ${(e as Error).message}`));
  fs.rmSync(STORE_DIR, { recursive: true, force: true });
  log('durdu; geçici veritabanı silindi');
  process.exit(code);
}
process.on('SIGTERM', () => void stop(0));
process.on('SIGINT', () => void stop(0));

async function main() {
  log('geçici veritabanı kuruluyor (göçler + seed + TYT müfredatı)');
  db = await createTempDatabase();
  execFileSync('python3', [path.join(REPO_ROOT, 'content/tyt-matematik/scripts/seed-keys.py'), '--schema', 'v2', '--database-url', db.url], {
    stdio: 'pipe',
    env: { ...process.env, PGOPTIONS: '-c role=ogrenmen_owner' },
  });
  log(`veritabanı hazır: ${db.name}`);
  const coachKey = String((await db.pool.query(`select secret from secure.server_keys where name = 'web_coach'`)).rows[0]?.secret ?? '');

  const bridge = await startBridge({
    db,
    port: BRIDGE_PORT,
    otp: JOURNEY_OTP,
    jwtSecret: JOURNEY_JWT_SECRET,
    log,
    storageDir: STORE_DIR,
    info: () => ({ dbUrl: db.url, dbName: db.name, web: JOURNEY_WEB_URL }),
    ready: async () =>
      (await httpOk(`http://127.0.0.1:${WORKER_HEALTH_PORT}/healthz`)) && (await httpOk(`http://127.0.0.1:${LESSON_SERVICE_PORT}/healthz`)) && (await httpOk(`${JOURNEY_WEB_URL}/api/health`)),
  });
  log(`köprü ${BRIDGE_URL}`);

  // Worker, Supabase'deki gibi migration sahibinin rolüyle bağlanır (yerel eşleniği ogrenmen_owner; supabase/README.md
  // "pgboss şemasını worker kurar"): pgboss şeması bu role ait olur, SECURITY DEFINER enqueue_job pgboss.job'a yazabilir.
  // Ders medya servisi (pipelines/ders; ffmpeg + OGRENMEN_STT=fake deterministik transkript; Storage = bu köprü)
  startChild('ders', 'python3', ['-I', path.join(REPO_ROOT, 'pipelines/ders/src/ogrenmen_ders/service.py'), '--port', String(LESSON_SERVICE_PORT)], REPO_ROOT, {
    OGRENMEN_STT: 'fake',
    OGRENMEN_STT_FIXTURES: path.join(REPO_ROOT, 'fixtures', 'ders'),
    OGRENMEN_DERS_WORK_DIR: path.join(STORE_DIR, '__ders'),
    OGRENMEN_DERS_QUIET: '1',
    SUPABASE_URL: BRIDGE_URL,
    SUPABASE_SERVICE_ROLE_KEY: bridge.serviceKey,
  });
  startChild('worker', 'node', ['--import', 'tsx', 'src/index.ts'], WORKER_DIR, {
    DATABASE_URL: db.url,
    PGOPTIONS: '-c role=ogrenmen_owner',
    WORKER_PROCESS: 'worker',
    WORKER_SCHEDULES: 'off',
    HEALTH_HOST: '127.0.0.1',
    HEALTH_PORT: String(WORKER_HEALTH_PORT),
    SUPABASE_URL: BRIDGE_URL,
    SUPABASE_SERVICE_ROLE_KEY: bridge.serviceKey,
    OGRENMEN_LLM: 'fake',
    LESSON_SERVICE_URL: `http://127.0.0.1:${LESSON_SERVICE_PORT}`,
    LOG_LEVEL: 'info',
  });
  startChild('web', 'node', [path.join(WEB_DIR, 'node_modules/next/dist/bin/next'), 'dev', '--webpack', '-p', String(JOURNEY_WEB_PORT), '-H', '127.0.0.1'], WEB_DIR, {
    NEXT_DIST_DIR: '.next-journey',
    NEXT_PUBLIC_SUPABASE_URL: BRIDGE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: bridge.anonKey,
    NEXT_PUBLIC_SITE_URL: JOURNEY_WEB_URL,
    NEXT_TELEMETRY_DISABLED: '1',
    OGRENMEN_LLM: 'fake',
    // Kurucunun üretimde yaptığı gibi: göçün ürettiği anahtar web sunucusunun ortamına kopyalanır (tarayıcıya gitmez).
    OGRENMEN_WEB_COACH_KEY: coachKey,
  });
}

main().catch((err: unknown) => {
  log(`açılış hatası: ${(err as Error).stack ?? err}`);
  void stop(1);
});
