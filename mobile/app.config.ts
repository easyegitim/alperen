import type { ExpoConfig } from "expo/config";

// SPEC-MOBILE M1/M8. Mağaza kimlikleri (bundle id / package) ürün adı kesinleşince değiştirilir (SPEC 21.1).
const config: ExpoConfig = {
  name: "Aura",
  slug: "aura",
  scheme: "aura",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: "com.easyegitim.aura",
    supportsTablet: false,
    infoPlist: {
      NSCameraUsageDescription: "Selfie'ni analiz etmek için kameraya erişim gerekir. Fotoğrafın saklanmaz.",
      NSPhotoLibraryUsageDescription: "Galeriden selfie seçmek için erişim gerekir. Fotoğrafın saklanmaz.",
      ITSAppUsesNonExemptEncryption: false,
    },
    // SPEC-MOBILE M8: Apple gizlilik manifestosu. Takip yok (ATT istenmez); yüz tanıma yok. Fotoğraf cihazda ve istekte
    // geçici işlenir, saklanmaz (Apple tanımına göre "toplanan veri" değildir). Veri türleri docs/store-submission.md ile aynı.
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      NSPrivacyCollectedDataTypes: [
        { NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeEmailAddress", NSPrivacyCollectedDataTypeLinked: true, NSPrivacyCollectedDataTypeTracking: false, NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"] },
        { NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeUserID", NSPrivacyCollectedDataTypeLinked: true, NSPrivacyCollectedDataTypeTracking: false, NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"] },
        { NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypePurchaseHistory", NSPrivacyCollectedDataTypeLinked: true, NSPrivacyCollectedDataTypeTracking: false, NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"] },
        { NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeOtherUserContent", NSPrivacyCollectedDataTypeLinked: true, NSPrivacyCollectedDataTypeTracking: false, NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"] },
        { NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeProductInteraction", NSPrivacyCollectedDataTypeLinked: false, NSPrivacyCollectedDataTypeTracking: false, NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAnalytics"] },
        { NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeCrashData", NSPrivacyCollectedDataTypeLinked: false, NSPrivacyCollectedDataTypeTracking: false, NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"] },
        { NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypePerformanceData", NSPrivacyCollectedDataTypeLinked: false, NSPrivacyCollectedDataTypeTracking: false, NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"] },
      ],
      NSPrivacyAccessedAPITypes: [
        { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults", NSPrivacyAccessedAPITypeReasons: ["CA92.1"] },
        { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryFileTimestamp", NSPrivacyAccessedAPITypeReasons: ["C617.1"] },
        { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategorySystemBootTime", NSPrivacyAccessedAPITypeReasons: ["35F9.1"] },
        { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryDiskSpace", NSPrivacyAccessedAPITypeReasons: ["E174.1"] },
      ],
    },
  },
  android: {
    package: "com.easyegitim.aura",
    adaptiveIcon: {
      backgroundColor: "#0a0a0a",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    permissions: ["android.permission.CAMERA"],
    // SPEC-MOBILE M8: kullanılmayan izinler paketten çıkarılır (bağımlılıkların eklediği dahil).
    blockedPermissions: ["android.permission.RECORD_AUDIO", "android.permission.READ_EXTERNAL_STORAGE", "android.permission.WRITE_EXTERNAL_STORAGE", "android.permission.ACCESS_COARSE_LOCATION", "android.permission.ACCESS_FINE_LOCATION"],
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    [
      "react-native-vision-camera",
      {
        cameraPermissionText: "Selfie'ni analiz etmek için kameraya erişim gerekir. Fotoğrafın saklanmaz.",
        enableFrameProcessors: true,
        enableCodeScanner: false,
      },
    ],
    ["expo-image-picker", { photosPermission: "Galeriden selfie seçmek için erişim gerekir. Fotoğrafın saklanmaz." }],
    "./plugins/withMediapipeModels.js",
    // Sentry: kaynak haritası yüklemesi yalnız SENTRY_AUTH_TOKEN/ORG/PROJECT verilince; DSN yoksa SDK başlatılmaz (src/lib/monitoring.ts)
    ["@sentry/react-native/expo", { organization: process.env.SENTRY_ORG, project: process.env.SENTRY_PROJECT }],
  ],
  experiments: { typedRoutes: true },
  extra: { eas: { projectId: process.env.EAS_PROJECT_ID ?? "" } },
};

export default config;
