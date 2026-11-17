import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Recharts ResponsiveContainer jsdom'da ResizeObserver ister.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;

afterEach(() => cleanup());

// jsdom'da yerleşim yok: Recharts boyut uyarısı beklenen gürültüdür.
const origError = console.error;
const origWarn = console.warn;
const noisy = (args: unknown[]) => typeof args[0] === 'string' && args[0].includes('of chart should be greater than 0');
console.error = (...args: unknown[]) => (noisy(args) ? undefined : origError(...args));
console.warn = (...args: unknown[]) => (noisy(args) ? undefined : origWarn(...args));
