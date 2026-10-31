// Test yardımcıları: gerçek design-system bundle.js'i (public/ds/, sync-ds kopyası) Next'in/testin React örneğiyle yükler.
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen, waitFor } from '@testing-library/react';
import { resolveDs } from '../lib/ds';
import { resetDataSourceForTests } from '../lib/data';

export const PANEL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_DIR = join(PANEL_DIR, '..', '..');

export function bundleSource(): string {
  return readFileSync(join(PANEL_DIR, 'public', 'ds', 'bundle.js'), 'utf8');
}

/** bundle.js'i jsdom penceresinde çalıştırır (tarayıcıdaki <script> ile aynı: IIFE, window.React okur). */
export function evalBundle(): void {
  new Function(bundleSource())();
}

/** DsLoader'ı beklemeden sarmalayıcıları hazır eder (sayfa testleri için). */
export function loadDs(): void {
  window.React = React;
  window.ReactDOM = ReactDOM;
  if (!window.Ogrenmen) evalBundle();
  resolveDs(window.Ogrenmen);
}

export function readJson<T = unknown>(rel: string): T {
  return JSON.parse(readFileSync(join(REPO_DIR, rel), 'utf8')) as T;
}

/** Sayfayı verilen rol ve sorgu ile render eder; kabuk ve ilk veri yüklenene kadar bekler. */
export async function renderPage(Page: React.ComponentType, opts: { path?: string; role?: 'coordinator' | 'instructor' | 'observer'; query?: Record<string, string> } = {}) {
  loadDs();
  resetDataSourceForTests();
  const q = new URLSearchParams(opts.query ?? {});
  if (opts.role) q.set('role', opts.role);
  window.history.replaceState({}, '', `${opts.path ?? '/'}${q.toString() ? `?${q}` : ''}`);
  const utils = render(<Page />);
  await waitFor(() => expect(utils.container.querySelector('main')).not.toBeNull());
  await waitFor(() => expect(utils.container.querySelectorAll('[aria-busy="true"]').length).toBe(0), { timeout: 5000 });
  return { ...utils, screen };
}

/** Düğmeleri metne göre bulur (bundle Button'ı native <button> render eder). */
export function buttonsNamed(container: HTMLElement, re: RegExp): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')].filter((b) => re.test((b.textContent ?? '').trim()));
}

export function primaryCount(container: HTMLElement): number {
  return container.querySelectorAll('.og-btn-primary').length;
}
