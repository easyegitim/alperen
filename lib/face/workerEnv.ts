// Worker türü tespiti (saf; birim testli). Klasik worker'da importScripts çalışır; modül worker'da TypeError fırlatır.
// CSP ile engellenen bir probe DOMException (NetworkError) fırlatır; bu modül worker anlamına GELMEZ.
// Bu yüzden probe aynı kaynaktaki boş bir dosyadır (public/worker-probe.js) ve yalnız TypeError "modül" sayılır.
export const WORKER_PROBE_URL = "/worker-probe.js";

export function isModuleWorkerFromProbe(importScripts: ((...urls: string[]) => void) | undefined, probeUrl = WORKER_PROBE_URL): boolean {
  if (typeof importScripts !== "function") return true;
  try {
    importScripts(probeUrl);
    return false;
  } catch (e) {
    return e instanceof TypeError;
  }
}
