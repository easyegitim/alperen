// MediaPipe modellerini indirir (depoya girmez; mobile/.gitignore). Kaynak: Google'ın resmi model deposu.
import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const DIR = path.join(process.cwd(), "assets", "mediapipe");
const MODELS = [
  { file: "face_landmarker.task", url: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task", minBytes: 3_000_000 },
  // M8: saç çizgisi için selfie bölütleme (modules/aura-segmenter). Web ile aynı model (scripts/setup-mediapipe.mjs).
  { file: "selfie_multiclass_256x256.tflite", url: "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite", minBytes: 10_000_000 },
];
mkdirSync(DIR, { recursive: true });
for (const m of MODELS) {
  const dest = path.join(DIR, m.file);
  if (existsSync(dest) && statSync(dest).size >= m.minBytes) {
    console.log(`var: ${m.file}`);
    continue;
  }
  const res = await fetch(m.url);
  if (!res.ok || !res.body) throw new Error(`${m.file} indirilemedi: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  console.log(`indirildi: ${m.file} (${(statSync(dest).size / 1e6).toFixed(1)} MB)`);
}
