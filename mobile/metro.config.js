// Paylaşılan kod depo kökündeki lib/ ve content/ klasörlerinden gelir; Metro'nun izlemesi ve
// bağımlılıkları (zod vb.) kök node_modules'tan çözmesi için watchFolders eklenir.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, "..");
const config = getDefaultConfig(projectRoot);

config.watchFolders = [repoRoot];
config.resolver.nodeModulesPaths = [path.join(projectRoot, "node_modules"), path.join(repoRoot, "node_modules")];
// Kökteki Next.js uygulaması (app/, .next/) mobil paketin parçası değildir.
config.resolver.blockList = [new RegExp(`${repoRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/(\\.next|app|components|public|supabase|tests|scripts)/.*`)];

module.exports = config;
