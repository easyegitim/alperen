'use client';
import * as React from 'react';
import { errorText } from './errors';
import { getDataSource, type DataSource } from './data';

export function useDataSource(): DataSource {
  return React.useMemo(() => getDataSource(), []);
}

export interface AsyncState<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** Sayfa verisi: yükleme, hata metni (Türkçe) ve yeniden yükleme. */
export function useAsync<T>(fn: () => Promise<T>, deps: React.DependencyList): AsyncState<T> {
  const [state, setState] = React.useState<{ data: T | undefined; error: string | null; loading: boolean }>({ data: undefined, error: null, loading: true });
  const [tick, setTick] = React.useState(0);
  const fnRef = React.useRef(fn);
  fnRef.current = fn;
  React.useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    fnRef
      .current()
      .then((data) => {
        if (alive) setState({ data, error: null, loading: false });
      })
      .catch((e: unknown) => {
        if (alive) setState({ data: undefined, error: errorText(e), loading: false });
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = React.useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

/** Bir eylemi çalıştırır; hata metnini ve bekleme durumunu verir. */
export function useAction() {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const run = React.useCallback(async <T,>(fn: () => Promise<T>, success?: string): Promise<{ ok: boolean; value?: T }> => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const value = await fn();
      if (success) setMessage(success);
      return { ok: true, value };
    } catch (e) {
      setError(errorText(e));
      return { ok: false };
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, message, run, setMessage, setError };
}

function subscribeLocation(cb: () => void): () => void {
  window.addEventListener('popstate', cb);
  return () => window.removeEventListener('popstate', cb);
}

/** Sorgu parametresi (statik export: detay sayfaları ?id= / ?ref= / ?token= kullanır). */
export function useQueryParam(name: string): string | null {
  const search = React.useSyncExternalStore(
    subscribeLocation,
    () => window.location.search,
    () => '',
  );
  return React.useMemo(() => new URLSearchParams(search).get(name), [search, name]);
}
