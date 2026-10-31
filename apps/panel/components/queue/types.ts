import type { StaffContext } from '../../lib/shell';

/** Kuyrukta seçili kalemin tek birincil eylemi; sayfa bunu tek bir primary düğmeyle çizer (sayfada en fazla bir primary). */
export interface PrimaryAction {
  label: string;
  disabled: boolean;
  hint?: string;
  run: () => Promise<boolean>;
}

export interface DetailProps<D> {
  ctx: StaffContext;
  detail: D;
  setPrimary: (a: PrimaryAction | null) => void;
  /** karar sonrası liste yenilenir */
  onDone: (message: string) => void;
}
