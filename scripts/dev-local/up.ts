/**
 * Kurucunun yerel denemesi: tüm uygulamayı tek komutla kendi bilgisayarında açar (docs/PLAN-v2.md §13; plan §15f).
 *
 *   bun run local            # aç (ilk açılışta veritabanını kurar; sonra dokunmaz)
 *   bun run local:reset      # yerel veritabanını ve yüklenen dosyaları silip baştan kur
 *
 * Ne açılır (sabit portlar, yalnız 127.0.0.1):
 *   - Postgres'te kalıcı `ogrenmen_dev` veritabanı: göçler + ayarlar + TYT Matematik müfredatı + cevap anahtarları; yeni
 *     göçler sonraki açılışlarda kendiliğinden uygulanır (kayıt: public.__dev_migrations).
 *   - 54321: Supabase uyumlu yerel köprü (apps/web/e2e/journey/bridge.ts): giriş kodu 246810, RLS ve RPC'ler gerçek.
 *     Tarayıcı istekleri yalnız http://localhost:3000 ve http://127.0.0.1:3000 kökeninden kabul edilir (başka bir
 *     sitenin tarayıcı üzerinden sabit kodla oturum açmasını engeller).
 *   - 8722: ders medya servisi (pipelines/ders; ffmpeg; GROQ_API_KEY yoksa sahte yazıya dökme).
 *   - 3113: worker (pg-boss; zamanlanmış işler açık; PDF üretimi dahil).
 *   (Portlar journey E2E yığınından (3102/3103/8712/54398) ayrıdır: ikisi aynı anda açık olabilir.)
 *   - 3000: web (`next dev`, apps/web/.next-local).
 *   - Demo hesaplar: ogrenci@ / veli@ / egitmen@ogrenmen.local (ilk açılışta kurulur; sonra yalnız eksikler tamamlanır).
 *
 * Ortam: depo kökündeki `.env.local` (git'e girmez) ya da kabuk. ANTHROPIC_API_KEY zorunlu (OGRENMEN_LLM=fake değilse);
 * GROQ_API_KEY ve VOYAGE_API_KEY isteğe bağlı. Veritabanı adresi OGRENMEN_DATABASE_URL (varsayılan: docker compose'daki
 * postgresql://postgres:postgres@127.0.0.1:5432/postgres). Günlükler `.dev-local/logs/`. Ctrl+C her şeyi kapatır;
 * veritabanı SİLİNMEZ.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createDatabase, dropDatabaseByName, REPO_ROOT, type PersistentDatabase } from '../../packages/llm/src/testing/tempDb';
import { httpOk, startBridge, type Bridge } from '../../apps/web/e2e/journey/bridge';
import { LOCAL_DEMO_ACCOUNTS, LOCAL_DEV_OTP } from '../../apps/web/src/lib/local-dev';
import { classifyAnthropicStatus, probeAnthropic, PYTHON_PACKAGES_CHECK, PYTHON_PACKAGES_FIX, pythonCmd } from './doctor';

// ------------------------------------------------------------------------------------------------ sabitler

const DB_NAME = 'ogrenmen_dev';
const DEFAULT_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
const PORTS = { bridge: 54321, web: 3000, worker: 3113, ders: 8722 } as const;
const BRIDGE_URL = `http://127.0.0.1:${PORTS.bridge}`;
const WEB_URL = `http://localhost:${PORTS.web}`;
const WEB_LOCAL = `http://127.0.0.1:${PORTS.web}`;
/** Köprüye tarayıcıdan yalnız yerel web'in kökenleri ulaşır; Origin başlığı olmayan sunucu istekleri serbesttir. */
const ALLOWED_ORIGINS = [WEB_URL, WEB_LOCAL];
// Köprünün imza anahtarı ilk açılışta rastgele üretilip .dev-local/jwt-secret'a yazılır (depoda sabit sır yok). Dosya ve
// anahtarların iat'i sabit kaldığı için anon anahtarı açılıştan açılışa aynıdır (web'in derleme önbelleği bozulmaz).
const KEY_ISSUED_AT = 1_767_225_600; // 2026-01-01
const KEY_TTL = 20 * 365 * 86_400;
const MIGRATION_ROLE = 'ogrenmen_owner';
const EXAM_DATE = '2027-06-19'; // TYT 2027 (tahmini)

