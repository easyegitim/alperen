"""Kalem fixture'ları: DEMO kursu, sınav kaynakları (1 uploaded + 1 ocr_done), sahte OCR çıktıları (exam-item
dizileri), izlence ve 3 sayfalık sentetik sınav PDF'i için soru metinleri.

Sorular özgün ve sentetiktir (gerçek bir sınavdan kopya değildir)."""

from __future__ import annotations

from typing import Any

from content import sk
from fxlib import CURRICULUM_ID, STAFF, uid

COURSE_ID = uid("course", "DEMO")
SRC_2022 = uid("exam_source", "DEMO:2022")
SRC_2023 = uid("exam_source", "DEMO:2023")

# (no, konu, tür, puan, kazanım, OCR metni)
EXAM_2022: list[tuple[int, str, str, float, str | None, str]] = [
    (1, "Rasyonel sayılar", "calc", 10, "temel.rasyonel-sayilar",
     "1) (2/3 + 5/6) - 3/4 işleminin sonucunu en sade kesir olarak bulunuz."),
    (2, "Yüzde problemleri", "mc", 5, "problem.yuzde",
     "2) Etiket fiyatı 250 TL olan bir montun fiyatına önce %20 indirim, sonra %10 zam yapılıyor. Son fiyat kaç TL'dir? "
     "A) 220 B) 225 C) 230 D) 240"),
    (3, "Mutlak değer", "calc", 10, "cebir.mutlak-deger",
     "3) |2x - 3| = 7 denklemini sağlayan x değerlerinin toplamını bulunuz."),
    (4, "İrrasyonel sayılar ispatı", "proof", 15, None,
     "4) Karekök 2 sayısının iki tam sayının oranı olarak yazılamayacağını gösteriniz."),
    (5, "Üslü ifadeler", "mc", 5, "temel.uslu",
     "5) (3^5 · 3^-2) / 3^2 ifadesinin değeri kaçtır? A) 1 B) 3 C) 9 D) 27"),
]
EXAM_2023: list[tuple[int, str, str, float, str | None, str]] = [
    (1, "Rasyonel sayılar", "calc", 10, "temel.rasyonel-sayilar",
     "1) 7/8 - (1/2 + 1/8) işleminin sonucunu en sade kesir olarak bulunuz."),
    (2, "Yüzde problemleri", "mc", 5, "problem.yuzde",
     "2) Maliyeti 120 TL olan bir ürün %25 kârla satılıyor. Satış fiyatı kaç TL'dir? A) 140 B) 145 C) 150 D) 160"),
    (3, "Birinci dereceden denklem", "calc", 10, "cebir.denklem",
     "3) (x - 1)/2 + x/3 = 4 denklemini çözünüz."),
    (4, "Tek ve çift sayılar ispatı", "proof", 15, None,
     "4) Herhangi iki tek tam sayının toplamının çift olduğunu gösteriniz."),
    (5, "Oran orantı", "other", 5, "cebir.oran-oranti",
     "5) 6 musluk bir havuzu 8 saatte dolduruyor. Aynı musluklardan 4 tanesi bu havuzu kaç saatte doldurur?"),
]


def course() -> dict[str, Any]:
    return {"id": COURSE_ID, "code": "DEMO", "curriculum_id": CURRICULUM_ID, "title": "Deneme dersi · TYT Matematik",
            "instructor_alias": "hoca-A"}


def exam_sources() -> list[dict[str, Any]]:
    """1 `uploaded` (kalem ingest --queue tüketir; PDF LocalDirStorage ile exam-2022.pdf) + 1 `ocr_done`."""
    return [
        {"id": SRC_2022, "course_id": COURSE_ID, "year": 2022, "term": "final", "instructor_alias": "hoca-A",
         "storage_path": f"exams/{SRC_2022}.pdf", "legal_basis": "eğitmenin kendi sınavı",
         "uploaded_by": STAFF["inst"]["id"], "status": "uploaded", "error": None, "created_at": "2026-10-18T14:00:00Z"},
        {"id": SRC_2023, "course_id": COURSE_ID, "year": 2023, "term": "final", "instructor_alias": "hoca-A",
         "storage_path": f"exams/{SRC_2023}.pdf", "legal_basis": "eğitmenin kendi sınavı",
         "uploaded_by": STAFF["inst"]["id"], "status": "ocr_done", "error": None, "created_at": "2026-10-11T14:00:00Z"},
    ]


def _items(rows: list[tuple[int, str, str, float, str | None, str]], source: str, year: int,
           conf: float) -> list[dict[str, Any]]:
    return [{"schema_version": "1.0", "source_id": source, "item_no": no, "topic": topic, "kind": kind,
             "points": pts, "year": year, "term": "final", "instructor_alias": "hoca-A",
             "skill_id": sk(skill) if skill else None, "ocr_text": text, "ocr_confidence": round(conf - no * 0.01, 2)}
            for no, topic, kind, pts, skill, text in rows]


def ocr_2022() -> list[dict[str, Any]]:
    return _items(EXAM_2022, SRC_2022, 2022, 0.97)


def ocr_2023() -> list[dict[str, Any]]:
    return _items(EXAM_2023, SRC_2023, 2023, 0.95)


def syllabus() -> list[dict[str, Any]]:
    return [
        {"week": 1, "topics": ["Rasyonel sayılar", "Ondalık gösterim"],
         "skill_ids": [sk("temel.rasyonel-sayilar"), sk("temel.ondalik")]},
        {"week": 2, "topics": ["Üslü ifadeler", "Köklü ifadeler"], "skill_ids": [sk("temel.uslu"), sk("temel.koklu")]},
        {"week": 3, "topics": ["Birinci dereceden denklem", "Mutlak değer"],
         "skill_ids": [sk("cebir.denklem"), sk("cebir.mutlak-deger")]},
        {"week": 4, "topics": ["Oran orantı", "Yüzde problemleri"],
         "skill_ids": [sk("cebir.oran-oranti"), sk("problem.yuzde")]},
        {"week": 5, "topics": ["Hareket problemleri"], "skill_ids": [sk("problem.hareket")]},
    ]


def exam_pages() -> list[list[str]]:
    """exam-2022.pdf sayfaları (OCR sahtesinin karşılığı): 3 sayfa."""
    head = ["DEMO · TYT Matematik · 2022 Final", "Süre 60 dakika · Toplam 45 puan", ""]
    q = [r[5] for r in EXAM_2022]
    return [head + q[:2], ["DEMO · 2022 Final · sayfa 2", ""] + q[2:4], ["DEMO · 2022 Final · sayfa 3", ""] + q[4:]]
