"""Teşhis DIAG-2026.1-10 şekli: iki kesir modeli (2/3 ve 1/6). seed=2026; deterministik.

Çalıştırma: python kesir-modeli-10.py [çıktı.png]  (varsayılan: bu dosyanın yanındaki kesir-modeli-10.png)
"""

import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.patches import Rectangle  # noqa: E402

SEED = 2026
PAPER, NAVY, PRIMARY = "#f6f8fc", "#051c60", "#0030a2"
MODELS = [(2, 3, "1. model"), (1, 6, "2. model")]  # (boyalı parça, eş parça, etiket)


def build():
    np.random.seed(SEED)
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 15})
    fig = plt.figure(figsize=(8.0, 3.2), dpi=100, facecolor=PAPER)
    ax = fig.add_axes((0.02, 0.02, 0.96, 0.96))
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 4)
    ax.axis("off")
    for idx, (shaded, parts, label) in enumerate(MODELS):
        x0, width, y0, height = 0.4 + idx * 5.0, 4.2, 1.0, 2.0
        step = width / parts
        for i in range(parts):
            ax.add_patch(Rectangle((x0 + i * step, y0), step, height, facecolor=PRIMARY if i < shaded else PAPER,
                                   edgecolor=NAVY, lw=2))
        ax.text(x0 + width / 2, 0.45, label, ha="center", va="center", color=NAVY, fontsize=15)
    return fig


if __name__ == "__main__":
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).with_suffix(".png")
    build().savefig(out, dpi=100, facecolor=PAPER, metadata={"Software": None})
