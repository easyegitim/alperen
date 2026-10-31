/** Saatlik: `storage_deletions` kuyruğu → Storage API silme (bot_runtime JWT); sonuç `done_at`/`error`. */
import type { Services } from '../services.ts';
import { bestEffort } from '../ops/log.ts';

export async function runStorageDeletions(s: Services, limit = 50): Promise<number> {
  const rows = await s.db.pendingStorageDeletions(limit);
  let done = 0;
  for (const r of rows) {
    try {
      await s.deps.storage.remove(r.bucket, r.path);
      await s.db.markStorageDeletion(r.id, s.now().toISOString(), null);
      done++;
    } catch (err) {
      // Hata metni yazımı en iyi çabadır (§3.8 yalnız done_at verir; README not 11); satır kuyrukta kalır.
      const message = (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 200);
      await bestEffort('storage_deletion_mark_failed', s.db.markStorageDeletion(r.id, s.now().toISOString(), message));
    }
  }
  return done;
}
