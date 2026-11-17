// Jest: AsyncStorage native modülü yok; resmi bellek içi mock (analitik izni testleri için).
jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
