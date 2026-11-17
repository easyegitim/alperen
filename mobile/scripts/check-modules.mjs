// CI: yerel Expo modülü (modules/aura-segmenter) her iki platformda autolinking'e giriyor mu? (SPEC-MOBILE M8)
import { execFileSync } from "node:child_process";

const REQUIRED = ["aura-segmenter"];
for (const platform of ["android", "apple"]) {
  const out = execFileSync("npx", ["expo-modules-autolinking", "resolve", "--platform", platform, "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const names = new Set(JSON.parse(out).modules.map((m) => m.packageName));
  for (const r of REQUIRED) {
    if (!names.has(r)) {
      console.error(`autolinking (${platform}): ${r} bulunamadı`);
      process.exit(1);
    }
  }
  console.log(`autolinking (${platform}): ${REQUIRED.join(", ")} ✓`);
}
