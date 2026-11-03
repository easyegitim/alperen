import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  // `// @vitest-environment node` dosyalarında (sunucu testleri) DOM yoktur.
  if (typeof window === 'undefined') return;
  cleanup();
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});
