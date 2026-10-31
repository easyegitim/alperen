// Tasarım sistemi kopyalayıcı (ADR-0008, BLUEPRINT §7 madde 1).
// packages/design-system içinden YALNIZ bundle.js, bundle.css, fontlar, maskot ve easy işaretini public/ds/'e kopyalar.
// React KOPYALANMAZ: bundle.js window.React'i okur; o örneği lib/ds-loader.tsx Next'in kendi react modülünden açar.
// CDN yoktur: her şey yerel dosyadan gelir. Betik idempotenttir (önce public/ds/ temizlenir).
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const PANEL_DIR = join(here, '..');
export const DS_DIR = join(PANEL_DIR, '..', '..', 'packages', 'design-system');
export const OUT_DIR = join(PANEL_DIR, 'public', 'ds');

/** Kopyalanacak dosyalar: [kaynak (design-system'e göre), hedef (public/ds'e göre)] */
export function plan() {
  const files = [
    ['components/bundle.js', 'bundle.js'],
    ['components/bundle.css', 'bundle.css'],
    ['assets/Maskot/ogrenmen-maskot.webp', 'ogrenmen-maskot.webp'],
    ['assets/Logolar/easy-isaret-mor.png', 'easy-isaret-mor.png'],
    ['assets/Logolar/easy-isaret-beyaz.png', 'easy-isaret-beyaz.png'],
  ];
  for (const f of readdirSync(join(DS_DIR, 'fonts')).sort()) {
    if (f.endsWith('.woff2')) files.push([`fonts/${f}`, `fonts/${f}`]);
  }
  return files;
}

export function sync() {
  if (!existsSync(join(DS_DIR, 'components', 'bundle.js'))) {
    throw new Error(`sync-ds: tasarım sistemi bulunamadı: ${DS_DIR}`);
  }
  rmSync(OUT_DIR, { recursive: true, force: true });
  const copied = [];
  for (const [src, dst] of plan()) {
    if (/^react/i.test(basename(dst))) throw new Error(`sync-ds: React kopyası yasak: ${dst}`);
    const to = join(OUT_DIR, dst);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(DS_DIR, src), to);
    copied.push(dst);
  }
  return copied;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const copied = sync();
  console.log(`sync-ds: ${copied.length} dosya public/ds/ altına kopyalandı (React yok, CDN yok).`);
}
