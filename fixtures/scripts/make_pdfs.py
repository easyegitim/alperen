#!/usr/bin/env python3
"""Sentetik PDF fixture'larını matplotlib ile üretir (metin seçilebilir: pdf.fonttype=42).

  python fixtures/scripts/make_pdfs.py

  fixtures/kalem/exam-2022.pdf   3 sayfalık sentetik sınav (kalem/ocr-2022.json'daki maddeler)
  fixtures/kitap/sample.pdf      2 sayfalık sentetik makale (Unpaywall sahtesinin döndürdüğü açık erişim PDF)

Çıktı deterministiktir: oluşturma tarihi ve üretici bilgisi yazılmaz.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

os.environ.setdefault("SOURCE_DATE_EPOCH", "1791763200")  # 2026-10-12T00:00:00Z

import matplotlib  # noqa: E402

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.backends.backend_pdf import PdfPages  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
import kalem  # noqa: E402
from fxlib import FIX  # noqa: E402

matplotlib.rcParams.update({"pdf.fonttype": 42, "font.family": "DejaVu Sans", "svg.hashsalt": "ogrenmen"})

SAMPLE = [
    ["Aralıklı tekrar ve matematik öğrenimi (sentetik örnek metin)",
     "Bu belge Öğrenmen test fixture'ıdır; gerçek bir yayın değildir.",
     "",
     "Özet: Aynı çalışma süresi tek oturuma toplanmak yerine günlere yayıldığında,",
     "öğrencilerin bir hafta sonraki testte daha çok soruyu doğru çözdüğü görülür.",
     "Karışık sıralanmış problem setleri, aynı türün art arda çözülmesine göre",
     "gecikmeli testte daha iyi sonuç verir.",
     "",
     "1. Yöntem: 40 öğrenci iki gruba ayrıldı; bir grup kesir toplama sorularını",
     "tek günde, diğeri üç güne yayarak çözdü."],
    ["2. Bulgular: Aralıklı çalışan grup gecikmeli testte daha yüksek doğruluk gösterdi.",
     "3. Sınırlılıklar: Örneklem küçüktür ve tek bir konu (kesirler) incelenmiştir.",
     "",
     "Kaynakça (örnek):",
     "Cepeda ve diğerleri (2006). Distributed practice in verbal recall tasks.",
     "Rohrer ve Taylor (2007). The shuffling of mathematics problems improves learning."],
]


def write_pdf(path: Path, pages: list[list[str]], title: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    meta = {"Title": title, "Author": "Öğrenmen fixtures", "Creator": None, "Producer": None, "CreationDate": None}
    with PdfPages(path, metadata=meta) as pdf:
        for lines in pages:
            fig = plt.figure(figsize=(8.27, 11.69))  # A4
            y = 0.92
            for i, line in enumerate(lines):
                fig.text(0.08, y, line, fontsize=13 if i == 0 else 11, weight="bold" if i == 0 else "normal",
                         wrap=True)
                y -= 0.045
            pdf.savefig(fig)
            plt.close(fig)


def main() -> int:
    write_pdf(FIX / "kalem" / "exam-2022.pdf", kalem.exam_pages(), "DEMO 2022 Final (sentetik)")
    write_pdf(FIX / "kitap" / "sample.pdf", SAMPLE, "Aralıklı tekrar (sentetik)")
    print("PDF'ler yazıldı")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
