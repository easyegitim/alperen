// tests/fixtures/landmarks/*.json üretir: sentetik 478 nokta (normalize), gerçek yüz değildir.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SHAPE_PARAMS, normalize, syntheticFace } from "../tests/helpers/syntheticFace";

const dir = path.resolve(import.meta.dirname, "..", "tests", "fixtures", "landmarks");
mkdirSync(dir, { recursive: true });
for (const [shape, params] of Object.entries(SHAPE_PARAMS)) {
  const pts = normalize(syntheticFace({ ...params, cx: 360, cy: 480 }), 720, 960);
  const fixture = {
    note: "Sentetik; gerçek bir yüz değildir. scripts/gen-landmark-fixtures.ts ile üretildi.",
    expectedShape: shape,
    width: 720,
    height: 960,
    landmarks: pts.map((p) => [Number(p.x.toFixed(5)), Number(p.y.toFixed(5))]),
  };
  writeFileSync(path.join(dir, `${shape}.json`), JSON.stringify(fixture));
  console.log(`${shape}.json`);
}
