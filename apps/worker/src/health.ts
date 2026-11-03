/** /healthz: yalnız node:http. Fly sağlık denetimi ve kapanış sırasında trafik kesme için. */
import { createServer, type Server } from 'node:http';

export interface HealthReport {
  ok: boolean;
  /** Ek bilgi (sır yok). */
  details: Record<string, unknown>;
}

export interface HealthServer {
  /** Dinlemeye başlar; gerçek portu döner (port 0 verildiyse atanan). */
  listen(): Promise<number>;
  close(): Promise<void>;
}

export function createHealthServer(opts: { host: string; port: number; check: () => Promise<HealthReport> | HealthReport }): HealthServer {
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if ((req.method !== 'GET' && req.method !== 'HEAD') || path !== '/healthz') {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'bulunamadı' }));
      return;
    }
    Promise.resolve()
      .then(() => opts.check())
      .catch((err: unknown): HealthReport => ({ ok: false, details: { error: (err as Error).message } }))
      .then((r) => {
        res.writeHead(r.ok ? 200 : 503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ status: r.ok ? 'ok' : 'unhealthy', ...r.details }));
      });
  });
  server.keepAliveTimeout = 5_000;

  return {
    listen: () =>
      new Promise<number>((resolve, reject) => {
        server.once('error', reject);
        server.listen(opts.port, opts.host, () => {
          server.off('error', reject);
          const addr = server.address();
          resolve(typeof addr === 'object' && addr ? addr.port : opts.port);
        });
      }),
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
