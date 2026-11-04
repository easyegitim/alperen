// app/globals.css ile aynı gri tonlu tema (oklch → yaklaşık sRGB). Açık/koyu, kontrast AA.
import { useColorScheme } from "react-native";

export type Palette = {
  background: string;
  foreground: string;
  card: string;
  primary: string;
  primaryForeground: string;
  muted: string;
  mutedForeground: string;
  border: string;
  destructive: string;
  ring: string;
  // v2 tasarım sistemi (app/globals.css PR #33 ile aynı adlar; oklch → yaklaşık sRGB). Her iki mobil iz bunları kullanır.
  /** Marka vurgusu (butonlar, halka, ilerleme). */
  brand: string;
  /** Marka vurgusunun yumuşak zemini (çip, rozet). */
  brandSoft: string;
  /** Kart üstü yüzey (elevated). */
  elevated: string;
  success: string;
  warn: string;
  info: string;
  /** Çubuk/halka arka izi (track). */
  track: string;
  /** Kilitli / silik katman (kilitli skor çubuğu, hayalet kılavuz). */
  overlay: string;
};

export const palettes: Record<"light" | "dark", Palette> = {
  light: {
    background: "#ffffff",
    foreground: "#0a0a0a",
    card: "#ffffff",
    primary: "#171717",
    primaryForeground: "#fafafa",
    muted: "#f5f5f5",
    mutedForeground: "#737373",
    border: "#e5e5e5",
    destructive: "#dc2626",
    ring: "#a3a3a3",
    brand: "#6d4fd6",
    brandSoft: "#ece7fb",
    elevated: "#ffffff",
    success: "#15803d",
    warn: "#b45309",
    info: "#1d4ed8",
    track: "#e5e5e5",
    overlay: "rgba(10,10,10,0.35)",
  },
  dark: {
    background: "#0a0a0a",
    foreground: "#fafafa",
    card: "#171717",
    primary: "#e5e5e5",
    primaryForeground: "#171717",
    muted: "#262626",
    mutedForeground: "#a3a3a3",
    border: "rgba(255,255,255,0.10)",
    destructive: "#ef4444",
    ring: "#737373",
    brand: "#9b86ea",
    brandSoft: "#2a2342",
    elevated: "#1f1f1f",
    success: "#4ade80",
    warn: "#fbbf24",
    info: "#60a5fa",
    track: "#262626",
    overlay: "rgba(250,250,250,0.35)",
  },
};

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const radius = { sm: 8, md: 10, lg: 14, xl: 20, full: 999 } as const;
/** Erişilebilirlik: dokunma hedefi en az 44 pt (CLAUDE.md / SPEC-MOBILE). */
export const touchTarget = 44;
/** Yazı ölçeği (web --text-* ile uyumlu, pt). */
export const typeScale = { display: 56, title: 28, heading: 20, body: 16, small: 13, caption: 12 } as const;
/** Hareket süreleri (ms); prefers-reduced-motion'a karşılık RN AccessibilityInfo.isReduceMotionEnabled ile kapatılır. */
export const motion = { fast: 200, base: 400, slow: 900 } as const;

export function useTheme(): { colors: Palette; scheme: "light" | "dark" } {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return { colors: palettes[scheme], scheme };
}
