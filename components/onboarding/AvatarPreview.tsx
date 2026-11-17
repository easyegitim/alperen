import type { BeardLengthPref, HairLengthPref } from "@/lib/config/plan";

// Çizgi-illüstrasyon avatar (KB R1-E1; PLAN 4c): saç uzunluğu × sakal uzunluğu seçimini görselleştirir. Kullanıcı fotoğrafı
// değildir, yüz şekli taşımaz; currentColor ile açık/koyu temada aynı. "keep" = mevcut (orta) çizim, kesikli çizgi.

type Props = { hair: HairLengthPref; beard: BeardLengthPref; presentation: "male" | "female" | "unspecified"; className?: string; label?: string };

const HAIR_PATH: Record<Exclude<HairLengthPref, "keep">, string> = {
  short: "M30 38 Q32 16 50 14 Q68 16 70 38 Q60 30 50 30 Q40 30 30 38 Z",
  medium: "M26 52 Q24 10 50 10 Q76 10 74 52 Q72 38 62 32 Q50 28 38 32 Q28 38 26 52 Z",
  long: "M18 100 Q20 6 50 6 Q80 6 82 100 Q74 92 74 62 Q72 38 62 32 Q50 28 38 32 Q28 38 26 62 Q26 92 18 100 Z",
};

const BEARD_PATH: Record<Exclude<BeardLengthPref, "keep" | "none">, string> = {
  stubble: "M30 72 Q50 94 70 72",
  short: "M28 70 Q34 90 50 92 Q66 90 72 70 Q66 84 50 86 Q34 84 28 70 Z",
  medium: "M27 68 Q30 100 50 104 Q70 100 73 68 Q66 86 50 90 Q34 86 27 68 Z",
  long: "M26 66 Q28 110 50 118 Q72 110 74 66 Q66 88 50 92 Q34 88 26 66 Z",
};

export function AvatarPreview({ hair, beard, presentation, className, label }: Props) {
  const hairKey = hair === "keep" ? "medium" : hair;
  const beardKey: Exclude<BeardLengthPref, "keep"> = beard === "keep" ? "short" : beard;
  const beardPath = presentation !== "female" && beardKey !== "none" ? BEARD_PATH[beardKey] : null;
  const keepStyle = { strokeDasharray: "3 3" } as const;
  return (
    <svg viewBox="0 0 100 124" role="img" aria-label={label} className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      {/* boyun ve omuz */}
      <path d="M38 92 L38 104 Q20 108 12 122 M62 92 L62 104 Q80 108 88 122" opacity="0.6" />
      {/* yüz ovali (nötr) */}
      <path d="M30 40 Q30 20 50 20 Q70 20 70 40 L70 62 Q70 82 50 90 Q30 82 30 62 Z" />
      {/* gözler, burun, ağız: tek çizgi */}
      <path d="M38 50 h8 M54 50 h8 M50 52 v10 M44 72 q6 4 12 0" opacity="0.7" />
      {/* saç */}
      <path d={HAIR_PATH[hairKey]} fill="currentColor" fillOpacity={hair === "keep" ? 0.12 : 0.22} style={hair === "keep" ? keepStyle : undefined} />
      {/* sakal */}
      {beardPath ? (
        <path d={beardPath} fill={beardKey === "stubble" ? "none" : "currentColor"} fillOpacity={beard === "keep" ? 0.12 : 0.22} style={beard === "keep" ? keepStyle : beardKey === "stubble" ? { strokeDasharray: "1.5 2.5" } : undefined} />
      ) : null}
    </svg>
  );
}
