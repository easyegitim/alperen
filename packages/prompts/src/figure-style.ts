/**
 * Kodla figür tasarım sabitleri (docs/PLAN-v2.md §7; packages/design-system tokens.json `paper`, `navy`, `primary`
 * açık, `line-strong`, `line`). Not ve deneme promptları (`notes_generation`, `exam_generation`) bu başlığı
 * (`FIGURE_PREAMBLE`) birebir taşır; model figür kodunu başlığın tanımladığı adlarla yazar ve `figure_code` alanına
 * başlığı koymaz. Worker kodu çalıştırırken başlığı önüne ekler (yerel matplotlib: `python3 -I`, apps/worker/py); gerçek
 * yolda (OGRENMEN_FIGURES=code_execution) model aynı başlığı konteynerde kendisi çalıştırır.
 *
 * Çıktı: `figure_<n>.svg`, 6,4 inç genişlik (100 dpi'da 640 px; Haiku figür denetimi için PNG aynı genişlikte),
 * yazı metin olarak kalır (`svg.fonttype: none`: belgede Lexend ile dizilir), sabit hashsalt ve tarihsiz meta
 * (aynı kod → bayt bayt aynı SVG).
 */

export const FIGURE_DESIGN = {
  paper: '#f6f8fc',
  navy: '#051c60',
  accent: '#0030a2',
  muted: '#7a86a8',
  grid: '#d3dbea',
  font: 'Lexend',
  widthIn: 6.4,
  dpi: 100,
  widthPx: 640,
  /** Figür kodunun içe aktarabileceği modüller (başlıktakiler dahil). */
  modules: ['matplotlib', 'numpy', 'math'],
} as const;

/** Her figür kodunun önüne eklenen Python başlığı (prompt metninde de birebir geçer; test denetler). */
export const FIGURE_PREAMBLE = `import logging
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

logging.getLogger("matplotlib.font_manager").setLevel(logging.ERROR)
PAPER = "${FIGURE_DESIGN.paper}"
NAVY = "${FIGURE_DESIGN.navy}"
ACCENT = "${FIGURE_DESIGN.accent}"
MUTED = "${FIGURE_DESIGN.muted}"
GRID = "${FIGURE_DESIGN.grid}"
plt.rcParams.update({
    "figure.figsize": (${FIGURE_DESIGN.widthIn}, 4.0),
    "figure.dpi": ${FIGURE_DESIGN.dpi},
    "figure.facecolor": PAPER,
    "axes.facecolor": PAPER,
    "savefig.facecolor": PAPER,
    "font.family": ["${FIGURE_DESIGN.font}", "DejaVu Sans"],
    "font.size": 12,
    "text.color": NAVY,
    "axes.labelcolor": NAVY,
    "axes.edgecolor": NAVY,
    "xtick.color": NAVY,
    "ytick.color": NAVY,
    "grid.color": GRID,
    "axes.prop_cycle": matplotlib.cycler(color=[ACCENT, NAVY, MUTED]),
    "lines.linewidth": 2.0,
    "svg.fonttype": "none",
    "svg.hashsalt": "ogrenmen",
})


def save_figure(fig, n):
    fig.savefig(f"figure_{n}.svg", format="svg", metadata={"Date": None})
    plt.close(fig)
`;

/** Figür kodunu çalıştırılacak tam betiğe çevirir (başlık + kod). */
export function figureScript(code: string): string {
  return `${FIGURE_PREAMBLE}\n\n${code.trim()}\n`;
}
