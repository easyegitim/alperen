// out/ dizinini yerelde sunar (pilotta kurucu makinesinde `bun run start`; §12 #33). Ağ ve bağımlılık yok.
// /dersler → out/dersler.html; bilinmeyen yol → out/404.html. Varsayılan port 3000 (PORT ile değişir).
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(fileURLToPath(new URL('..', import.meta.url)), 'out');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

export function resolvePath(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const candidates = clean === '/' ? ['index.html'] : [clean, `${clean}.html`, join(clean, 'index.html')];
  for (const c of candidates) {
    const p = join(OUT, c);
    if (p.startsWith(OUT) && existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!existsSync(join(OUT, 'index.html'))) {
    console.error('serve-out: önce `bun run build` çalıştır (out/index.html yok).');
    process.exit(1);
  }
  const port = Number(process.env.PORT ?? 3000);
  createServer((req, res) => {
    const file = resolvePath(req.url ?? '/');
    const target = file ?? join(OUT, '404.html');
    res.writeHead(file ? 200 : 404, { 'Content-Type': TYPES[extname(target)] ?? 'application/octet-stream' });
    createReadStream(target).pipe(res);
  }).listen(port, () => console.log(`serve-out: http://localhost:${port}`));
}
