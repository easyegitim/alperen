// SPEC 8.2: 3 paralel çağrı → medyan; 1 başarısızsa 2'nin ortalaması; 2+ başarısızsa hata; multiplePeopleOrNotAFace → NO_FACE.
import { ApiError } from "@/lib/api/errors";
import type { GainKey, ScoreOutput } from "@/lib/ai/scoreSchema";
import { SUB_WEIGHTS } from "@/lib/config/scoring";
import { SUB_KEYS, type SubKeyV1 } from "@/lib/config/teaser";

export type Aggregated = {
  rawSubscores: Record<SubKeyV1, number>;
  rawOverall: number;
  gains: ScoreOutput["achievableGain"];
  observations: ScoreOutput["observations"];
  flags: ScoreOutput["flags"];
  /** Kullanılan başarılı çağrı sayısı. */
  samples: number;
};

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function weightedOverall(sub: Record<SubKeyV1, number>): number {
  return SUB_KEYS.reduce((sum, k) => sum + SUB_WEIGHTS[k] * sub[k], 0);
}

/** Promise.allSettled sonuçlarından (veya doğrudan sonuç listesinden) birleştirir. */
export function aggregateScores(results: PromiseSettledResult<ScoreOutput>[]): Aggregated {
  const ok = results.filter((r): r is PromiseFulfilledResult<ScoreOutput> => r.status === "fulfilled").map((r) => r.value);
  if (ok.length < 2) {
    throw new ApiError("AI_FAILED", "Skorlama çağrılarının çoğu başarısız oldu.");
  }
  const noFace = ok.filter((r) => r.flags.multiplePeopleOrNotAFace).length;
  if (noFace * 2 >= ok.length) {
    throw new ApiError("NO_FACE", "Fotoğrafta tek bir yüz bulunamadı.");
  }
  const usable = ok.filter((r) => !r.flags.multiplePeopleOrNotAFace);

  const rawSubscores = Object.fromEntries(SUB_KEYS.map((k) => [k, median(usable.map((r) => r.subscores[k]))])) as Record<SubKeyV1, number>;
  const rawOverall = weightedOverall(rawSubscores);

  // Metin alanları: ham genel skoru medyana en yakın olan çağrıdan.
  const rep = usable.reduce((best, r) => (Math.abs(weightedOverall(r.subscores) - rawOverall) < Math.abs(weightedOverall(best.subscores) - rawOverall) ? r : best), usable[0]);

  const gainKeys: GainKey[] = ["skin", "hair", "grooming", "jawline"];
  const gains = Object.fromEntries(
    gainKeys.map((k) => {
      const value = median(usable.map((r) => r.achievableGain[k].value));
      const closest = usable.reduce((b, r) => (Math.abs(r.achievableGain[k].value - value) < Math.abs(b.achievableGain[k].value - value) ? r : b), usable[0]);
      return [k, { value, lever: closest.achievableGain[k].lever }];
    }),
  ) as ScoreOutput["achievableGain"];

  return {
    rawSubscores,
    rawOverall,
    gains,
    observations: rep.observations,
    flags: {
      visibleSkinConcern: usable.filter((r) => r.flags.visibleSkinConcern).length * 2 > usable.length,
      skinConcernNote: rep.flags.skinConcernNote,
      multiplePeopleOrNotAFace: false,
    },
    samples: usable.length,
  };
}
