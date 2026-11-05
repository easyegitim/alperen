import type { z } from 'zod';
import type { Gateway } from '@ogrenmen/llm';
import type { WorkerConfig, WorkerProcess } from '../config.js';
import type { Db } from '../db.js';
import type { Logger } from '../log.js';
import type { OutboxDrainResult } from '../outbox.js';
import type { PdfRendererLike } from '../pdf/render.js';
import type { PushSender } from '../push.js';
import type { StorageLike } from '../storage.js';

/** İşlerin kullandığı bağımlılıklar. Testlerde sahtesi verilir; üretimde `app.ts` kurar. */
export interface JobDeps {
  config: WorkerConfig;
  log: Logger;
  db: Db;
  /** Geçit tembel kurulur (anahtar yoksa yalnız LLM işleri düşer). */
  gateway(): Promise<Gateway>;
  /** Supabase Storage; anahtarlar yoksa çağrı `PermanentJobError` fırlatır. */
  storage(): StorageLike;
  pdf: PdfRendererLike;
  push: PushSender;
  /** Bu işin ürettiği yeni işler (zincirleme). Tekilleştirme için `dedupe.ts` (debounced / oncePer) kullanılır. */
  enqueue(name: string, data: object, opts?: EnqueueOptions): Promise<string | null>;
  now(): Date;
  /** secure.job_outbox → pg-boss aktarımı (`outbox.drain`); outbox yoksa ya da süreç aktarmıyorsa tanımsız. */
  drainOutbox?(): Promise<OutboxDrainResult>;
}

/**
 * İş ekleme seçenekleri. Kuyruklar pg-boss `standard` politikasıyla açılır; orada `singletonKey` TEK BAŞINA hiçbir
 * işi düşürmez: tekilleştirme `singletonSeconds` ile olur (aynı ad + anahtar + zaman dilimi tek iş, pg-boss job_i4).
 * `debounce`: dilim doluysa iş bir sonraki dilimin başına ertelenir (o da doluysa düşer; bekleyen iş zaten
 * en yeni veriyi görür). stately/short politikası kullanılmaz: SQL `enqueue_job` anahtarsız iş ekler ve bu
 * politikalarda anahtarsız işler (tüm öğrenciler) tek iş sayılırdı.
 */
export interface EnqueueOptions {
  startAfter?: number | Date;
  singletonKey?: string;
  /** Tekilleştirme dilimi (sn); singletonKey ile birlikte verilir. */
  singletonSeconds?: number;
  /** true: dilim doluysa bir sonraki dilime ertele (pg-boss singletonNextSlot). */
  debounce?: boolean;
}

export interface JobInfo {
  id: string;
  name: string;
  retryCount: number;
}

export interface JobContext extends JobDeps {
  job: JobInfo;
  /** Süre dolunca ya da kapanışta iptal edilir. */
  signal: AbortSignal;
}

/** pg-boss kuyruk seçenekleri (yalnız kullandıklarımız). */
export interface QueuePolicy {
  /** Kaç kez yeniden denenir (ilk deneme hariç). */
  retryLimit: number;
  /** İlk bekleme (sn). */
  retryDelay: number;
  retryBackoff: boolean;
  /** Üstel bekleme tavanı (sn). */
  retryDelayMax?: number;
  /** Bir deneme en çok bu kadar sürer (sn). */
  expireInSeconds: number;
  /** Tamamlanan işin saklama süresi (sn). */
  deleteAfterSeconds?: number;
  /** Bekleyen (created/retry) işin silinmeden önce bekleyebileceği süre (sn); verilmezse pg-boss varsayılanı (14 gün). */
  retentionSeconds?: number;
}

export interface JobDefinition<P = unknown, R = unknown> {
  /** Kuyruk / iş adı (`modül.eylem`). SQL tarafı (`enqueue_job`) aynı adı kullanır. */
  name: string;
  description: string;
  /** Bu işi hangi süreç çalıştırır. */
  process: Exclude<WorkerProcess, 'all'>;
  /** Yük şeması; geçersiz yük yeniden denenmez (dead_letter). */
  payload: z.ZodType<P, unknown>;
  /** Aynı süreçte eşzamanlı çalışan sayısı. */
  concurrency: number | ((c: WorkerConfig) => number);
  retry: QueuePolicy;
  /** null: yalnız kuyruk açılır (iş eklenebilir, işleyici P1+'da gelir; iş kuyruğun retentionSeconds süresi kadar bekler, sonra silinir). */
  handler: ((payload: P, ctx: JobContext) => Promise<R>) | null;
  /** Gerçek mantığı henüz yok. */
  skeleton?: boolean;
}

export type AnyJobDefinition = JobDefinition<any, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
