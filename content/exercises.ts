// SPEC 9.5 (D08): yalnız katalogdan, exerciseEligible=true iken. Kemik yapısını değiştirme vaadi yok.
export type Exercise = {
  id: string;
  nameTr: string;
  doseTr: string;
  noteTr: string;
  kind: "jaw" | "posture" | "yoga" | "massage";
  /** Rutin ekranı için: süre (sn) veya tekrar. */
  timer: { seconds: number; sets?: number } | { reps: number; sets?: number; holdSeconds?: number };
  slot: "morning" | "evening" | "daily";
};

/** Her egzersiz kartındaki sabit metin (SPEC 9.5). */
export const EXERCISE_SAFETY_TEXT = "Kas tonusu ve duruşa yöneliktir; kemik yapısını değiştirmez, etkisi kişiden kişiye değişir. Ağrı olursa bırak.";

export const EXERCISES: Exercise[] = [
  { id: "ex_masseter_gum", nameTr: "Şekersiz sakız / damla sakızı çiğneme", doseTr: "Günde 10–15 dk, iki tarafı eşit, haftada en fazla 5 gün", noteTr: "Ağrı, klik sesi, baş ağrısında dur", kind: "jaw", timer: { seconds: 600 }, slot: "daily" },
  { id: "ex_chin_tuck", nameTr: "Çene geri çekme (postür)", doseTr: "10 tekrar × 2 set", noteTr: "Boyun duruşu için", kind: "posture", timer: { reps: 10, sets: 2 }, slot: "daily" },
  { id: "ex_neck_stretch", nameTr: "Boyun ve çene hattı esneme", doseTr: "3 × 20 sn", noteTr: "Zorlamadan", kind: "posture", timer: { seconds: 20, sets: 3 }, slot: "evening" },
  { id: "ex_cheek_puff", nameTr: "Yanak şişirme ve hava aktarma", doseTr: "10 tekrar", noteTr: "Yüz yogası", kind: "yoga", timer: { reps: 10 }, slot: "morning" },
  { id: "ex_fish_face", nameTr: "Yanakları içe çekme", doseTr: "10 × 5 sn", noteTr: "Yüz yogası", kind: "yoga", timer: { reps: 10, holdSeconds: 5 }, slot: "morning" },
  { id: "ex_jaw_release", nameTr: "Çene gevşetme masajı", doseTr: "2 dk", noteTr: "Diş sıkanlar için de uygun", kind: "massage", timer: { seconds: 120 }, slot: "evening" },
  { id: "ex_face_massage", nameTr: "Lenf yönünde yüz masajı (sabah şişlik)", doseTr: "2–3 dk", noteTr: "Temiz ellerle", kind: "massage", timer: { seconds: 150 }, slot: "morning" },
  { id: "ex_brow_relax", nameTr: "Alın gevşetme", doseTr: "1 dk", noteTr: "Yüz yogası", kind: "yoga", timer: { seconds: 60 }, slot: "evening" },
];

export const EXERCISE_IDS = EXERCISES.map((e) => e.id);
