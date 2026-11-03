import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

// Statik önizleme: `bun run preview:build` -> preview/dist
export default defineConfig({
  root,
  base: './',
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { fs: { allow: ['..'] } },
});
