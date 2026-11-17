"""Teşhis DIAG-2026.1-19 şekli: 400 TL, önce %25 zam, sonra %10 indirim (çubuk grafik). seed=2026; deterministik.

Çalıştırma: python yuzde-grafik-19.py [çıktı.png]  (varsayılan: bu dosyanın yanındaki yuzde-grafik-19.png)
"""

import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

SEED = 2026
PAPER, NAVY, PRIMARY, TINT, GRID = "#f6f8fc", "#051c60", "#0030a2", "#c9d6f2", "#d3dbea"
BARS = [("Başlangıç", 400, "400 TL"), ("1. adım", 500, "%25 zam"), ("2. adım", 450, "%10 indirim")]


def build():
    np.random.seed(SEED)
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 15})
    fig = plt.figure(figsize=(8.0, 5.0), dpi=100, facecolor=PAPER)
    ax = fig.add_axes((0.1, 0.16, 0.86, 0.76))
    ax.set_facecolor(PAPER)
    values = [v for _, v, _ in BARS]
    rects = ax.bar(range(len(BARS)), values, color=[PRIMARY, TINT, TINT], edgecolor=NAVY, linewidth=2, width=0.6)
    for rect, (_, _, text) in zip(rects, BARS, strict=True):
        ax.text(rect.get_x() + rect.get_width() / 2, rect.get_height() * 1.02, text, ha="center", va="bottom",
                color=NAVY, fontsize=15, fontweight="bold")
    ax.set_xticks(range(len(BARS)), [label for label, _, _ in BARS], color=NAVY, fontsize=15)
    ax.set_ylim(0, max(values) * 1.25)
    ax.set_ylabel("Fiyat (TL)", color=NAVY, fontsize=15)
    ax.tick_params(axis="y", colors=NAVY, labelsize=14)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(NAVY)
    ax.grid(axis="y", color=GRID, lw=1)
    ax.set_axisbelow(True)
    return fig


if __name__ == "__main__":
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).with_suffix(".png")
    build().savefig(out, dpi=100, facecolor=PAPER, metadata={"Software": None})
