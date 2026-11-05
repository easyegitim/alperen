"""Teşhis DIAG-2026.1-15 şekli: -2 ile 8 arası sayı doğrusu, A noktası 3. seed=2026; deterministik.

Çalıştırma: python sayi-dogrusu-15.py [çıktı.png]  (varsayılan: bu dosyanın yanındaki sayi-dogrusu-15.png)
"""

import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

SEED = 2026
PAPER, NAVY, PRIMARY = "#f6f8fc", "#051c60", "#0030a2"
LO, HI, POINT = -2, 8, 3


def build():
    np.random.seed(SEED)
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 15})
    fig = plt.figure(figsize=(8.0, 2.2), dpi=100, facecolor=PAPER)
    ax = fig.add_axes((0.03, 0.05, 0.94, 0.9))
    ax.set_xlim(LO - 0.8, HI + 0.8)
    ax.set_ylim(-1.2, 1.2)
    ax.axis("off")
    ax.annotate("", xy=(HI + 0.75, 0), xytext=(LO - 0.75, 0), arrowprops={"arrowstyle": "<|-|>", "color": NAVY, "lw": 2})
    for n in range(LO, HI + 1):
        ax.plot([n, n], [-0.12, 0.12], color=NAVY, lw=1.5)
        ax.text(n, -0.55, str(n).replace("-", "−"), ha="center", va="center", color=NAVY, fontsize=15)
    ax.plot([POINT], [0], marker="o", markersize=13, color=PRIMARY, zorder=5)
    ax.text(POINT, 0.55, "A", ha="center", va="center", color=NAVY, fontsize=16, fontweight="bold")
    return fig


if __name__ == "__main__":
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).with_suffix(".png")
    build().savefig(out, dpi=100, facecolor=PAPER, metadata={"Software": None})
