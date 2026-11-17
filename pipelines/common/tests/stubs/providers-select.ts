// Worker sahte sağlayıcısının (apps/worker/test/fakes/providers.ts, M04) seçim kuralının TS ikamesi.
// M04 henüz yokken parite testi bu dosyayı koşar (BLUEPRINT §11: olmayan bağımlılık test/stubs ile ikame edilir).
// Kural (§2.3): dosyalar ada göre sıralanır (Array.prototype.sort varsayılanı), bad-schema*.json dışarıda,
// i = parseInt(sha256(promptText).slice(0, 8), 16) % n. Hash Workers çalışma zamanındaki gibi Web Crypto ile.
//
// Kullanım: bun providers-select.ts <klasör>   (stdin: JSON metin dizisi) → stdout: [{prompt, index, file}]
import { readdirSync, readFileSync } from "node:fs";

export function candidateNames(names: string[]): string[] {
  return names.filter((n) => n.endsWith(".json") && !n.startsWith("bad-schema")).sort();
}

export async function fixtureIndex(promptText: string, n: number): Promise<number> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(promptText));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return parseInt(hex.slice(0, 8), 16) % n;
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  const names = candidateNames(readdirSync(dir));
  const prompts: string[] = JSON.parse(readFileSync(0, "utf8"));
  const out = [];
  for (const prompt of prompts) {
    const index = await fixtureIndex(prompt, names.length);
    out.push({ prompt, index, file: names[index] });
  }
  process.stdout.write(JSON.stringify(out));
}

await main();
