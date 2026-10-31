// AlertRow sıralaması (egitmen-paneli.md): önce Acil, sonra Dikkat, sonra Bilgi; grup içinde en eski üstte.
const RANK: Record<string, number> = { danger: 0, warning: 1, neutral: 2 };

export function sortAlerts<T extends { severity: string; since: string | null | undefined }>(alerts: readonly T[]): T[] {
  return [...alerts].sort((a, b) => {
    const r = (RANK[a.severity] ?? 1) - (RANK[b.severity] ?? 1);
    if (r !== 0) return r;
    const ta = a.since ? Date.parse(a.since) : Number.POSITIVE_INFINITY;
    const tb = b.since ? Date.parse(b.since) : Number.POSITIVE_INFINITY;
    return ta - tb;
  });
}

export const SEVERITY_WORD: Record<string, string> = { danger: 'Acil', warning: 'Dikkat', neutral: 'Bilgi' };
