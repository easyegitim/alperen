/**
 * Ders metinlerinin ad temizliği (packages/pii, TS ↔ Python ↔ SQL aynı kurallar). Adlar `profiles.display_name`'den
 * yalnız bu süreçte okunur ve hemen ad-token hash'lerine çevrilir; düz ad hiçbir modele, kayda ya da günlüğe gitmez.
 * Dersin öğrencileri `[ÖĞRENCİ]`, eğitmenleri (dersi veren + bağlı eğitmenler) `[EĞİTMEN]`, öğrencilerin velileri
 * `[VELİ]` olur; kalan "X Hoca", "adım X" kalıpları `[AD]`.
 *
 * Kapalı başarısızlık: dersin bir öğrencisinin görünen adı yoksa temizlik doğrulanamaz ve hiçbir model çağrısı
 * yapılmaz (`OGR-JOB-181`); eğitmen ya da velinin adı yoksa yalnız onların hash'i eksik kalır.
 */
// packages/pii/ts kök çalışma alanının üyesi değildir (kendi kurulumu var); kaynak doğrudan içe aktarılır.
import { nameTokenHashes, scrub, type RoleLabel } from '../../../../packages/pii/ts/src/index.js';
import type { Db } from '../db.js';
import { PermanentJobError } from '../jobs/errors.js';

export interface NameHashes {
  nameHashes: string[];
  roleHashes: Record<string, RoleLabel>;
  /** Kaç kişinin adı (öğrenci, eğitmen, veli) hash'lendi. */
  people: { student: number; instructor: number; guardian: number };
}

/** Hash eşleşmesiyle bulunan ad türleri (kalıp kuralları `intro_name`/`honorific_name` ad tokenı sayılmaz). */
const HASH_KINDS = new Set(['student', 'instructor', 'guardian', 'name']);

/** Hash kümesi (aynı token iki rolde geçerse ilk rol kalır: öğrenci > eğitmen > veli). */
export function buildNameHashes(people: { role: RoleLabel; name: string | null }[]): NameHashes {
  const nameHashes: string[] = [];
  const roleHashes: Record<string, RoleLabel> = {};
  const count = { student: 0, instructor: 0, guardian: 0 };
  const order: RoleLabel[] = ['ÖĞRENCİ', 'EĞİTMEN', 'VELİ'];
  for (const role of order) {
    for (const p of people.filter((x) => x.role === role && x.name && x.name.trim())) {
      const hs = nameTokenHashes(p.name!);
      if (hs.length === 0) continue;
      count[role === 'ÖĞRENCİ' ? 'student' : role === 'EĞİTMEN' ? 'instructor' : 'guardian']++;
      for (const h of hs) {
        if (!(h in roleHashes)) {
          roleHashes[h] = role;
          nameHashes.push(h);
        }
      }
    }
  }
  return { nameHashes, roleHashes, people: count };
}

/**
 * Dersin kişileri (öğrenciler, eğitmenler, veliler) → hash'ler. Öğrenciler `app.lesson_students` kapsamıdır (sınıf
 * dersinde yalnız dersi verenin öğrencileri: ortak derste adı olmayan yabancı bir öğrenci dersi düşürmez). Kapsamdaki
 * bir öğrencinin adı yoksa kapalı başarısızlık.
 */
export async function lessonNameHashes(db: Db, lessonId: string): Promise<NameHashes> {
  const r = await db.query(
    `with l as (select * from public.lessons where id = $1::uuid),
          st as (select unnest(app.lesson_students(l.id)) as student_id from l)
     select 'ÖĞRENCİ' as role, p.display_name as name from st join public.students s on s.id = st.student_id left join public.profiles p on p.id = s.profile_id
     union all
     select 'EĞİTMEN', p.display_name from l join public.profiles p on p.id = l.instructor_id
     union all
     select 'EĞİTMEN', p.display_name from public.instructor_links il join st on st.student_id = il.student_id join public.profiles p on p.id = il.instructor_id
     union all
     select 'VELİ', p.display_name from public.guardian_links gl join st on st.student_id = gl.student_id join public.profiles p on p.id = gl.parent_id
      where gl.status = 'active'`,
    [lessonId],
  );
  const people = r.rows.map((x) => ({ role: String(x.role) as RoleLabel, name: x.name === null || x.name === undefined ? null : String(x.name) }));
  const students = people.filter((p) => p.role === 'ÖĞRENCİ');
  if (students.some((p) => !p.name || nameTokenHashes(p.name).length === 0)) {
    throw new PermanentJobError('ad temizliği doğrulanamadı: dersin bir öğrencisinin görünen adı yok (istek gönderilmedi)', 'OGR-JOB-181');
  }
  return buildNameHashes(people);
}

/** Metni temizler; kaç ad/kişisel veri değiştiğini de döner. */
export function scrubText(text: string, h: NameHashes): { text: string; replaced: number } {
  const res = scrub(text, { nameHashes: h.nameHashes, roleHashes: h.roleHashes });
  return { text: res.text, replaced: res.replacements.reduce((n, x) => n + x.count, 0) };
}

/** Son kemer: metinde hâlâ ad tokenı var mı (modele gitmeden ve yazılmadan önce). */
export function nameLeaks(text: string, h: NameHashes): number {
  const res = scrub(text, { nameHashes: h.nameHashes, roleHashes: h.roleHashes });
  return res.replacements.filter((x) => HASH_KINDS.has(x.kind)).reduce((n, x) => n + x.count, 0);
}

export function assertNoNames(text: string, h: NameHashes, what: string): void {
  if (nameLeaks(text, h) > 0) {
    throw new PermanentJobError(`ad temizliği: ${what} ad tokenı içeriyor (istek gönderilmedi)`, 'OGR-JOB-181');
  }
}
