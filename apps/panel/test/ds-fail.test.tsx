// bundle.js yüklenemezse (404, CSP, deploy'da public/ds/ yok) sarmalayıcılar sonsuz iskelette kalmaz: sade HTML yedeği.
// Ayrı dosya: modül durumu (yüklendi / yüklenemedi) dosya başına izoledir.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { DsLoader } from '../lib/ds-loader';
import { Button, MasteryMeter, Notice, TextField, DS_FAILED_TEXT } from '../lib/ds';

describe('design-system yükleme hatası', () => {
  it('error event switches wrappers to a plain HTML fallback', async () => {
    const onClick = vi.fn();
    const { container } = render(
      <>
        <DsLoader />
        <MasteryMeter skill="Rasyonel sayılar" p={0.72} evidence={7} minEvidence={5} />
        <Notice tone="legal" title="Bilgi">
          Metin
        </Notice>
        <TextField label="Veli / vasi adı soyadı" defaultValue="" />
        <Button variant="primary" onClick={onClick}>
          Onaylıyorum
        </Button>
      </>,
    );
    expect(container.querySelectorAll('[aria-busy="true"]').length).toBe(4);
    const script = document.head.querySelector<HTMLScriptElement>('script[data-ds="1"]')!;
    await act(async () => {
      script.dispatchEvent(new Event('error'));
    });
    expect(container.querySelectorAll('[aria-busy="true"]').length).toBe(0);
    expect(screen.getByRole('alert').textContent).toBe(DS_FAILED_TEXT);
    // işlevsel kalanlar: düğme ve metin alanı native öğe olarak çalışır
    const btn = screen.getByRole('button', { name: 'Onaylıyorum' });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Veli / vasi adı soyadı').tagName).toBe('INPUT');
    expect(screen.getByRole('status').textContent).toContain('Metin');
    expect(script.dataset.dsFailed).toBe('1');
  });
});
