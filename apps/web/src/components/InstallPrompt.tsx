'use client';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { Button, Notice } from '@/ds';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'ogrenmen-yukle-kapat';

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream;
}

function wasDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Uygulamayı ana ekrana ekleme istemi. Chromium'da `beforeinstallprompt` ile gerçek yükleme penceresi açılır;
 * iOS'ta Safari'nin "Ana Ekrana Ekle" yolu anlatılır. Yüklüyse ya da kapatıldıysa hiçbir şey çizmez.
 */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIos, setShowIos] = useState(false);

  useEffect(() => {
    if (isStandalone() || wasDismissed()) return;
    // iOS'ta yükleme olayı yoktur: yalnız yönerge göster (tarayıcıya özgü değer ilk çizimden sonra okunur).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isIos()) setShowIos(true);
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setDeferred(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  function dismiss() {
    setDeferred(null);
    setShowIos(false);
    try {
      window.localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* depolama kapalı: bu oturumda gizli kalır */
    }
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
  }

  if (deferred) {
    return (
      <Notice
        tone="info"
        title="Öğrenmen'i ana ekrana ekle"
        className="mb-4"
        onDismiss={dismiss}
        action={
          <Button variant="secondary" size="sm" icon={<Download size={16} />} onClick={install}>
            Uygulamayı yükle
          </Button>
        }
      >
        Tek dokunuşla aç, çevrimdışıyken de kabuk hazır olsun.
      </Notice>
    );
  }
  if (showIos) {
    return (
      <Notice tone="info" title="Öğrenmen'i ana ekrana ekle" className="mb-4" onDismiss={dismiss}>
        {'Safari\u2019de Paylaş düğmesine dokun, ardından "Ana Ekrana Ekle" seçeneğini seç.'}
      </Notice>
    );
  }
  return null;
}
