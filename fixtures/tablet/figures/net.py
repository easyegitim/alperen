"""Ağ erişimi deniyor: AST ön denetimi `socket` içe alımını reddetmeli (render edilmez)."""
import socket

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

baglanti = socket.create_connection(("example.org", 80), timeout=1)
fig = plt.figure(figsize=(8, 4), dpi=100)
plt.plot([0, 1], [0, 1])
fig.savefig("figure.png")
