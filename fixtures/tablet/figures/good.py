"""Kesir modeli: 5/6 ve 1/4 (Tablet render sandbox örneği; çalışma dizinine figure.png yazar)."""
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

PAPER, NAVY, PRIMARY = "#f6f8fc", "#051c60", "#0030a2"
fig, axes = plt.subplots(2, 1, figsize=(8, 4), dpi=100, facecolor=PAPER)
for ax, (pay, payda, etiket) in zip(axes, [(5, 6, "5/6"), (1, 4, "1/4")]):
    ax.set_facecolor(PAPER)
    for i in range(payda):
        renk = PRIMARY if i < pay else PAPER
        ax.add_patch(plt.Rectangle((i / payda, 0), 1 / payda, 1, facecolor=renk, edgecolor=NAVY, linewidth=2))
    ax.set_xlim(0, 1.25)
    ax.set_ylim(-0.1, 1.1)
    ax.text(1.05, 0.5, etiket, fontsize=18, color=NAVY, va="center")
    ax.axis("off")
fig.tight_layout()
fig.savefig("figure.png", dpi=100, facecolor=PAPER)
