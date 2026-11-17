/**
 * Yerel deneme sağlık kontrolü:  bun run doctor
 *
 * Gerekenleri tek tek kontrol eder, Türkçe rapor yazar (✓ tamam, ! uyarı, ✕ eksik) ve eksik olanın nasıl
 * düzeltileceğini söyler. Zorunlu bir şey eksikse çıkış kodu 1, yoksa 0. Anahtarın değeri ASLA yazdırılmaz.
 * up.ts'e dokunmaz; yalnız okur ve /v1/models'e tek küçük istek atar.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type Level = 'ok' | 'warn' | 'fail';
export interface CheckResult {
  name: string;
  level: Level;
  detail: string;
  /** Yapılacak şey (komutlar); level ok ise boş. */
  fix?: string[];
}

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const DEFAULT_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';

// ------------------------------------------------------------------------------------------ saf yardımcılar

/** "v22.3.1" / "1.4.2" / "Python 3.13.0" gibi metinden [major, minor] çıkarır. */
export function parseVersion(text: string): [number, number] | null {
  const m = /(\d+)\.(\d+)/.exec(text) ?? /(\d+)/.exec(text);
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0)];
}

export function versionAtLeast(text: string, min: [number, number]): boolean {
  const v = parseVersion(text);
  if (!v) return false;
  return v[0] > min[0] || (v[0] === min[0] && v[1] >= min[1]);
}

/** Anahtarı açığa vurmadan tarif eder: boş mu, kaç karakter, "sk-ant-" ile başlıyor mu. */
export function describeKey(raw: string | undefined): { present: boolean; length: number; prefixOk: boolean } {
  const key = (raw ?? '').trim();
  return { present: key.length > 0, length: key.length, prefixOk: key.startsWith('sk-ant-') };
}

/** Worker'ın Python'ı (apps/worker: OGRENMEN_PYTHON ya da python3); paket kontrolü aynı yorumlayıcıyla yapılır. */
export function pythonCmd(): string {
  return (process.env.OGRENMEN_PYTHON ?? '').trim() || 'python3';
}

/**
 * Worker Python'ı `-I` (yalıtılmış kip) ile çalıştırır: kullanıcı site-packages'ı (`pip install --user`, ~/.local,
 * ~/Library/Python) görülmez. Kontrol de `-I` ile yapılır; kurulum komutları paketleri sistem site-packages'ına koyar.
 */
export const PYTHON_PACKAGES_CHECK = ['-I', '-c', 'import sympy, matplotlib, numpy'];
export const PYTHON_PACKAGES_FIX = [
  'macOS (Homebrew Python):  python3 -m pip install --break-system-packages sympy matplotlib numpy',
  'Ubuntu / Windows (WSL):  sudo apt install -y python3-sympy python3-matplotlib python3-numpy',
  'Not: "pip install --user" ile kurulan paketler görülmez (uygulama Python\'ı yalıtılmış kipte çalıştırır).',
];

/** /v1/models yanıt durumunu Türkçe yoruma çevirir. status: HTTP kodu ya da ağ hatası için null; body: yanıt metni. */
export function classifyAnthropicStatus(status: number | null, body = ''): CheckResult {
  const name = 'Anthropic anahtarı çalışıyor mu';
  if (status === 200) return { name, level: 'ok', detail: 'Anthropic anahtarı kabul etti (200).' };
  if (status === 402 || /credit balance|billing/i.test(body)) {
    return {
      name,
      level: 'warn',
      detail: `Anthropic hesabında kredi yok ya da ödeme sorunu var${status ? ` (${status})` : ''}: Claude istekleri hata verir.`,
      fix: ['console.anthropic.com → Billing bölümünden kredi yükle (aylık harcama limiti koyman önerilir).'],
    };
  }
  if (status === 401 || status === 403) {
    return {
      name,
      level: 'fail',
      detail: `Anthropic anahtarı reddetti (${status}): anahtar yanlış, silinmiş ya da eksik kopyalanmış.`,
      fix: ['console.anthropic.com → API Keys bölümünden yeni anahtar oluştur,', '.env.local içindeki ANTHROPIC_API_KEY= satırına yapıştır (tırnak ve boşluk olmadan).'],
    };
  }
  if (status === 429) {
    return { name, level: 'warn', detail: 'Anthropic çok sık istek uyarısı verdi (429); anahtar geçerli görünüyor. Birkaç dakika sonra tekrar dene.' };
  }
  if (status === null) {
    return {
      name,
      level: 'warn',
      detail: 'Anthropic\'e ulaşılamadı (ağ hatası): anahtar sınanamadı.',
      fix: ['İnternet bağlantını kontrol et. Şirket/okul ağında ya da VPN\'deyken api.anthropic.com engelli olabilir.'],
    };
  }
  return { name, level: 'warn', detail: `Anthropic beklenmedik yanıt verdi (${status}); biraz sonra tekrar dene.` };
}

