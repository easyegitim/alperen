// live derlemesinde lib/data/mock.ts yerine bu dosya paketlenir (next.config.mjs NormalModuleReplacementPlugin).
// Yerel veri (fixtures/db/dev-seed.json: cevap anahtarları, kimlik verileri, veli kodları) üretim paketine girmez.
import { PanelError } from '../errors';
import type { DataSource, StaffRole } from './types';

export const MOCK_NOW = '1970-01-01T00:00:00Z';

export function createMockDataSource(_opts: { role?: StaffRole } = {}): DataSource {
  throw new PanelError('PANEL-NET', 'yerel veri kaynağı bu derlemede yok (NEXT_PUBLIC_DATA_SOURCE=live)');
}
