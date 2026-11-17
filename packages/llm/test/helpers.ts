import { FakeTransport } from '../src/fake.js';
import { Gateway } from '../src/gateway.js';
import { InMemoryLedger } from '../src/ledger.js';

/** ≥ 512 token'lık sabit ürün bloğu (önbellek alt sınırını aşsın; sahte sayaç ≈ karakter/4). */
export const PRODUCT = [
  'Sen Öğrenmen koçusun. Öğrenciyle "sen" diliyle, sıcak ve kısa konuşursun; bir fikir, bir balon.',
  'Ustalık iddialarını kanıt sayısıyla söylersin. Türkçe sayı biçimi kullanırsın. Matematiği KaTeX $…$ ile yazarsın.',
  'Ünlem ve emoji kullanmazsın. Yapay zekâ olduğunu gizlemezsin.',
  ...Array.from({ length: 60 }, (_, i) => `Kural ${i + 1}: öğrencinin çözümündeki ilk bozulan adımı bul, nedenini tek cümleyle söyle.`),
].join('\n');

export const COURSE = [
  'Ders: TYT Matematik. Müfredat ağacı (kod · ad):',
  ...Array.from({ length: 40 }, (_, i) => `tyt.mat.k${i + 1} · Kazanım ${i + 1}`),
].join('\n');

export const DOSSIER = 'Öğrenci s_qk7m2rx4tn5a · hedef TYT 2027 · en zayıf: tyt.mat.k3 (0,31; 4 kanıt).';

export function setup() {
  const fake = new FakeTransport();
  const ledger = new InMemoryLedger();
  let t = 0;
  const gateway = new Gateway({ transport: fake, ledger, now: () => (t += 10) });
  return { fake, ledger, gateway };
}

/** Bir nesnede (derin) anahtar arar. */
export function hasKeyDeep(x: unknown, key: string): boolean {
  if (Array.isArray(x)) return x.some((v) => hasKeyDeep(v, key));
  if (x && typeof x === 'object') return Object.entries(x).some(([k, v]) => k === key || hasKeyDeep(v, key));
  return false;
}