/** Anahtarı /v1/models'e tek küçük istekle sınar (ücretsiz). Anahtar hiçbir yere yazılmaz. Ağ hatasında status null. */
export async function probeAnthropic(key: string): Promise<{ status: number | null; body: string }> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=1', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(10_000),
    });
    const body = res.ok ? '' : (await res.text().catch(() => '')).slice(0, 2_000);
    return { status: res.status, body };
  } catch {
    return { status: null, body: '' };
  }
}

const MARK: Record<Level, string> = { ok: '✓', warn: '!', fail: '✕' };

/** Raporu metne çevirir; çıkış kodunu da hesaplar (zorunlu eksik = 1). */
export function formatReport(results: CheckResult[]): { text: string; exitCode: number } {
  const lines: string[] = ['Öğrenmen yerel deneme kontrolü', ''];
  for (const r of results) {
    lines.push(`${MARK[r.level]} ${r.name}: ${r.detail}`);
    for (const f of r.fix ?? []) lines.push(`    ${f}`);
  }
  const fails = results.filter((r) => r.level === 'fail').length;
  const warns = results.filter((r) => r.level === 'warn').length;
  lines.push('');
  if (fails > 0) {
    lines.push(`Sonuç: ${fails} zorunlu eksik var (✕). Yukarıdaki komutları uygula, sonra  bun run doctor  komutunu tekrar çalıştır.`);
  } else if (warns > 0) {
    lines.push(`Sonuç: hazır. ${warns} uyarı (!) var; bazı özellikler çalışmayabilir ama  bun run local  ile açabilirsin.`);
  } else {
    lines.push('Sonuç: her şey hazır. Şimdi:  bun run local');
  }
  return { text: lines.join('\n'), exitCode: fails > 0 ? 1 : 0 };
}

/** Bağlantı adresindeki parolayı gizler. */
export function maskUrl(url: string): string {
  return url.replace(/:\/\/([^:@/]+):[^@/]*@/, '://$1:***@');
}

// ------------------------------------------------------------------------------------------ kontroller

