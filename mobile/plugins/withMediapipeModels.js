// Expo config eklentisi: MediaPipe model dosyalarını native pakete kopyalar (SPEC-MOBILE M4).
// iOS: Xcode projesine kaynak olarak eklenir (Bundle.main.path(forResource:)). Android: app/src/main/assets.
// Dosyalar depoda yoktur; `pnpm --dir mobile setup` indirir. Eksikse prebuild açık hata verir.
const fs = require("node:fs");
const path = require("node:path");
const { withDangerousMod, withXcodeProject, IOSConfig } = require("expo/config-plugins");

// M8: selfie_multiclass_256x256.tflite → modules/aura-segmenter (saç çizgisi).
const MODELS = ["face_landmarker.task", "selfie_multiclass_256x256.tflite"];
const SRC_DIR = path.join(__dirname, "..", "assets", "mediapipe");

function assertModels() {
  for (const m of MODELS) {
    const p = path.join(SRC_DIR, m);
    if (!fs.existsSync(p)) throw new Error(`MediaPipe modeli eksik: ${p} — önce "pnpm --dir mobile setup" çalıştır.`);
  }
}

const withAndroidModels = (config) =>
  withDangerousMod(config, [
    "android",
    (cfg) => {
      assertModels();
      const dest = path.join(cfg.modRequest.platformProjectRoot, "app", "src", "main", "assets");
      fs.mkdirSync(dest, { recursive: true });
      for (const m of MODELS) fs.copyFileSync(path.join(SRC_DIR, m), path.join(dest, m));
      return cfg;
    },
  ]);

const withIosModels = (config) =>
  withXcodeProject(config, (cfg) => {
    assertModels();
    const project = cfg.modResults;
    const projectName = cfg.modRequest.projectName;
    const destDir = path.join(cfg.modRequest.platformProjectRoot, projectName);
    for (const m of MODELS) {
      fs.copyFileSync(path.join(SRC_DIR, m), path.join(destDir, m));
      const filepath = path.join(projectName, m);
      if (!project.hasFile(filepath)) {
        IOSConfig.XcodeUtils.addResourceFileToGroup({ filepath, groupName: projectName, project, isBuildFile: true, verbose: false });
      }
    }
    return cfg;
  });

module.exports = (config) => withIosModels(withAndroidModels(config));
