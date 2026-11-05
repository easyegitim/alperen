// expo-router typed routes (.expo/types/router.d.ts) üretimi; tsc'den önce çalışır ki CI'da da sıkı rota tipleri geçerli olsun.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
process.env.EXPO_ROUTER_APP_ROOT = path.resolve("app");
mkdirSync(path.resolve(".expo/types"), { recursive: true });
const m = require("@expo/router-server/build/typed-routes");
m.regenerateDeclarations(path.resolve(".expo/types"), {});
// regenerateDeclarations debounce'ludur; süreç bitmeden yazılması için kısa bekleme.
await new Promise((r) => setTimeout(r, 300));
console.log("typed routes güncellendi");
