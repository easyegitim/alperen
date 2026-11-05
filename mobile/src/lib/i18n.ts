// Arayüz metinleri kökteki messages/tr.json'dan (CLAUDE.md). next-intl sözdizimiyle uyumlu küçük bir t():
// nokta ile iç içe anahtar, {degisken} yerleştirme. Eksik anahtar geliştirmede görünür olsun diye anahtarın kendisi döner.
import messages from "@/messages/tr.json";

type Dict = { [k: string]: string | Dict };
const root = messages as unknown as Dict; // JSON şeması sabittir; tip daraltması burada yapılır.

export type Vars = Record<string, string | number>;

export function t(key: string, vars?: Vars): string {
  const value = key.split(".").reduce<string | Dict | undefined>((acc, part) => (acc && typeof acc === "object" ? acc[part] : undefined), root);
  if (typeof value !== "string") return key;
  if (!vars) return value;
  return value.replace(/\{(\w+)\}/g, (_, name: string) => (name in vars ? String(vars[name]) : `{${name}}`));
}

/** Alt ağaç için kısayol: const tx = scoped("auth"); tx("linkTitle") */
export function scoped(prefix: string) {
  return (key: string, vars?: Vars) => t(`${prefix}.${key}`, vars);
}
