// Kurucunun yerel denemesi (scripts/dev-local/up.ts): sabit giriş kodu ve demo hesaplar. Yalnız NEXT_PUBLIC_LOCAL_DEV=1
// iken giriş sayfasında görünür; üretim derlemesinde bu değişken tanımsızdır (not ve kısayollar hiç çizilmez).
// Bu değerler sır değildir: yalnız 127.0.0.1'de dinleyen yerel köprü bu kodu kabul eder.

export const LOCAL_DEV_OTP = '246810';

export interface LocalDemoAccount {
  /** Düğme metni. */
  label: string;
  email: string;
  role: 'student' | 'parent' | 'admin';
}

export const LOCAL_DEMO_ACCOUNTS: readonly LocalDemoAccount[] = [
  { label: 'Öğrenci (Elif)', email: 'ogrenci@ogrenmen.local', role: 'student' },
  { label: 'Veli', email: 'veli@ogrenmen.local', role: 'parent' },
  { label: 'Eğitmen', email: 'egitmen@ogrenmen.local', role: 'admin' },
];

/** Yerel deneme kipi mi (NEXT_PUBLIC_* derlemede satır içine alınır; doğrudan okunmalı). */
export function isLocalDev(): boolean {
  return process.env.NEXT_PUBLIC_LOCAL_DEV === '1';
}
