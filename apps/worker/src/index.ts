/** Giriş noktası: `node --import tsx src/index.ts [--process=worker|pdf|all]`. */
import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { createLogger, errorFields } from './log.js';
import { StartupCheckError, STARTUP_EXIT_CODE } from './startup-checks.js';

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

  try {
    await app.start();
  } catch (err) {
    if (!(err instanceof StartupCheckError)) throw err;
    // Açık hata + sağlık 'degraded' (kısa süre görünür), sonra 78 (EX_CONFIG) ile çık.
    log.error('başlangıç denetimi düştü; çıkılıyor', { exitCode: STARTUP_EXIT_CODE, checks: err.report.checks });
    process.stderr.write(`HATA: ${err.message}\n`);
    await new Promise((r) => setTimeout(r, config.startupExitDelayMs));
    await app.stop().catch(() => undefined);
    process.exit(STARTUP_EXIT_CODE);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof ConfigError ? `yapılandırma hatası: ${err.message}` : `açılış hatası: ${(err as Error).message}`;
  process.stderr.write(JSON.stringify({ t: new Date().toISOString(), level: 'error', msg, ...errorFields(err) }) + '\n');
  process.exit(1);
});
