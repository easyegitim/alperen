/** Giriş noktası: `node --import tsx src/index.ts [--process=worker|pdf|all]`. */
import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { createLogger, errorFields } from './log.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger(config.logLevel, { process: config.process });
  const app = createApp(config, { log });

  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info('sinyal alındı', { signal });
    // Süre dolarsa zorla çık (Fly kill_timeout'tan kısa tutulur).
    const force = setTimeout(() => process.exit(1), config.shutdownTimeoutMs + 5_000);
    force.unref();
    app.stop().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => log.error('işlenmeyen söz reddi', errorFields(err)));

  await app.start();
}

main().catch((err: unknown) => {
  const msg = err instanceof ConfigError ? `yapılandırma hatası: ${err.message}` : `açılış hatası: ${(err as Error).message}`;
  process.stderr.write(JSON.stringify({ t: new Date().toISOString(), level: 'error', msg, ...errorFields(err) }) + '\n');
  process.exit(1);
});
