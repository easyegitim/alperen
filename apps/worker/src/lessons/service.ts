/**
 * pipelines/ders HTTP servisinin istemcisi (P5; docs/PLAN-v2.md §9): `/prepare` (ffmpeg ses + ≤ 30 sahne karesi),
 * `/stt` (Groq Whisper ya da OGRENMEN_STT=fake), `/cleanup`. Adres `LESSON_SERVICE_URL` (varsayılan
 * http://127.0.0.1:8711), isteğe bağlı paylaşılan sır `LESSON_SERVICE_TOKEN` (servis tarafında OGRENMEN_DERS_TOKEN).
 *
 * Servisin Storage erişimi varsa (sağlık yanıtında `storage: true`) kaynak ve çıktılar Storage yollarıyla akar (büyük
 * video worker belleğine girmez). Yoksa servis aynı makinededir: worker kaynağı servisin çalışma köküne
 * (`work_dir`) yazar, çıktıları oradan okuyup Storage'a yükler. Bağlantı hatası ve 5xx yeniden denenir; 4xx kalıcıdır
 * (bozuk ya da sessiz kayıt, geçersiz istek).
 */
import { PermanentJobError } from '../jobs/errors.js';

export interface ServiceHealth {
  ok: boolean;
  ffmpeg: boolean;
  stt: 'groq' | 'fake' | 'none';
  storage: boolean;
  work_dir: string;
}

export interface PreparedFrame {
  /** Çalışma köküne göreli yol. */
  path: string;
  t_sec: number;
  t: string;
  score: number | null;
  bytes: number;
  mime: string;
  /** Servis Storage'a yüklediyse. */
  storage_path?: string;
}

export interface PrepareResult {
  lesson_id: string;
  duration_sec: number;
  has_video: boolean;
  has_audio: boolean;
  method: string;
  audio: { path: string; bytes: number; mime: string; storage_path?: string };
  frames: PreparedFrame[];
  stored: boolean;
}

export interface SttSegment {
  t0: number;
  t1: number;
  text: string;
}

export interface SttResult {
  provider: 'groq' | 'fake';
  language: string;
  duration_sec: number;
  chunks: number;
  segments: SttSegment[];
}

export interface PrepareRequest {
  lesson_id: string;
  local_path?: string;
  storage_path?: string;
  bucket?: string;
  dest_prefix?: string;
  max_frames?: number;
}

export interface SttRequest {
  lesson_id: string;
  wav_path?: string;
  storage_path?: string;
  bucket?: string;
  language?: string;
  fixture?: string;
}

export interface LessonService {
  readonly url: string;
  health(): Promise<ServiceHealth>;
  prepare(req: PrepareRequest, signal?: AbortSignal): Promise<PrepareResult>;
  stt(req: SttRequest, signal?: AbortSignal): Promise<SttResult>;
  cleanup(lessonId: string): Promise<void>;
}

/** Servisin döndürdüğü hata: `OGR-DERS-NNN` kodu ve Türkçe ileti; `permanent` 4xx'tir. */
export class LessonServiceError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'LessonServiceError';
  }

  get permanent(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

export const DEFAULT_LESSON_SERVICE_URL = 'http://127.0.0.1:8711';
/** 90 dakikalık bir kaydın ffmpeg + STT süresi için cömert sınır; pg-boss işin süresini ayrıca sınırlar. */
const REQUEST_TIMEOUT_MS = 45 * 60 * 1000;

export function createLessonService(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): LessonService {
  const url = (env.LESSON_SERVICE_URL?.trim() || DEFAULT_LESSON_SERVICE_URL).replace(/\/+$/, '');
  const token = env.LESSON_SERVICE_TOKEN?.trim() || null;

  async function call<T>(method: 'GET' | 'POST', path: string, body?: object, signal?: AbortSignal): Promise<T> {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetchImpl(`${url}${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (err) {
      // bağlantı yok ya da zaman aşımı: yeniden denenebilir (servis yeniden başlıyor olabilir)
      throw new Error(`ders servisine ulaşılamadı (${url}${path}): ${(err as Error).message}`);
    }
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      data = { message: text.slice(0, 200) };
    }
    if (!res.ok) {
      const code = typeof data.error === 'string' ? data.error : `HTTP ${res.status}`;
      throw new LessonServiceError(`${code} ${typeof data.message === 'string' ? data.message : 'ders servisi hatası'}`, code, res.status);
    }
    return data as T;
  }

  return {
    url,
    health: () => call<ServiceHealth>('GET', '/healthz'),
    prepare: (req, signal) => call<PrepareResult>('POST', '/prepare', req, signal),
    stt: (req, signal) => call<SttResult>('POST', '/stt', req, signal),
    cleanup: async (lessonId) => {
      await call('POST', '/cleanup', { lesson_id: lessonId });
    },
  };
}

/** Testler servisi değiştirebilir (sahte servis ya da test portunda gerçek süreç). */
export const lessonServiceHooks: { service?: LessonService } = {};

let defaultService: LessonService | null = null;

export function lessonService(): LessonService {
  if (lessonServiceHooks.service) return lessonServiceHooks.service;
  defaultService ??= createLessonService();
  return defaultService;
}

/** Servis hatasını iş hatasına çevirir: 4xx kalıcıdır (yeniden denemek aynı sonucu verir). */
export function asJobError(err: unknown): unknown {
  if (err instanceof LessonServiceError && err.permanent) return new PermanentJobError(err.message, err.code);
  return err;
}
