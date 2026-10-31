import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { DsLoader } from '../lib/ds-loader';
import { BrandLockup } from '../lib/ds';
import './tokens.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Öğrenmen · Eğitmen paneli',
  description: 'easy · Öğrenmen eğitmen paneli',
  robots: { index: false, follow: false },
};

// ADR-0008: <DsLoader/> gövdenin ilk çocuğudur; Next'in React örneğini window'a açar ve /ds/bundle.js'i enjekte eder.
// bundle.css ve tokens.css yerel dosyalardır (CDN yok, next/font yok).
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr" data-theme="light">
      <head>
        <link rel="stylesheet" href="/ds/bundle.css" />
        <link rel="icon" href="/ds/easy-isaret-mor.png" />
      </head>
      <body>
        <DsLoader />
        <header className="topbar">
          <a href="/" className="topbar-brand" aria-label="Öğrenmen eğitmen paneli ana sayfa">
            <BrandLockup size="sm" endorsement={false} markSrc="/ds/easy-isaret-mor.png" />
          </a>
          <span className="t-caption topbar-sub">Eğitmen paneli</span>
        </header>
        {children}
      </body>
    </html>
  );
}
