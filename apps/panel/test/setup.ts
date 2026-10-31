// vitest + jsdom ortak kurulum. Ağ yoktur: fetch çağrısı test hatasıdır (live testleri kendi sahte fetch'ini verir).
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Eşzamansız veri yüklemesi sonrası React'in act() uyarıları gürültüdür; diğer console.error çıktıları aynen geçer.
const originalError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].includes('not wrapped in act(')) return;
  originalError(...args);
};

beforeEach(() => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('Testte ağ erişimi yok')));
  window.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
