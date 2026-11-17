import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { THEME_INIT_SCRIPT } from '@/lib/theme';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Öğrenmen', template: '%s · Öğrenmen' },
  description: 'Öğrenmen: her öğrenciye kendi hızında eşlik eden AI öğretmen.',
  applicationName: 'Öğrenmen',
  appleWebApp: { capable: true, title: 'Öğrenmen', statusBarStyle: 'default' },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0030a2' },
    { media: '(prefers-color-scheme: dark)', color: '#070f2e' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: tema betiği data-theme özniteliğini boyamadan önce ekler.
    <html lang="tr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <a href="#icerik" className="og-skip-link text-label rounded-md bg-primary px-4 py-2 text-on-primary">
          İçeriğe geç
        </a>
        {children}
      </body>
    </html>
  );
}