function run(cmd: string, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 15_000 });
  return { ok: r.status === 0 && !r.error, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

function checkBun(): CheckResult {
  const v = run('bun', ['--version']).out;
  if (versionAtLeast(v, [1, 4])) return { name: 'bun', level: 'ok', detail: `${v} (en az 1.4 gerekir)` };
  return {
    name: 'bun',
    level: 'fail',
    detail: `${v || 'bulunamadı'}; en az 1.4 gerekir.`,
    fix: [
      'macOS:  brew install oven-sh/bun/bun',
      'Güncelle:  bun upgrade',
      'Ubuntu / Windows (WSL):  sudo apt install -y unzip && curl -fsSL https://bun.sh/install | bash   (sonra terminali kapatıp aç)',
    ],
  };
}

function checkNode(): CheckResult {
  const r = run('node', ['--version']);
  if (r.ok && versionAtLeast(r.out, [22, 0])) return { name: 'node', level: 'ok', detail: `${r.out} (en az 22 gerekir)` };
  return {
    name: 'node',
    level: 'fail',
    detail: r.ok ? `${r.out}; en az 22 gerekir.` : 'bulunamadı.',
    fix: [
      'macOS:  brew install node   (güncel sürüm, 22 ya da üstü; terminali kapatıp aç)',
      'Ubuntu / Windows (WSL):  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs',
    ],
  };
}

function checkPython(): CheckResult[] {
  const python = pythonCmd();
  const py = run(python, ['--version']);
  if (!py.ok) {
    return [
      {
        name: python,
        level: 'fail',
        detail: 'bulunamadı.',
        fix: python === 'python3' ? ['macOS:  brew install python', 'Ubuntu / Windows (WSL):  sudo apt install -y python3'] : ['.env.local içindeki OGRENMEN_PYTHON yolunu kontrol et ya da satırı sil.'],
      },
    ];
  }
  const out: CheckResult[] = [{ name: python, level: 'ok', detail: py.out }];
  const missing: string[] = [];
  for (const mod of ['sympy', 'matplotlib', 'numpy']) {
    // Worker'la aynı kip (-I): kullanıcı site-packages'ı sayılmaz.
    if (!run(python, ['-I', '-c', `import ${mod}`]).ok) missing.push(mod);
  }
  if (missing.length === 0) out.push({ name: 'Python paketleri', level: 'ok', detail: 'sympy, matplotlib, numpy kurulu.' });
  else {
    out.push({
      name: 'Python paketleri',
      level: 'fail',
      detail: `eksik: ${missing.join(', ')} (soru doğrulama ve şekiller bunlarla yapılır).`,
      fix: PYTHON_PACKAGES_FIX,
    });
  }
  return out;
}

function checkFfmpeg(): CheckResult {
  if (run('ffmpeg', ['-version']).ok) return { name: 'ffmpeg', level: 'ok', detail: 'kurulu (ders kaydı yükleme için).' };
  return {
    name: 'ffmpeg',
    level: 'warn',
    detail: 'bulunamadı. Yalnız ders kaydı yüklemek için gerekir; diğer her şey çalışır.',
    fix: ['macOS:  brew install ffmpeg', 'Ubuntu / Windows (WSL):  sudo apt install -y ffmpeg'],
  };
}

function checkChromium(): CheckResult {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
    path.join(os.homedir(), '.cache', 'ms-playwright'),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'ms-playwright') : undefined,
  ].filter((x): x is string => !!x && x !== '0');
  for (const root of roots) {
    try {
      if (fs.readdirSync(root).some((d) => d.startsWith('chromium'))) return { name: 'Playwright Chromium', level: 'ok', detail: `kurulu (${root}); PDF raporları için.` };
    } catch {
      /* dizin yok */
    }
  }
  return {
    name: 'Playwright Chromium',
    level: 'warn',
    detail: 'bulunamadı. PDF üretimi (not, deneme raporu) için gerekir; ekranda görünen her şey çalışır.',
    fix: ['macOS:  bunx playwright@1.56.1 install chromium', 'Ubuntu / Windows (WSL):  bunx playwright@1.56.1 install --with-deps chromium   (sistem kütüphanelerini de kurar; parola sorabilir)'],
  };
}

function checkPsql(): CheckResult {
  const r = run('psql', ['--version']);
  if (r.ok) return { name: 'psql', level: 'ok', detail: r.out };
  return {
    name: 'psql (Postgres istemcisi)',
    level: 'fail',
    detail: 'bulunamadı; ilk kurulumda cevap anahtarları onunla yüklenir.',
    fix: ['macOS:  brew install libpq && brew link --force libpq', 'Ubuntu / Windows (WSL):  sudo apt install -y postgresql-client'],
  };
}

function checkDatabase(): CheckResult[] {
  const url = (process.env.OGRENMEN_DATABASE_URL || DEFAULT_DATABASE_URL).trim();
  const shown = maskUrl(url);
  const q = run('psql', [url, '-X', '-A', '-t', '-c', "select count(*) from pg_available_extensions where name='vector'"]);
  if (!q.ok) {
    const refused = /connection refused|could not connect|Connection refused/i.test(q.out);
    const auth = /password authentication failed/i.test(q.out);
    const noPsql = /ENOENT|not found/i.test(q.out) || q.out === '';
    return [
      {
        name: 'Postgres erişimi',
        level: 'fail',
        detail: auth ? `kullanıcı adı ya da parola yanlış (${shown}).` : refused ? `bağlanılamadı (${shown}); veritabanı açık değil.` : noPsql ? `denenemedi (${shown}); psql çalışmadı.` : `bağlanılamadı (${shown}).`,
        fix: auth
          ? ['.env.local içindeki OGRENMEN_DATABASE_URL değerini kontrol et.']
          : ['Docker Desktop\'ı aç, sonra depo kökünde:  make local-db', 'Kendi Postgres 16 + pgvector\'ünü kullanıyorsan adresini .env.local\'a OGRENMEN_DATABASE_URL= olarak yaz.'],
      },
    ];
  }
  const out: CheckResult[] = [{ name: 'Postgres erişimi', level: 'ok', detail: `bağlanıldı (${shown}).` }];
  if (q.out.split('\n').pop()?.trim() === '1') out.push({ name: 'pgvector uzantısı', level: 'ok', detail: 'sunucuda mevcut.' });
  else {
    out.push({
      name: 'pgvector uzantısı',
      level: 'fail',
      detail: 'bu Postgres sunucusunda yok (pg_available_extensions içinde "vector" bulunamadı).',
      fix: ['En kolayı Docker ile açmak:  make local-db   (pgvector hazır gelir)', 'Kendi Postgres\'inde:  brew install pgvector  ve Postgres\'i yeniden başlat.'],
    });
  }
  return out;
}

