// Maskottan PWA simgeleri üretir (sharp): public/icons/*.png. Çalıştır: bun run icons
// Maskot şeffaf zeminlidir; simge zemini Öğrenmen mavisi (#0030a2). Maskable simgede karakter güvenli bölgeye (orta %60) sığar.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../../packages/design-system/assets/Maskot/ogrenmen-maskot.webp');
const OUT = path.resolve(HERE, '../public/icons');
const BG = '#0030a2';

async function icon(size, fill, file, { rounded = false } = {}) {
  // fill: karakterin simge kenarına oranı. Yüz ve kulaklığı kesmemek için contain kullanılır.
  const inner = Math.round(size * fill);
  const mascot = await sharp(SRC).resize({ width: inner, height: inner, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  let img = sharp({ create: { width: size, height: size, channels: 4, background: BG } }).composite([{ input: mascot, gravity: 'center' }]);
  if (rounded) {
    const r = Math.round(size * 0.22);
    const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}"/></svg>`);
    img = sharp(await img.png().toBuffer()).composite([{ input: mask, blend: 'dest-in' }]);
  }
  await img.png({ compressionLevel: 9 }).toFile(path.join(OUT, file));
  console.log('yazıldı', file);
}

await fs.mkdir(OUT, { recursive: true });
await icon(192, 0.92, 'icon-192.png');
await icon(512, 0.92, 'icon-512.png');
// maskable: sistem kenarları keser; karakter orta %70 içinde kalır.
await icon(512, 0.7, 'icon-maskable-512.png');
// iOS ana ekran: tam kare (iOS köşeleri kendisi yuvarlar).
await icon(180, 0.92, 'apple-touch-icon.png');
// Bildirim rozeti: tek renkli (Android durum çubuğu) beyaz silüt.
const sil = await sharp(SRC).resize({ width: 72, height: 72, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).ensureAlpha().extractChannel('alpha').toBuffer();
await sharp({ create: { width: 96, height: 96, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: await sharp({ create: { width: 72, height: 72, channels: 3, background: '#ffffff' } }).joinChannel(sil).png().toBuffer(), gravity: 'center' }])
  .png()
  .toFile(path.join(OUT, 'badge-96.png'));
console.log('yazıldı badge-96.png');
