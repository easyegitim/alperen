// Çevrimdışı cevap kuyruğu (saf; depolama ve gönderici dışarıdan verilir). Her cevap hemen kuyruğa yazılır (localStorage)
// ve gönderilir; ağ yoksa kuyrukta kalır, bağlantı gelince ya da bir sonraki denemede tekrar gönderilir. Soru başına yalnız
// son anlık görüntü tutulur (cevabın tamamı; RPC null cevabı temizleme sayar), sıra soruların ilk yazılış sırasıdır.
import type { ResponseSnapshot } from './rpc';

export interface QueueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type SendOutcome = { kind: 'ok' } | { kind: 'retry' } | { kind: 'closed' };
export type Sender = (snap: ResponseSnapshot) => Promise<SendOutcome>;

export const queueKey = (sessionId: string): string => `ogrenmen.exam.queue.${sessionId}`;

function isSnapshot(v: unknown): v is ResponseSnapshot {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.questionId === 'string' &&
    (s.answer === null || typeof s.answer === 'string') &&
    typeof s.flagged === 'boolean' &&
    (s.timeSpentSec === null || typeof s.timeSpentSec === 'number') &&
    (s.workUploadIds === undefined || (Array.isArray(s.workUploadIds) && s.workUploadIds.every((x) => typeof x === 'string')))
  );
}

/** Depodan okur; bozuk ya da erişilemeyen depo boş kuyruk sayılır. */
export function loadQueue(storage: QueueStorage | null, sessionId: string): ResponseSnapshot[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(queueKey(sessionId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isSnapshot) : [];
  } catch {
    return [];
  }
}

export class ResponseQueue {
  private items: ResponseSnapshot[];
  private flushing: Promise<boolean> | null = null;
  private running = false;
  private closedFlag = false;

  constructor(
    private readonly sessionId: string,
    private readonly storage: QueueStorage | null,
    private readonly send: Sender,
    private readonly onChange?: (pending: number) => void,
  ) {
    this.items = loadQueue(storage, sessionId);
  }

  get pending(): number {
    return this.items.length;
  }

  /** Oturum kapandı (süre doldu ya da bitti): kuyruk boşaltıldı, yeni yazım yok sayılır. */
  get closed(): boolean {
    return this.closedFlag;
  }

  snapshots(): ResponseSnapshot[] {
    return this.items.map((s) => ({ ...s }));
  }

  private persist(): void {
    try {
      if (!this.storage) return;
      if (this.items.length === 0) this.storage.removeItem(queueKey(this.sessionId));
      else this.storage.setItem(queueKey(this.sessionId), JSON.stringify(this.items));
    } catch {
      /* depo dolu ya da kapalı: kuyruk bellekte kalır */
    }
    this.onChange?.(this.items.length);
  }

  enqueue(snap: ResponseSnapshot): void {
    if (this.closedFlag) return;
    const at = this.items.findIndex((s) => s.questionId === snap.questionId);
    if (at === -1) this.items.push({ ...snap });
    else {
      const prev = this.items[at]!;
      this.items[at] = { ...snap, workUploadIds: snap.workUploadIds ?? prev.workUploadIds };
    }
    this.persist();
  }

  /**
   * Kuyruğu sırayla gönderir. Tümü gittiyse true; ağ hatasında durur (false, kalanlar saklı). Gönderim sırasında gelen
   * yeni anlık görüntü aynı soruyu ezerse yeniden gönderilir (eski değer silinmez). Eşzamanlı çağrılar tek akışta birleşir.
   */
  flush(): Promise<boolean> {
    // yalnız döngü sürerken birleşir (bitmiş ama henüz temizlenmemiş bir söz yeni öğeleri gönderilmemiş bırakırdı)
    if (this.running && this.flushing) return this.flushing;
    this.flushing = this.loop();
    return this.flushing;
  }

  private async loop(): Promise<boolean> {
    // running bayrağı döngü bittiği anda (aynı eşzamanlı adımda) düşer: ardından gelen flush yeni bir döngü açar
    this.running = true;
    try {
      while (this.items.length > 0) {
        const head = this.items[0]!;
        const outcome = await this.send({ ...head });
        if (outcome.kind === 'retry') return false;
        if (outcome.kind === 'closed') {
          this.closedFlag = true;
          this.items = [];
          this.persist();
          return true;
        }
        // başarı: baş öğe aynı kaldıysa çıkar; gönderim sırasında güncellendiyse sonda yeniden gönderilir
        if (this.items[0] === head) this.items.shift();
        else {
          const at = this.items.indexOf(head);
          if (at !== -1) this.items.splice(at, 1);
        }
        this.persist();
      }
      return true;
    } finally {
      this.running = false;
    }
  }
}
