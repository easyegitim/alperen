// Genel bakış StatTile satırı (BLUEPRINT §7 "Bileşen kullanımı"): durum taşıyan kutu kelimesini de yazar.
import { hours } from './format';
import type { OverviewTiles } from './data/types';

export const RESPONSE_TARGET_HOURS = 2;

export function tileProps(tiles: OverviewTiles, targetHours = RESPONSE_TARGET_HOURS) {
  return [
    {
      label: 'Cevapsız soru',
      value: tiles.unanswered,
      ...(tiles.unanswered > 0 ? { status: 'danger' as const, statusText: 'Acil' } : {}),
    },
    {
      label: 'Sessiz öğrenci',
      value: tiles.silent,
      ...(tiles.silent > 0 ? { status: 'warning' as const, statusText: 'Dikkat' } : {}),
    },
    { label: 'Yaklaşan teslim', value: tiles.deadlines },
    tiles.response_hours === null
      ? { label: 'Ort. yanıt süresi', value: '—', hint: 'henüz ölçülmedi' }
      : {
          label: 'Ort. yanıt süresi',
          value: hours(tiles.response_hours),
          status: tiles.response_hours <= targetHours ? ('success' as const) : ('warning' as const),
          statusText: tiles.response_hours <= targetHours ? 'Hedefte' : 'Dikkat',
          hint: `hedef ${targetHours} saat`,
        },
  ];
}

