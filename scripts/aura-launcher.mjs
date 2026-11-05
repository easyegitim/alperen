/**
 * Yerel başlatıcıların (Aura-Baslat.command / .bat) ortak yardımcısı. Yalnız yerel test içindir;
 * üretim (Vercel) bunu kullanmaz. Paket kurulumundan önce çalışır: yalnız Node yerleşikleri.
 *
 *   node scripts/aura-launcher.mjs env    # ayar dosyasını bulur → .env.local, test girişi bayrağını açar
 *   node scripts/aura-launcher.mjs port   # 3000'den başlayarak ilk boş portu stdout'a yazar
 *
 * Mesajlar stderr'e gider (pencerede görünür); stdout yalnız port numarasını taşır.
 * Ayar dosyasının içeriği ekrana yazılmaz.
 */
import { copyFileSync, existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const TEST_LOGIN_LINE = "NEXT_PUBLIC_TEST_PASSWORD_LOGIN=true";
export const FIRST_PORT = 3000;
export const LAST_PORT = 3020;

/** "aura-ayarlar.env", "aura-ayarlar (1).env", "aura-ayarlar.env.txt" gibi indirme adlarını tanır. */
export function isSettingsFileName(name) {
  return /^aura-ayarlar.*\.env(\.txt)?$/i.test(name);
}

/**
 * En yeni ayar dosyasını seçer.
 * @param {{ path: string, mtimeMs: number }[]} candidates
 * @returns {string | null}
 */
export function pickNewest(candidates) {
  let best = null;
  for (const c of candidates) if (!best || c.mtimeMs > best.mtimeMs) best = c;
  return best ? best.path : null;
}

/**
 * Test girişi bayrağı açık değilse dosya sonuna ekler. Aynı anahtar daha önce boş ya da "false"
 * olarak geçse bile son satır geçerli olur (dotenv).
 * @param {string} text
 * @returns {string}
 */
export function ensureTestLoginFlag(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const last = [...lines].reverse().find((l) => l.startsWith("NEXT_PUBLIC_TEST_PASSWORD_LOGIN="));
  if (last === TEST_LOGIN_LINE) return text;
  const sep = text.length === 0 || text.endsWith("\n") ? "" : "\n";
  return `${text}${sep}${TEST_LOGIN_LINE}\n`;
}

function listSettingsFiles(dir) {
  if (!existsSync(dir)) return [];
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!isSettingsFileName(name)) continue;
    const path = join(dir, name);
    try {
      const st = statSync(path);
      if (st.isFile()) out.push({ path, mtimeMs: st.mtimeMs });
    } catch {
      // okunamayan dosya atlanır
    }
  }
  return out;
}

function prepareEnv() {
  const candidates = [...listSettingsFiles(process.cwd()), ...listSettingsFiles(join(homedir(), "Downloads"))];
  const source = pickNewest(candidates);
  if (source) {
    copyFileSync(source, ".env.local");
    console.error(`Ayar dosyası kullanıldı: ${source}`);
  }
  if (!existsSync(".env.local")) {
    console.error("Ayar dosyası bulunamadı. 'aura-ayarlar.env' dosyasını bu klasöre koy ve yeniden çift tıkla.");
    return 1;
  }
  const text = readFileSync(".env.local", "utf8");
  const next = ensureTestLoginFlag(text);
  if (next !== text) writeFileSync(".env.local", next);
  console.error("Test girişi açık.");
  return 0;
}

function portFree(port) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port);
  });
}

async function findPort() {
  for (let p = FIRST_PORT; p <= LAST_PORT; p++) {
    if (await portFree(p)) {
      if (p !== FIRST_PORT) console.error(`Eski bir Aura penceresi açık görünüyor (port ${FIRST_PORT} dolu). Onu kapatabilirsin; bu sefer ${p} kullanılıyor.`);
      process.stdout.write(`${p}\n`);
      return 0;
    }
  }
  console.error(`Boş port bulunamadı (${FIRST_PORT}-${LAST_PORT}). Açık Aura pencerelerini kapatıp yeniden dene.`);
  return 1;
}

// Klasör yolu bir bağlantıdan (junction/symlink) geçse de doğru çalışsın diye gerçek yollar karşılaştırılır.
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}
const isMain = isMainModule();
if (isMain) {
  const cmd = process.argv[2];
  if (cmd === "env") process.exitCode = prepareEnv();
  else if (cmd === "port") process.exitCode = await findPort();
  else {
    console.error("Kullanım: node scripts/aura-launcher.mjs env|port");
    process.exitCode = 1;
  }
}