const DEV_DIR = path.join(REPO_ROOT, '.dev-local');
const LOG_DIR = path.join(DEV_DIR, 'logs');
const STORAGE_DIR = path.join(DEV_DIR, 'storage');
const DERS_DIR = path.join(DEV_DIR, 'ders');
const WEB_DIR = path.join(REPO_ROOT, 'apps', 'web');
const WORKER_DIR = path.join(REPO_ROOT, 'apps', 'worker');
const ENV_FILE = path.join(REPO_ROOT, '.env.local');
const JWT_SECRET_FILE = path.join(DEV_DIR, 'jwt-secret');

const say = (msg = '') => process.stdout.write(`${msg}\n`);
const step = (msg: string) => say(`→ ${msg}`);
const warn = (msg: string) => say(`! ${msg}`);

/** Kullanıcıya Türkçe, ne yapacağını söyleyen hata; yığın izi basılmaz. */
class SetupError extends Error {
  constructor(
    message: string,
    readonly hint: string[] = [],
  ) {
    super(message);
  }
}

function fail(err: unknown): never {
  say();
  if (err instanceof SetupError) {
    say(`HATA: ${err.message}`);
    for (const h of err.hint) say(`  ${h}`);
  } else {
    say(`HATA: beklenmeyen bir sorun oldu: ${(err as Error)?.message ?? String(err)}`);
    say(`  Ayrıntı için günlüklere bak: ${path.relative(process.cwd(), LOG_DIR) || LOG_DIR}`);
  }
  say();
  process.exit(1);
}

// ------------------------------------------------------------------------------------------------ ortam

/** `.env.local`: KEY=değer satırları (# yorum, `export ` öneki, tek/çift tırnak). Kabukta tanımlı değer önceliklidir. */
function loadEnvFile(file: string): string[] {
  if (!fs.existsSync(file)) return [];
  const loaded: string[] = [];
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    let value = m[2]!;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '').trim();
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = value;
      if (value) loaded.push(key);
    }
  }
  return loaded;
}

type LlmMode = 'gerçek' | 'sahte';

function decideLlm(): LlmMode {
  if (process.env.OGRENMEN_LLM === 'fake') return 'sahte';
  const key = (process.env.ANTHROPIC_API_KEY ?? '').trim();
  if (!key) {
    throw new SetupError('ANTHROPIC_API_KEY bulunamadı: gerçek Claude ile açmak için anahtar gerekiyor.', [
      '1. Depo kökünde .env.local dosyası oluştur (örnek: .env.local.example dosyasını kopyala):',
      '     cp .env.local.example .env.local',
      '2. Dosyayı aç ve şu satırı kendi anahtarınla doldur (console.anthropic.com → API Keys):',
      '     ANTHROPIC_API_KEY=sk-ant-...',
      '3. Yeniden çalıştır:  bun run local',
      'Anahtarı kimseyle (sohbet dahil) paylaşma; .env.local git\'e girmez.',
      'Anahtarsız denemek istersen (cevaplar örnek metindir):  OGRENMEN_LLM=fake bun run local',
    ]);
  }
  if (!key.startsWith('sk-ant-')) warn('ANTHROPIC_API_KEY "sk-ant-" ile başlamıyor; yanlış kopyalanmış olabilir.');
  return 'gerçek';
}

/**
 * Gerçek kipte anahtarı açılıştan önce sınar (doctor ile aynı /v1/models isteği; ücretsiz). Reddedilen anahtar açılışı
 * durdurur; kredi sorunu, ağ hatası ve 429 yalnız uyarıdır. Anahtarın değeri hiçbir yere yazılmaz.
 */
