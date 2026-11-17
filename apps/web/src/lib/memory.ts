// Hafıza dosyalarının okunur adları (docs/PLAN-v2.md §3.2). Yol memory_files.path'tir.

const KNOWN: Record<string, string> = {
  '/memories/profile.md': 'Seni nasıl tanıyorum',
  '/memories/patterns.md': 'Tekrar eden hatalar',
  '/memories/coach_notes.md': 'Sana ne işe yaradı',
  '/memories/goals.md': 'Hedeflerin',
  '/memories/parent_summary.md': 'Velin için özet',
};

/** Okunur başlık; ders dosyaları `courses/<kod>.md` -> "Ders: <kod>". */
export function memoryTitle(path: string): string {
  const known = KNOWN[path];
  if (known) return known;
  const course = /^\/memories\/courses\/([A-Za-z0-9_.-]+)\.md$/.exec(path);
  if (course?.[1]) return `Ders: ${course[1]}`;
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.md$/, '');
}

/** Gösterim sırası: bilinen dosyalar plan sırasında, ders dosyaları ortada, diğerleri sonda; kendi içinde yola göre. */
export function memorySortKey(path: string): string {
  const order = ['/memories/profile.md', '/memories/goals.md', '/memories/patterns.md', '/memories/coach_notes.md'];
  const i = order.indexOf(path);
  if (i >= 0) return `0${i}`;
  if (path.startsWith('/memories/courses/')) return `1${path}`;
  if (path === '/memories/parent_summary.md') return `3${path}`;
  return `2${path}`;
}
