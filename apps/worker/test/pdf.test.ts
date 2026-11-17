import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import { PdfRenderer, countPdfPages, findInstalledChromium, pdfMediaBox } from '../src/pdf/render.js';

const renderer = new PdfRenderer({ executablePath: process.env.PDF_CHROMIUM_PATH || findInstalledChromium(), maxConcurrent: 2 });
afterAll(() => renderer.close());

const html = (body: string) => `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>@page{size:A4;margin:16mm}body{font-family:sans-serif}</style></head><body>${body}</body></html>`;

describe('pdf.render yardımcısı', () => {
  it('basit HTML’den A4 PDF üretir', async () => {
    const out = await renderer.render(html('<h1>Merhaba Öğrenmen</h1><p>İlk sayfa.</p>'));
    expect(out.pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(out.pages).toBe(1);
    const box = pdfMediaBox(out.pdf)!;
    expect(Math.round(box[2] - box[0])).toBe(595);
    expect(Math.round(box[3] - box[1])).toBe(842);
  });

  it('uzun içerik birden çok sayfa olur', async () => {
    const rows = Array.from({ length: 160 }, (_, i) => `<p>Satır ${i + 1}</p>`).join('');
    const out = await renderer.render(html(rows));
    expect(out.pages).toBeGreaterThan(1);
    expect(countPdfPages(out.pdf)).toBe(out.pages);
  });

  it('dış ağ istekleri engellenir (sayfa yine de üretilir)', async () => {
    const out = await renderer.render(html('<img src="http://127.0.0.1:9/x.png"><p>ağ yok</p>'));
    expect(out.pages).toBe(1);
  });

  it('WebSocket ve betik engellenir (yerel sunucuya upgrade gelmez)', async () => {
    const hits: string[] = [];
    const server = createServer((req, res) => {
      hits.push(`http ${req.url}`);
      res.end('x');
    });
    server.on('upgrade', (req, socket) => {
      hits.push(`upgrade ${req.url}`);
      socket.destroy();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    try {
      const out = await renderer.render(html(`<p>içerik</p><script>new WebSocket('ws://127.0.0.1:${port}/leak?d='+document.body.innerText)</script>`));
      expect(out.pages).toBe(1);
      await new Promise((r) => setTimeout(r, 300));
      expect(hits).toEqual([]);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it('boş HTML hata verir', async () => {
    await expect(renderer.render('   ')).rejects.toThrow(/HTML boş/);
  });
});