async function verifyAnthropicKey(): Promise<void> {
  const probe = await probeAnthropic((process.env.ANTHROPIC_API_KEY ?? '').trim());
  const r = classifyAnthropicStatus(probe.status, probe.body);
  if (r.level === 'ok') {
    step('Anthropic anahtarı geçerli');
    return;
  }
  if (r.level === 'fail') {
    throw new SetupError(r.detail, [...(r.fix ?? []), 'Sonra yeniden çalıştır:  bun run local', 'Anahtarsız denemek istersen (cevaplar örnek metindir):  OGRENMEN_LLM=fake bun run local']);
  }
  warn(r.detail);
  for (const f of r.fix ?? []) say(`    ${f}`);
}

/** Köprünün imza sırrı: .dev-local/jwt-secret (yoksa rastgele üretilir; yalnız bu bilgisayarda kalır, git'e girmez). */
function jwtSecret(): string {
  try {
    const existing = fs.readFileSync(JWT_SECRET_FILE, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch {
    /* ilk açılış */
  }
  const secret = crypto.randomBytes(32).toString('base64url');
  fs.mkdirSync(DEV_DIR, { recursive: true });
  fs.writeFileSync(JWT_SECRET_FILE, `${secret}\n`, { mode: 0o600 });
  return secret;
}

function has(cmd: string, args: string[] = ['--version']): boolean {
  const r = spawnSync(cmd, args, { stdio: 'ignore' });
  return r.status === 0;
}

function checkTools(): void {
  const nodeVer = spawnSync('node', ['--version'], { encoding: 'utf8' });
  const major = Number(/^v(\d+)/.exec(String(nodeVer.stdout ?? ''))?.[1] ?? 0);
  const nodeHint = [
    'macOS:  brew install node   (güncel sürüm, 22 ya da üstü; sonra terminali kapatıp aç)',
    'Ubuntu / Windows (WSL):  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs',
  ];
  if (nodeVer.status !== 0) throw new SetupError('node bulunamadı.', nodeHint);
  if (major < 22) throw new SetupError(`Node.js ${major} kurulu; en az 22 gerekiyor.`, nodeHint);
  const python = pythonCmd();
  if (!has(python)) {
    throw new SetupError(`${python} bulunamadı.`, python === 'python3' ? ['macOS:  brew install python', 'Ubuntu / Windows (WSL):  sudo apt install -y python3'] : ['.env.local içindeki OGRENMEN_PYTHON yolunu kontrol et ya da satırı sil.']);
  }
  // Worker ve ders servisi Python'ı -I ile çalıştırır; kontrol de aynı kipte (kullanıcı site-packages'ı sayılmaz).
  if (!has(python, PYTHON_PACKAGES_CHECK)) {
    throw new SetupError('Python paketleri eksik (sympy, matplotlib, numpy): soru doğrulama ve şekiller bunlarla yapılır.', [...PYTHON_PACKAGES_FIX, 'Sonra kontrol et:  bun run doctor']);
  }
  if (!has('psql')) {
    throw new SetupError('psql (Postgres istemcisi) bulunamadı: ilk kurulumda cevap anahtarları onunla yüklenir.', [
      'macOS:  brew install libpq && brew link --force libpq',
      'Ubuntu / Windows (WSL):  sudo apt install postgresql-client',
    ]);
  }
  if (!fs.existsSync(path.join(WEB_DIR, 'node_modules', 'next')) || !fs.existsSync(path.join(WORKER_DIR, 'node_modules', 'tsx'))) {
    throw new SetupError('Paketler kurulmamış.', ['Depo kökünde çalıştır:  bun install']);
  }
  if (!has('ffmpeg', ['-version'])) warn('ffmpeg bulunamadı: ders kaydı yükleme çalışmaz (macOS:  brew install ffmpeg; Ubuntu/WSL:  sudo apt install -y ffmpeg).');
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}

async function checkPorts(): Promise<void> {
  const busy: number[] = [];
  for (const p of Object.values(PORTS)) if (!(await portFree(p))) busy.push(p);
  if (busy.length) {
    throw new SetupError(`Şu port(lar) kullanımda: ${busy.join(', ')}.`, [
      'Başka bir pencerede "bun run local" açık olabilir: o pencerede Ctrl+C ile kapat.',
      `Hangi programın kullandığını görmek için (macOS/Linux):  lsof -i :${busy[0]}`,
    ]);
  }
}

function databaseHint(url: string, err: unknown): SetupError {
  const e = err as { code?: string; message?: string };
  const safe = url.replace(/:\/\/([^:@/]+):[^@/]*@/, '://$1:***@');
  const msg = e.message ?? String(err);
  if (e.code === 'ECONNREFUSED' || /ECONNREFUSED|connect/i.test(msg)) {
    return new SetupError(`Postgres'e bağlanılamadı (${safe}).`, [
      'Docker Desktop açık mı? Açıksa depo kökünde:  docker compose up -d',
      'Kendi Postgres 16 + pgvector kurulumunu kullanıyorsan adresini .env.local dosyasına yaz:',
      '  OGRENMEN_DATABASE_URL=postgresql://kullanici:parola@127.0.0.1:5432/postgres',
    ]);
  }
  if (e.code === '28P01' || e.code === '28000') {
    return new SetupError(`Postgres kullanıcı adı ya da parolası yanlış (${safe}).`, ['.env.local içindeki OGRENMEN_DATABASE_URL değerini kontrol et.']);
  }
  if (/pgvector|vector/.test(msg)) {
    return new SetupError('Postgres sunucusunda pgvector uzantısı yok.', [
      'En kolayı Docker ile açmak:  docker compose up -d   (pgvector hazır gelir)',
      'Kendi Postgres\'inde:  brew install pgvector   (sonra Postgres\'i yeniden başlat)',
    ]);
  }
  if (e.code === '42501' || /permission denied|must be superuser/i.test(msg)) {
    return new SetupError(`Postgres kullanıcısının yetkisi yetmiyor (${safe}).`, ['Veritabanı açabilen bir yönetici kullanıcı gerekir (docker compose\'daki "postgres" kullanıcısı uygundur).']);
  }
  return new SetupError(`Veritabanı kurulamadı: ${msg}`, ['Baştan kurmayı dene:  bun run local:reset', `Ayrıntı: ${path.join('.dev-local', 'logs')}`]);
}

// ------------------------------------------------------------------------------------------------ süreçler

const children = new Map<string, ChildProcess>();
let stopping = false;
let bridge: Bridge | null = null;
let db: PersistentDatabase | null = null;

function startChild(name: string, cmd: string, args: string[], cwd: string, env: Record<string, string | undefined>): ChildProcess {
  const out = fs.openSync(path.join(LOG_DIR, `${name}.log`), 'a');
  fs.writeSync(out, `\n===== ${new Date().toISOString()} ${name} açılıyor =====\n`);
  const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', out, out] });
  child.on('exit', (code, signal) => {
    if (stopping) return;
    say();
    say(`HATA: "${name}" beklenmedik şekilde durdu (kod ${code ?? '-'}, sinyal ${signal ?? '-'}).`);
    say(`  Son satırlar (${path.join('.dev-local', 'logs', `${name}.log`)}):`);
    for (const line of tail(path.join(LOG_DIR, `${name}.log`), 15)) say(`    ${line}`);
    say('  Her şey kapatılıyor; sorunu giderip yeniden çalıştır:  bun run local');
    void stop(1);
  });
  children.set(name, child);
  return child;
}

function tail(file: string, n: number): string[] {
  try {
    return fs.readFileSync(file, 'utf8').trimEnd().split('\n').slice(-n);
  } catch {
    return [];
  }
}

async function stop(code = 0): Promise<void> {
  if (stopping) return;
  stopping = true;
  if (code === 0) say('\nKapatılıyor…');
  for (const c of children.values()) if (c.exitCode === null) c.kill('SIGTERM');
  const deadline = Date.now() + 8_000;
  while ([...children.values()].some((c) => c.exitCode === null && c.signalCode === null) && Date.now() < deadline) await sleep(200);
  for (const c of children.values()) if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL');
  await bridge?.close().catch(() => undefined);
  await db?.close().catch(() => undefined);
  if (code === 0) say('Kapandı. Veritabanı (ogrenmen_dev) ve yüklenen dosyalar duruyor; tekrar açmak için:  bun run local');
  process.exit(code);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(what: string, check: () => Promise<boolean>, ms: number): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (stopping) return;
    if (await check()) return;
    await sleep(1_000);
  }
  throw new SetupError(`${what} ${Math.round(ms / 1000)} saniyede hazır olmadı.`, [`Günlüklere bak: ${path.join('.dev-local', 'logs')}`, 'Yeniden dene:  bun run local']);
}

// ------------------------------------------------------------------------------------------------ demo hesaplar

interface DemoResult {
  created: string[];
  studentId: string;
  enrolled: boolean;
  refreshQueued: boolean;
}

/**
 * Demo hesaplar (idempotent; migration sahibi rolüyle, RLS atlanır): öğrenci Elif (11. sınıf, TYT 2027 kaydı
 * onboarding_enroll ile; ilk öneriyi suggestions.refresh yazar), Elif'e bağlı aktif veli, admin eğitmen (Elif'e owner bağı).
 */
async function ensureDemoAccounts(database: PersistentDatabase): Promise<DemoResult> {
  const byRole = Object.fromEntries(LOCAL_DEMO_ACCOUNTS.map((a) => [a.role, a.email])) as Record<'student' | 'parent' | 'admin', string>;
  const c = await database.pool.connect();
  try {
    await c.query('begin');
    await c.query(`set local role ${MIGRATION_ROLE}`);
    const created: string[] = [];
    const ids: Record<string, string> = {};
    for (const [role, email] of Object.entries(byRole)) {
      const found = await c.query(`select id::text from auth.users where lower(email) = lower($1)`, [email]);
      if (found.rows[0]) ids[role] = found.rows[0].id;
      else {
        ids[role] = (await c.query(`insert into auth.users (email) values (lower($1)) returning id::text`, [email])).rows[0].id;
        created.push(email);
      }
    }
    await c.query(
      `insert into public.profiles (id, role, display_name, onboarded_at) values
         ($1, 'student', 'Elif', null), ($2, 'parent', 'Ayşe (Elif''in annesi)', now()), ($3, 'admin', 'Deniz Hoca', now())
       on conflict (id) do nothing`,
      [ids.student, ids.parent, ids.admin],
    );
    const st = await c.query(`select id::text from public.students where profile_id = $1`, [ids.student]);
    const studentId = st.rows[0]?.id as string | undefined;
    if (!studentId) throw new Error('öğrenci satırı oluşmadı (profiles_create_student tetikleyicisi)');
    await c.query(`update public.students set grade = coalesce(grade, '11'), school = coalesce(school, 'Deneme Anadolu Lisesi') where id = $1`, [studentId]);
    let enr = await c.query(`select id::text, course_id::text from public.enrollments where student_id = $1 and status = 'active' order by created_at limit 1`, [studentId]);
    let enrolled = false;
    if (!enr.rows[0]) {
      await c.query(`select public.onboarding_enroll($1, $2::date, $3::uuid)`, ['TYT Matematik', EXAM_DATE, studentId]);
      enr = await c.query(`select id::text, course_id::text from public.enrollments where student_id = $1 and status = 'active' order by created_at limit 1`, [studentId]);
      enrolled = true;
    }
    const enrollment = enr.rows[0] as { id: string; course_id: string | null };
    await c.query(`update public.profiles set onboarded_at = coalesce(onboarded_at, now()) where id = $1`, [ids.student]);
    await c.query(
      `insert into public.guardian_links (parent_id, student_id, relation, status, created_by, accepted_at)
       values ($1, $2, 'anne', 'active', $3, now())
       on conflict (parent_id, student_id) do update set status = 'active', accepted_at = coalesce(public.guardian_links.accepted_at, now())`,
      [ids.parent, studentId, ids.student],
    );
    await c.query(`insert into public.instructor_links (instructor_id, student_id, course_id, role) values ($1, $2, $3, 'owner') on conflict do nothing`, [
      ids.admin,
      studentId,
      enrollment.course_id,
    ]);
    // İlk 'practice' önerisi: onboarding_enroll suggestions.refresh'i zaten kuyruğa attı; sonraki açılışlarda öneri yoksa yeniden.
    let refreshQueued = enrolled;
    if (!enrolled) {
      const sug = await c.query(
        `select 1 from public.suggestions where student_id = $1 and kind = 'practice' and consumed_at is null and (expires_at is null or expires_at > now()) limit 1`,
        [studentId],
      );
      if (!sug.rowCount) {
        await c.query(`select app.try_enqueue('suggestions.refresh', jsonb_build_object('student_id', $1::uuid, 'enrollment_id', $2::uuid, 'reason', 'local_dev'))`, [studentId, enrollment.id]);
        refreshQueued = true;
      }
    }
    await c.query('commit');
    return { created, studentId, enrolled, refreshQueued };
  } catch (err) {
    await c.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

// ------------------------------------------------------------------------------------------------ özet tablosu

function table(rows: [string, string][]): string {
  const w = Math.max(...rows.map(([k]) => k.length));
  const v = Math.max(...rows.map(([, x]) => x.length));
  const line = `+${'-'.repeat(w + 2)}+${'-'.repeat(v + 2)}+`;
  return [line, ...rows.map(([k, x]) => `| ${k.padEnd(w)} | ${x.padEnd(v)} |`), line].join('\n');
}

// ------------------------------------------------------------------------------------------------ ana akış

function usage(): void {
  say('Kullanım:  bun run local            (aç)');
  say('           bun run local:reset      (yerel veritabanını ve yüklenen dosyaları silip baştan kur)');
  say('Ortam: depo kökündeki .env.local (ANTHROPIC_API_KEY; isteğe bağlı GROQ_API_KEY, VOYAGE_API_KEY, OGRENMEN_DATABASE_URL).');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) return usage();
  const unknown = args.filter((a) => a !== '--reset');
  if (unknown.length) throw new SetupError(`Bilinmeyen seçenek: ${unknown.join(' ')}`, ['Kullanım:  bun run local   ya da   bun run local:reset']);
  const reset = args.includes('--reset');

  say('Öğrenmen yerel deneme açılıyor…');
  // bun depo kökündeki .env.local'ı kendisi de yükler; bu okuma başka çalıştırıcılar için güvencedir (kabuk önceliklidir).
  loadEnvFile(ENV_FILE);
  step(fs.existsSync(ENV_FILE) ? '.env.local okundu' : '.env.local yok; yalnız kabuk ortamı kullanılıyor');
  const llm = decideLlm();
  checkTools();
  await checkPorts();
  if (llm === 'gerçek') await verifyAnthropicKey();
  fs.mkdirSync(LOG_DIR, { recursive: true });

  const baseUrl = (process.env.OGRENMEN_DATABASE_URL || DEFAULT_DATABASE_URL).trim();
  if (reset) {
    step(`sıfırlama: ${DB_NAME} veritabanı ve yüklenen dosyalar siliniyor`);
    try {
      await dropDatabaseByName(DB_NAME, baseUrl);
    } catch (err) {
      throw databaseHint(baseUrl, err);
    }
    fs.rmSync(STORAGE_DIR, { recursive: true, force: true });
    fs.rmSync(DERS_DIR, { recursive: true, force: true });
  }
  step(`veritabanı: ${DB_NAME} (ilk kurulum 1–2 dakika sürebilir)`);
  try {
    db = await createDatabase({ name: DB_NAME, persistent: true, baseUrl, content: true, answerKeys: true, skipSeeds: ['00_people.sql'], python: pythonCmd() });
  } catch (err) {
    throw databaseHint(baseUrl, err);
  }
  if (db.created) step('veritabanı kuruldu: göçler + ayarlar + TYT Matematik müfredatı + cevap anahtarları');
  else step(`veritabanı hazır (var olan; ${db.appliedMigrations.length ? `yeni göçler uygulandı: ${db.appliedMigrations.join(', ')}` : 'yeni göç yok'})`);
  if (db.changedMigrations.length) warn(`Şu göçler kurulumdan sonra değişmiş: ${db.changedMigrations.join(', ')}. Sorun görürsen:  bun run local:reset`);
  const coachKey = String((await db.pool.query(`select secret from secure.server_keys where name = 'web_coach'`)).rows[0]?.secret ?? '');
  if (!coachKey) throw new SetupError('Veritabanında koç anahtarı (secure.server_keys web_coach) yok.', ['Baştan kur:  bun run local:reset']);

  const database = db;
  bridge = await startBridge({
    db: database,
    port: PORTS.bridge,
    otp: LOCAL_DEV_OTP,
    jwtSecret: jwtSecret(),
    allowedOrigins: ALLOWED_ORIGINS,
    log: (m) => fs.appendFileSync(path.join(LOG_DIR, 'kopru.log'), `${new Date().toISOString()} ${m}\n`),
    storageDir: STORAGE_DIR,
    keyTtlSec: KEY_TTL,
    keyIssuedAt: KEY_ISSUED_AT,
    info: () => ({ dbName: database.name, web: WEB_URL, mode: 'local' }),
    ready: async () =>
      (await httpOk(`http://127.0.0.1:${PORTS.worker}/healthz`)) && (await httpOk(`http://127.0.0.1:${PORTS.ders}/healthz`)) && (await httpOk(`${WEB_LOCAL}/api/health`)),
  });
  step(`köprü ${BRIDGE_URL}`);

  const llmEnv = llm === 'sahte' ? 'fake' : 'anthropic';
  const sttReal = Boolean(process.env.GROQ_API_KEY);
  fs.mkdirSync(DERS_DIR, { recursive: true });
  startChild('ders', pythonCmd(), ['-I', path.join(REPO_ROOT, 'pipelines/ders/src/ogrenmen_ders/service.py'), '--port', String(PORTS.ders)], REPO_ROOT, {
    OGRENMEN_STT: sttReal ? undefined : 'fake',
    OGRENMEN_STT_FIXTURES: sttReal ? undefined : path.join(REPO_ROOT, 'fixtures', 'ders'),
    OGRENMEN_DERS_WORK_DIR: DERS_DIR,
    OGRENMEN_DERS_QUIET: '1',
    SUPABASE_URL: BRIDGE_URL,
    SUPABASE_SERVICE_ROLE_KEY: bridge.serviceKey,
  });
  // Worker, Supabase'deki gibi migration sahibinin rolüyle bağlanır (yerel eşleniği ogrenmen_owner; pgboss şeması bu role ait).
  startChild('worker', 'node', ['--import', 'tsx', 'src/index.ts'], WORKER_DIR, {
    DATABASE_URL: database.url,
    PGOPTIONS: `-c role=${MIGRATION_ROLE}`,
    WORKER_PROCESS: 'all',
    WORKER_SCHEDULES: 'on',
    HEALTH_HOST: '127.0.0.1',
    HEALTH_PORT: String(PORTS.worker),
    SUPABASE_URL: BRIDGE_URL,
    SUPABASE_SERVICE_ROLE_KEY: bridge.serviceKey,
    OGRENMEN_LLM: llmEnv,
    OGRENMEN_SITE_URL: WEB_URL,
    LESSON_SERVICE_URL: `http://127.0.0.1:${PORTS.ders}`,
    LOG_LEVEL: 'info',
  });
  step('worker ve ders servisi açılıyor');
  await waitFor('Worker', () => httpOk(`http://127.0.0.1:${PORTS.worker}/healthz`), 120_000);
  await waitFor('Ders servisi', () => httpOk(`http://127.0.0.1:${PORTS.ders}/healthz`), 60_000);

  const demo = await ensureDemoAccounts(database);
  step(demo.created.length ? `demo hesaplar kuruldu: ${demo.created.join(', ')}` : 'demo hesaplar hazır');

  startChild('web', 'node', [path.join(WEB_DIR, 'node_modules/next/dist/bin/next'), 'dev', '--webpack', '-p', String(PORTS.web), '-H', '127.0.0.1'], WEB_DIR, {
    NEXT_DIST_DIR: '.next-local',
    NEXT_PUBLIC_SUPABASE_URL: BRIDGE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: bridge.anonKey,
    NEXT_PUBLIC_SITE_URL: WEB_URL,
    NEXT_PUBLIC_LOCAL_DEV: '1',
    NEXT_TELEMETRY_DISABLED: '1',
    OGRENMEN_LLM: llmEnv,
    // Göçün ürettiği koç anahtarı web sunucusunun ortamına kopyalanır (tarayıcıya gitmez; üretimdeki gibi).
    OGRENMEN_WEB_COACH_KEY: coachKey,
  });
  step('web açılıyor (ilk derleme 1–3 dakika sürebilir)');
  await waitFor('Web', () => httpOk(`${WEB_LOCAL}/api/health`), 300_000);
  // Giriş sayfasını önceden derle: ilk tıklama beklemesin.
  await fetch(`${WEB_LOCAL}/giris`, { signal: AbortSignal.timeout(300_000) }).catch(() => undefined);
  if (stopping) return;

  const accounts = LOCAL_DEMO_ACCOUNTS.map((a) => `${a.email} (${a.label})`);
  say();
  say(
    table([
      ['Adres', WEB_URL],
      ['Giriş kodu', `${LOCAL_DEV_OTP} (her hesap için; e-posta gönderilmez)`],
      ['Hesaplar', accounts[0] ?? ''],
      ['', accounts[1] ?? ''],
      ['', accounts[2] ?? ''],
      ['LLM (Claude)', llm === 'gerçek' ? 'gerçek (ANTHROPIC_API_KEY)' : 'sahte (OGRENMEN_LLM=fake; örnek cevaplar)'],
      ['Ders yazıya dökme', sttReal ? 'gerçek (GROQ_API_KEY)' : 'sahte (GROQ_API_KEY yok; örnek transkript)'],
      ['Anlamsal arama', process.env.VOYAGE_API_KEY ? 'açık (VOYAGE_API_KEY)' : 'kapalı (VOYAGE_API_KEY yok)'],
      ['Veritabanı', `${DB_NAME} (Ctrl+C ile silinmez)`],
      ['Günlükler', path.join('.dev-local', 'logs')],
      ['Kapatmak', 'Ctrl+C'],
    ]),
  );
  if (!sttReal) say('Not: ders kaydı yüklersen konuşma gerçekten yazıya dökülmez; yerine örnek bir transkript görünür.');
  if (demo.refreshQueued) say('Not: Elif\'in ilk önerisi hazırlanıyor; Bugün ekranında kart birkaç saniye içinde görünür.');
  say(`Tarayıcıda aç: ${WEB_URL}`);
}

process.on('SIGINT', () => void stop(0));
process.on('SIGTERM', () => void stop(0));
main().catch(async (err: unknown) => {
  if (!stopping) {
    stopping = true;
    for (const c of children.values()) if (c.exitCode === null) c.kill('SIGTERM');
    await bridge?.close().catch(() => undefined);
    await db?.close().catch(() => undefined);
  }
  fail(err);
});
