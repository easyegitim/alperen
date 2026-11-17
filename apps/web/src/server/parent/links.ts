import 'server-only';
import { parentDb } from './children';

export interface GuardianLinkRow {
  id: string;
  /** "Mehmet Yılmaz (baba)" ya da "Davet bekliyor (anne)". */
  label: string;
}

const REL: Record<string, string> = { anne: 'anne', baba: 'baba', vasi: 'vasi', 'diğer': 'diğer' };

/** Öğrencinin aktif veli bağları ve bekleyen davetleri (list_guardian_links, 0044; token/hash yok). Hata olursa boş. */
export async function loadGuardianLinks(studentId: string): Promise<GuardianLinkRow[]> {
  try {
    const { data, error } = await (await parentDb()).rpc('list_guardian_links', { p_student: studentId });
    if (error || !Array.isArray(data)) return [];
    return data.flatMap((raw): GuardianLinkRow[] => {
      const r = raw as { link_id?: unknown; status?: unknown; relation?: unknown; parent_name?: unknown };
      if (typeof r.link_id !== 'string') return [];
      const rel = typeof r.relation === 'string' && REL[r.relation] ? ` (${REL[r.relation]})` : '';
      const name = r.status === 'active' && typeof r.parent_name === 'string' && r.parent_name ? r.parent_name : r.status === 'active' ? 'Veli' : 'Davet bekliyor';
      return [{ id: r.link_id, label: `${name}${rel}` }];
    });
  } catch {
    return [];
  }
}
