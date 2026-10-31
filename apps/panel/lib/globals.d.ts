// window.React / window.ReactDOM: lib/ds-loader.tsx Next'in kendi örneğini açar (ADR-0008); window.Ogrenmen tipi
// packages/design-system/components/index.d.ts içindeki global bildirimden gelir.
import type * as ReactNs from 'react';
import type * as ReactDomNs from 'react-dom';
import type {} from '../../../packages/design-system/components/index';

declare global {
  interface Window {
    React?: typeof ReactNs;
    ReactDOM?: typeof ReactDomNs;
  }
}

export {};
