// Bu dosya scripts/tokens-to-css.mjs tarafından tokens.json dosyasından üretilir; elle düzenlenmez.
// Tailwind yapılandırma nesnesi (v3 biçimi, @config ile) ve ham tema değerleri. Tailwind 4 için asıl eşleme src/styles/theme.css içindedir.

export const colorNames = [
  "surface",
  "surface-raised",
  "surface-sunken",
  "paper",
  "line",
  "line-strong",
  "ink",
  "ink-muted",
  "primary",
  "primary-strong",
  "primary-soft",
  "on-primary",
  "navy",
  "on-navy",
  "gold",
  "gold-deep",
  "gold-ink",
  "on-gold",
  "ai-glow",
  "ai-soft",
  "easy-purple",
  "success",
  "success-soft",
  "warning",
  "warning-soft",
  "danger",
  "danger-soft",
  "focus",
  "link"
] as const;

export type ColorName = (typeof colorNames)[number];

/** Çözülmüş ham renk değerleri (takma adlar açılmış). Grafik ve test kodu için. */
export const themeValues: { light: Record<ColorName, string>; dark: Record<ColorName, string> } = {
  "light": {
    "surface": "#f6f8fc",
    "surface-raised": "#ffffff",
    "surface-sunken": "#e9eef8",
    "paper": "#f6f8fc",
    "line": "#d3dbea",
    "line-strong": "#7a86a8",
    "ink": "#051c60",
    "ink-muted": "#4a5578",
    "primary": "#0030a2",
    "primary-strong": "#00247c",
    "primary-soft": "#e3eafc",
    "on-primary": "#ffffff",
    "navy": "#051c60",
    "on-navy": "#ffffff",
    "gold": "#feca6e",
    "gold-deep": "#d69637",
    "gold-ink": "#7a4d00",
    "on-gold": "#051c60",
    "ai-glow": "#579bfa",
    "ai-soft": "#eaf3ff",
    "easy-purple": "#41286c",
    "success": "#0b6e4f",
    "success-soft": "#ddf4ea",
    "warning": "#9a3f00",
    "warning-soft": "#fff0dc",
    "danger": "#b3261e",
    "danger-soft": "#fbe4e1",
    "focus": "#0030a2",
    "link": "#0030a2"
  },
  "dark": {
    "surface": "#070f2e",
    "surface-raised": "#0f1a44",
    "surface-sunken": "#040a22",
    "paper": "#f6f8fc",
    "line": "#26326a",
    "line-strong": "#6c7aae",
    "ink": "#eef2fb",
    "ink-muted": "#a9b4d6",
    "primary": "#7fb0ff",
    "primary-strong": "#a9c9ff",
    "primary-soft": "#13245e",
    "on-primary": "#051c60",
    "navy": "#051c60",
    "on-navy": "#ffffff",
    "gold": "#feca6e",
    "gold-deep": "#d69637",
    "gold-ink": "#feca6e",
    "on-gold": "#051c60",
    "ai-glow": "#6ecff7",
    "ai-soft": "#0b2752",
    "easy-purple": "#41286c",
    "success": "#5fd4a4",
    "success-soft": "#0b3326",
    "warning": "#ffb27a",
    "warning-soft": "#3a2008",
    "danger": "#ff9a8f",
    "danger-soft": "#3d1210",
    "focus": "#6ecff7",
    "link": "#7fb0ff"
  }
};

/** Renkler CSS değişkenine bağlıdır; tema [data-theme] ile değişir. */
export const colors = Object.fromEntries(colorNames.map((n) => [n, `var(--og-${n})`])) as Record<ColorName, string>;

export const fontFamily = {
  sans: 'var(--og-font-sans)',
  mono: 'var(--og-font-mono)',
};

export const borderRadius = {
  'sm': 'var(--og-radius-sm)',
  'md': 'var(--og-radius-md)',
  'lg': 'var(--og-radius-lg)',
  'full': 'var(--og-radius-full)',
};

export const boxShadow = {
  'sm': 'var(--og-shadow-sm)',
  'lg': 'var(--og-shadow-lg)',
  'ai': 'var(--og-shadow-ai)',
  'focus-ring': 'var(--og-focus-ring)',
};

/** space-N adları Tailwind varsayılan 4px ölçeğiyle örtüşür; adlandırılmış karşılıklar: */
export const spacing = {
  'space-1': '4px',
  'space-2': '8px',
  'space-3': '12px',
  'space-4': '16px',
  'space-6': '24px',
  'space-8': '32px',
  'space-12': '48px',
};

export const fontSize: Record<string, [string, { lineHeight: string; fontWeight: string; letterSpacing?: string }]> = {
  'display': ['48px', { lineHeight: '52px', fontWeight: '700', letterSpacing: '-0.02em' }],
  'title-1': ['32px', { lineHeight: '40px', fontWeight: '600', letterSpacing: '-0.01em' }],
  'title-2': ['24px', { lineHeight: '32px', fontWeight: '600' }],
  'title-3': ['18px', { lineHeight: '26px', fontWeight: '600' }],
  'body-lg': ['18px', { lineHeight: '28px', fontWeight: '400' }],
  'body': ['16px', { lineHeight: '24px', fontWeight: '400' }],
  'label': ['15px', { lineHeight: '20px', fontWeight: '500' }],
  'small': ['14px', { lineHeight: '20px', fontWeight: '400' }],
  'caption': ['12px', { lineHeight: '16px', fontWeight: '500', letterSpacing: '0.02em' }],
  'code': ['14px', { lineHeight: '20px', fontWeight: '400' }],
};

export const theme = { colors, fontFamily, borderRadius, boxShadow, spacing, fontSize };

const preset = { theme: { extend: theme } };
export default preset;