function checkEnvFile(): CheckResult {
  if (fs.existsSync(path.join(REPO_ROOT, '.env.local'))) return { name: '.env.local', level: 'ok', detail: 'var.' };
  return {
    name: '.env.local',
    level: 'fail',
    detail: 'yok. Anahtarlar bu dosyadan okunur.',
    fix: ['cp .env.local.example .env.local', 'Sonra dosyayı bir metin düzenleyiciyle aç ve ANTHROPIC_API_KEY= satırını doldur.'],
  };
}

async function checkAnthropic(): Promise<CheckResult[]> {
  if (process.env.OGRENMEN_LLM === 'fake') {
    return [{ name: 'ANTHROPIC_API_KEY', level: 'warn', detail: 'OGRENMEN_LLM=fake açık: sahte (örnek) cevaplarla çalışır, gerçek Claude kullanılmaz.' }];
  }
  const key = (process.env.ANTHROPIC_API_KEY ?? '').trim();
  const d = describeKey(key);
  if (!d.present) {
    return [
      {
        name: 'ANTHROPIC_API_KEY',
        level: 'fail',
        detail: 'boş.',
        fix: ['console.anthropic.com → API Keys bölümünden anahtar al,', '.env.local içindeki ANTHROPIC_API_KEY= satırına yapıştır. Anahtarı kimseyle (sohbet dahil) paylaşma.'],
      },
    ];
  }
  const out: CheckResult[] = [];
  if (d.prefixOk) out.push({ name: 'ANTHROPIC_API_KEY', level: 'ok', detail: `dolu (${d.length} karakter, "sk-ant-" ile başlıyor).` });
  else {
    out.push({
      name: 'ANTHROPIC_API_KEY',
      level: 'warn',
      detail: `dolu (${d.length} karakter) ama "sk-ant-" ile başlamıyor; yanlış kopyalanmış olabilir.`,
      fix: ['Anahtarı Console\'dan yeniden kopyala; başında/sonunda boşluk ya da tırnak olmasın.'],
    });
  }
  const probe = await probeAnthropic(key);
  out.push(classifyAnthropicStatus(probe.status, probe.body));
  return out;
}

function checkOptionalKeys(): CheckResult[] {
  const out: CheckResult[] = [];
  out.push(
    (process.env.GROQ_API_KEY ?? '').trim()
      ? { name: 'GROQ_API_KEY', level: 'ok', detail: 'dolu (ders kaydı yazıya dökme için).' }
      : { name: 'GROQ_API_KEY', level: 'warn', detail: 'boş: ders kaydı yazıya dökme sahte (örnek) çıktıyla çalışır. İsteğe bağlı.' },
  );
  out.push(
    (process.env.VOYAGE_API_KEY ?? '').trim()
      ? { name: 'VOYAGE_API_KEY', level: 'ok', detail: 'dolu (anlamsal arama için).' }
      : { name: 'VOYAGE_API_KEY', level: 'warn', detail: 'boş: anlamsal arama kapalı kalır. İsteğe bağlı.' },
  );
  return out;
}

export async function collect(): Promise<CheckResult[]> {
  return [
    checkBun(),
    checkNode(),
    ...checkPython(),
    checkFfmpeg(),
    checkChromium(),
    checkPsql(),
    ...checkDatabase(),
    checkEnvFile(),
    ...(await checkAnthropic()),
    ...checkOptionalKeys(),
  ];
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const { text, exitCode } = formatReport(await collect());
  process.stdout.write(`${text}\n`);
  process.exit(exitCode);
}
