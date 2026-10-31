'use client';
// ADR-0008: bundle.js `var React = window.React` okur. Next React'i modül olarak paketler ve window.React açmaz;
// ikinci bir React (UMD) "Invalid hook call" üretir. Bu yüzden Next'in KENDİ react / react-dom örneği window'a açılır,
// ardından /ds/bundle.js enjekte edilir (defer, data-ds="1", ikinci kez eklenmez) ve onload'da resolveDs çağrılır.
// Yükleme hatası (`error`) failDs() ile bildirilir. next/script beforeInteractive KULLANILMAZ. window.React'e dokunan tek dosya budur (eslint istisnası).
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { failDs, resolveDs } from './ds';

export const DS_BUNDLE_SRC = '/ds/bundle.js';

const useIsoLayoutEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;

export function DsLoader({ src = DS_BUNDLE_SRC }: { src?: string }) {
  useIsoLayoutEffect(() => {
    window.React = React;
    window.ReactDOM = ReactDOM;
    const done = () => resolveDs(window.Ogrenmen);
    let script = document.querySelector<HTMLScriptElement>('script[data-ds="1"]');
    if (script) {
      if (script.dataset.dsLoaded === '1') done();
      else if (script.dataset.dsFailed === '1') failDs();
      else {
        script.addEventListener('load', done, { once: true });
        script.addEventListener('error', failDs, { once: true });
      }
      return;
    }
    script = document.createElement('script');
    script.src = src;
    script.defer = true;
    script.dataset.ds = '1';
    script.addEventListener(
      'load',
      () => {
        if (script) script.dataset.dsLoaded = '1';
        done();
      },
      { once: true },
    );
    // 404 / CSP / eksik public/ds: sarmalayıcılar sonsuz iskelette kalmasın, sade HTML yedeğine geçsin
    script.addEventListener(
      'error',
      () => {
        if (script) script.dataset.dsFailed = '1';
        failDs();
      },
      { once: true },
    );
    document.head.appendChild(script);
  }, [src]);
  return null;
}

export default DsLoader;
