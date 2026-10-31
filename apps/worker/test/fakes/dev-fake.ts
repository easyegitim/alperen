/**
 * `bun run dev:fake`: sahte Bot API (8788) + `wrangler dev --local` (8787, sahte giriş). Hesap yok.
 *   curl -X POST localhost:8788/sendUpdate -d @../../fixtures/telegram/private_text.json
 *   curl localhost:8788/outbox
 * Ctrl-C ikisini de kapatır.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const server = spawn(process.execPath, ['test/fakes/telegram-server.ts', '--port', '8788', '--worker', 'http://localhost:8787'], { cwd: root, stdio: 'inherit' });
const worker = spawn('node_modules/.bin/wrangler', ['dev', '--local', '--port', '8787', '--config', 'test/fakes/wrangler.dev.toml'], { cwd: root, stdio: 'inherit' });

const stop = (): void => {
  server.kill();
  worker.kill();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
await Promise.race([new Promise((r) => server.on('exit', r)), new Promise((r) => worker.on('exit', r))]);
stop();
