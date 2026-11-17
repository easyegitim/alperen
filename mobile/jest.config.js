module.exports = {
  preset: "jest-expo",
  // Kök lib/ dosyaları babel ile dönüştürülürken @babel/runtime yardımcıları mobilin node_modules'ından çözülür.
  moduleDirectories: ["node_modules", "<rootDir>/node_modules"],
  setupFiles: ["<rootDir>/tests/setup/asyncStorage.js"],
  testMatch: ["<rootDir>/tests/**/*.test.ts", "<rootDir>/tests/**/*.test.tsx"],
  transformIgnorePatterns: ["node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg)"],
};
