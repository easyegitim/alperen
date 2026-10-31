/** Komut tablosu (Telegram komut adlarında Türkçe karakter yok: /baslat, /yardim, /oncelik, /arastir). */
import type { Ctx } from '../context.ts';
import * as arastir from './arastir.ts';
import * as baslat from './baslat.ts';
import * as cevap from './cevap.ts';
import * as durdur from './durdur.ts';
import * as egitmen from './egitmen.ts';
import * as gizlilik from './gizlilik.ts';
import * as hoca from './hoca.ts';
import * as ilerleme from './ilerleme.ts';
import * as kota from './kota.ts';
import * as mod from './mod.ts';
import * as oncelik from './oncelik.ts';
import * as sil from './sil.ts';
import * as start from './start.ts';
import * as test from './test.ts';
import * as veli from './veli.ts';
import * as yardim from './yardim.ts';

export interface CommandSpec {
  run: (ctx: Ctx, args: string) => Promise<void>;
  /** Öğrenci kaydı gerektirir (yoksa "/start yaz"). */
  needsStudent: boolean;
  /** Onaysız öğrenciye de açık. */
  beforeConsent: boolean;
  /** Grupta da çalışır. */
  group: boolean;
}

export const COMMANDS: Record<string, CommandSpec> = {
  start: { run: start.run, needsStudent: false, beforeConsent: true, group: false },
  test: { run: test.run, needsStudent: true, beforeConsent: false, group: false },
  cevap: { run: cevap.run, needsStudent: true, beforeConsent: false, group: false },
  mod: { run: mod.run, needsStudent: true, beforeConsent: false, group: false },
  yardim: { run: yardim.run, needsStudent: false, beforeConsent: true, group: true },
  ilerleme: { run: ilerleme.run, needsStudent: true, beforeConsent: false, group: false },
  hoca: { run: hoca.run, needsStudent: false, beforeConsent: false, group: true },
  kota: { run: kota.run, needsStudent: true, beforeConsent: false, group: false },
  durdur: { run: durdur.run, needsStudent: true, beforeConsent: true, group: false },
  baslat: { run: baslat.run, needsStudent: true, beforeConsent: false, group: false },
  sil: { run: sil.run, needsStudent: true, beforeConsent: true, group: false },
  veli: { run: veli.run, needsStudent: false, beforeConsent: true, group: false },
  egitmen: { run: egitmen.run, needsStudent: false, beforeConsent: true, group: false },
  oncelik: { run: oncelik.run, needsStudent: true, beforeConsent: false, group: false },
  arastir: { run: arastir.run, needsStudent: true, beforeConsent: false, group: false },
  gizlilik: { run: gizlilik.run, needsStudent: false, beforeConsent: true, group: true },
};

/** `p_create=false` ile çağrılan komutlar (§5.2): kimlik yaratmaz. */
export const NO_CREATE = new Set(['veli', 'egitmen', 'yardim', 'gizlilik']);
