// SPEC 9.3: su, uyku, güneş koruması, yürüyüş, protein, kuvvet antrenmanı, tuz/alkol.
export type Habit = {
  id: string;
  nameTr: string;
  defaultTargetTr: string;
  slot: "daily" | "weekly";
  weightRelated: boolean;
  /** Sprint 2: saç alışkanlığı (başörtüsü varsa plana girmez, K9). Yoksa cilt/genel. */
  area?: "hair";
};

export const HABITS: Habit[] = [
  { id: "hb_water", nameTr: "Su", defaultTargetTr: "Günde 2–2,5 litre", slot: "daily", weightRelated: false },
  { id: "hb_sleep", nameTr: "Uyku", defaultTargetTr: "7–8 saat, düzenli saatlerde", slot: "daily", weightRelated: false },
  { id: "hb_sun", nameTr: "Güneş koruması", defaultTargetTr: "Her sabah SPF", slot: "daily", weightRelated: false },
  { id: "hb_walk", nameTr: "Yürüyüş", defaultTargetTr: "Günde 30 dk", slot: "daily", weightRelated: true },
  { id: "hb_protein", nameTr: "Yeterli protein", defaultTargetTr: "Her öğünde bir protein kaynağı", slot: "daily", weightRelated: true },
  { id: "hb_strength", nameTr: "Kuvvet antrenmanı", defaultTargetTr: "Haftada 2–3 seans", slot: "weekly", weightRelated: true },
  { id: "hb_salt_alcohol", nameTr: "Tuz ve alkolü azalt", defaultTargetTr: "Akşam tuzu ve alkolü azalt (yüz şişliği)", slot: "daily", weightRelated: false },
  // Sprint 2 katalog genişletmesi (PLAN 4e): cilt ve saç hijyeni alışkanlıkları; kilo/kalori içermez.
  { id: "hb_pillowcase", nameTr: "Yastık kılıfını sık değiştir", defaultTargetTr: "Haftada 2 kez temiz kılıf", slot: "weekly", weightRelated: false },
  { id: "hb_no_touch", nameTr: "Yüze dokunmamak", defaultTargetTr: "Gün içinde yüze ve sivilcelere dokunma", slot: "daily", weightRelated: false },
  { id: "hb_lukewarm_shower", nameTr: "Ilık duş", defaultTargetTr: "Çok sıcak sudan kaçın; saç ve cilt kurumaz", slot: "daily", weightRelated: false },
  { id: "hb_hair_wash_rhythm", nameTr: "Saç yıkama düzeni", defaultTargetTr: "Saç tipine göre 2 günde bir; hafif şampuan", slot: "daily", weightRelated: false, area: "hair" },
  { id: "hb_posture_breaks", nameTr: "Duruş molası", defaultTargetTr: "Masa başında saatte bir omuz ve boyun molası", slot: "daily", weightRelated: false },
];

export const HABIT_IDS = HABITS.map((h) => h.id);
