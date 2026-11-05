// Yöntem kütüphanesi dosyaları (PLAN 4e / Sprint 3): scripts/import-methods.ts bir TSV'yi content/methods/<ad>.json'a çevirir;
// dosya buraya eklenince MethodsKnowledgeSource (lib/coach/knowledge.ts) katalogla birlikte AYNI arayüzden sunar.
// Bugün boş: 867 yöntem / 660 kusur dosyaları henüz gelmedi. Örnek fikstür (tests/fixtures/methods-sample.tsv) ÜRÜNE GİRMEZ.
import type { MethodsFile } from "@/lib/coach/knowledge";

export const METHOD_FILES: readonly MethodsFile[] = [];
