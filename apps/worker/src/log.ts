/** Yapılandırılmış (JSON satırı) günlük. Sır ve öğrenci adı yazılmaz; çağıranlar yalnız kimlik/sayaç verir. */
import type { LogLevel } from './config.js';

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function errorFields(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { error: err.message, errorName: err.name, ...(typeof (err as { code?: unknown }).code === 'string' ? { code: (err as { code: string }).code } : {}) };
  }
  return { error: String(err) };
}

export function createLogger(level: LogLevel = 'info', base: Record<string, unknown> = {}, sink: (line: string) => void = (l) => process.stdout.write(l + '\n')): Logger {
  const emit = (lvl: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (ORDER[lvl] < ORDER[level]) return;
    sink(JSON.stringify({ t: new Date().toISOString(), level: lvl, msg, ...base, ...fields }));
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    child: (fields) => createLogger(level, { ...base, ...fields }, sink),
  };
}

/** Sessiz günlük (testler). */
export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
};
