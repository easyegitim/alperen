// `?raw` içe aktarımı: Markdown dosyası dize olarak gelir (next.config.mjs asset/source kuralı; vitest'te Vite ?raw).
declare module '*.md?raw' {
  const text: string;
  export default text;
}
