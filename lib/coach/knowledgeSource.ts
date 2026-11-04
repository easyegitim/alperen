import { METHOD_FILES } from "@/content/methods";
import { CatalogKnowledgeSource, MethodsKnowledgeSource, type KnowledgeSource } from "./knowledge";

// Plan üretiminin tek bilgi tabanı girişi (PLAN Faz 0): yöntem dosyası varsa MethodsKnowledgeSource (katalog + kütüphane),
// yoksa CatalogKnowledgeSource. Saf; paylaşılan.
export function getKnowledgeSource(files = METHOD_FILES): KnowledgeSource {
  return files.length > 0 ? new MethodsKnowledgeSource(files) : new CatalogKnowledgeSource();
}
