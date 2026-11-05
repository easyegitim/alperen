"""Boş görüntü: çizim yok, piksel varyansı ≈ 0 → boyut denetiminde reddedilmeli."""
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

fig = plt.figure(figsize=(8, 4), dpi=100, facecolor="#ffffff")
ax = fig.add_axes([0, 0, 1, 1])
ax.axis("off")
fig.savefig("figure.png", dpi=100, facecolor="#ffffff")
