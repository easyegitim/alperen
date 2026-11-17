import "server-only";

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { LEGAL_SLUGS, type LegalSlug } from "@/lib/consent";

export type LegalDoc = {
  slug: LegalSlug;
  title: string;
  version: string;
  updatedAt: string; // YYYY-MM-DD
  approved: boolean; // avukat onayı
  body: string; // markdown
};

const DIR = path.join(process.cwd(), "content", "legal");

/** Basit ön madde (frontmatter) ayrıştırıcı: "---" arasında key: value satırları. */
export function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body: m[2] };
}

export function isLegalSlug(s: string): s is LegalSlug {
  return (LEGAL_SLUGS as readonly string[]).includes(s);
}

const cache = new Map<LegalSlug, LegalDoc>();

export async function getLegalDoc(slug: LegalSlug): Promise<LegalDoc> {
  const hit = cache.get(slug);
  if (hit && process.env.NODE_ENV === "production") return hit;
  const raw = await readFile(path.join(DIR, `${slug}.md`), "utf8");
  const { meta, body } = parseFrontmatter(raw);
  if (!meta.version || !meta.title || !meta.updatedAt) {
    throw new Error(`content/legal/${slug}.md: title, version ve updatedAt zorunlu`);
  }
  const doc: LegalDoc = {
    slug,
    title: meta.title,
    version: meta.version,
    updatedAt: meta.updatedAt,
    approved: meta.approved === "true",
    body: body.trim(),
  };
  cache.set(slug, doc);
  return doc;
}

export async function getLegalVersion(slug: LegalSlug): Promise<string> {
  return (await getLegalDoc(slug)).version;
}

export async function listLegalSlugs(): Promise<LegalSlug[]> {
  const files = await readdir(DIR);
  return files.map((f) => f.replace(/\.md$/, "")).filter(isLegalSlug);
}
