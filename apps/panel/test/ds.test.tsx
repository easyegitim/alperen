// ADR-0008: gerçek bundle.js DsLoader ile, testin (Next'in) React örneğinde yüklenir.
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { DsLoader } from '../lib/ds-loader';
import { MasteryMeter, TextField, dsLoadedForTests, dsReady } from '../lib/ds';
import { evalBundle } from './helpers';

describe('design-system loader', () => {
  it('bundle_uses_same_react_instance', async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });
    expect(dsLoadedForTests()).toBe(false);
    const { container } = render(
      <>
        <DsLoader />
        <MasteryMeter skill="Rasyonel sayılar" p={0.72} evidence={7} minEvidence={5} period="YKS 2027" />
        <TextField label="Not" defaultValue="" />
      </>,
    );
    // yüklenmeden önce iskelet, Ogrenmen.* çağrılmaz
    expect(container.querySelectorAll('[aria-busy="true"]').length).toBe(2);
    const script = document.head.querySelector<HTMLScriptElement>('script[data-ds="1"]');
    expect(script).not.toBeNull();
    expect(script!.getAttribute('src')).toBe('/ds/bundle.js');
    expect(script!.defer).toBe(true);
    expect(window.React).toBe(React);
    // tarayıcının yaptığı gibi: betiği çalıştır, load olayını ver
    await act(async () => {
      evalBundle();
      script!.dispatchEvent(new Event('load'));
      await dsReady;
    });
    await waitFor(() => expect(screen.getByText('%72')).toBeTruthy());
    expect(window.React.useRef).toBe(React.useRef);
    expect(screen.getByLabelText('Not')).toBeTruthy();
    expect(errors.filter((e) => /Invalid hook call/.test(e))).toEqual([]);
    // ikinci kez eklenmez
    render(<DsLoader />);
    expect(document.head.querySelectorAll('script[data-ds="1"]').length).toBe(1);
    spy.mockRestore();
  });
});
