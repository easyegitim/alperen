// MediaPipe varlıklarını public/mediapipe altına hazırlar (SPEC 7.1: çalışma zamanında CDN bağımlılığı yok).
// WASM: node_modules/@mediapipe/tasks-vision/wasm → public/mediapipe/wasm
// Modeller: Google'ın yayınladığı sürümler (Apache-2.0, docs/licenses.md) → public/mediapipe
import { createWriteStream } from "node:fs";
import { access, copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "public", "mediapipe");
const WASM_SRC = path.join(ROOT, "node_modules", "@mediapipe", "tasks-vision", "wasm");
// *_module_* dosyaları ES modülü worker'lar içindir (FilesetResolver.forVisionTasks(base, useModule=true)).
const WASM_FILES = [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
  "vision_wasm_module_internal.js",
  "vision_wasm_module_internal.wasm",
];
const MODELS = [
  {
    file: "face_landmarker.task",
    url: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
    minBytes: 3_000_000,
  },
  {
    file: "selfie_multiclass_256x256.tflite",
    url: "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite",
    minBytes: 10_000_000,
  },
];

async function exists(p, minBytes = 1) {
  try {
    await access(p);
    return (await stat(p)).size >= minBytes;
  } catch {
    return false;
  }
}

await mkdir(path.join(OUT, "wasm"), { recursive: true });
for (const f of WASM_FILES) {
  await copyFile(path.join(WASM_SRC, f), path.join(OUT, "wasm", f));
}
console.log(`wasm: ${WASM_FILES.length} dosya kopyalandı`);

for (const m of MODELS) {
  const dest = path.join(OUT, m.file);
  if (await exists(dest, m.minBytes)) {
    console.log(`${m.file}: mevcut`);
    continue;
  }
  const res = await fetch(m.url);
  if (!res.ok || !res.body) throw new Error(`${m.file} indirilemedi: HTTP ${res.status}`);
  await pipeline(res.body, createWriteStream(dest));
  const size = (await stat(dest)).size;
  if (size < m.minBytes) throw new Error(`${m.file} eksik indi (${size} bayt)`);
  console.log(`${m.file}: ${(size / 1e6).toFixed(1)} MB indirildi`);
}
