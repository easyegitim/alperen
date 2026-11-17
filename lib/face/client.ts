"use client";

// Worker'ı saran Promise API (SPEC Faz 4 madde 3). Tek örnek; sayfalar arasında paylaşılır.
import type { Protect } from "@/content/types";
import type { DriftPolicy } from "@/lib/tryon/composite";
import type { FrameAnalysis, Point, SegmentationResult } from "./types";
import type { InitResult, TryonWorkerResult, WorkerRequest, WorkerResponse } from "./vision.worker";

export const MEDIAPIPE_BASE_PATH = "/mediapipe";

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

export class VisionClient {
  private static instance: VisionClient | null = null;
  private worker: Worker | null = null;
  private pending = new Map<number, Pending>();
  private seq = 0;
  private initPromise: Promise<InitResult> | null = null;

  static get(): VisionClient {
    if (!VisionClient.instance) VisionClient.instance = new VisionClient();
    return VisionClient.instance;
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("./vision.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.result);
      else p.reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || "worker_crashed"));
      this.pending.clear();
      this.initPromise = null;
    };
    this.worker = worker;
    return worker;
  }

  private send<T>(msg: WorkerRequest, transfer: Transferable[] = []): Promise<T> {
    const worker = this.ensureWorker();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(msg.id, { resolve: resolve as (v: unknown) => void, reject });
      worker.postMessage(msg, transfer);
    });
  }

  private nextId() {
    return ++this.seq;
  }

  /** Modelleri yükler; tekrar çağrılırsa aynı sözü döndürür. */
  init(basePath = MEDIAPIPE_BASE_PATH): Promise<InitResult> {
    if (!this.initPromise) {
      this.initPromise = this.send<InitResult>({ type: "init", id: this.nextId(), basePath }).catch((e) => {
        this.initPromise = null;
        throw e;
      });
    }
    return this.initPromise;
  }

  get ready(): boolean {
    return this.initPromise !== null;
  }

  /** bitmap worker'a devredilir ve orada kapatılır. */
  detectVideo(bitmap: ImageBitmap, timestamp: number): Promise<FrameAnalysis> {
    return this.send<FrameAnalysis>({ type: "detectVideo", id: this.nextId(), bitmap, timestamp }, [bitmap]);
  }

  detectImage(bitmap: ImageBitmap): Promise<FrameAnalysis> {
    return this.send<FrameAnalysis>({ type: "detectImage", id: this.nextId(), bitmap }, [bitmap]);
  }

  segment(bitmap: ImageBitmap): Promise<SegmentationResult | null> {
    return this.send<SegmentationResult | null>({ type: "segment", id: this.nextId(), bitmap }, [bitmap]);
  }

  /** c ve g worker'a devredilir ve orada kapatılır; başarıda kompozit bitmap geri devredilir. */
  tryon(c: ImageBitmap, g: ImageBitmap, landmarksC: Point[], protect: Protect, policy: DriftPolicy, glowUp = false): Promise<TryonWorkerResult> {
    return this.send<TryonWorkerResult>({ type: "tryon", id: this.nextId(), c, g, landmarksC, protect, policy, glowUp }, [c, g]);
  }

  async terminate() {
    if (!this.worker) return;
    try {
      await this.send({ type: "close", id: this.nextId() });
    } catch {
      // zaten kapalı
    }
    this.worker.terminate();
    this.worker = null;
    this.initPromise = null;
  }
}
