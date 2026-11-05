"""Sentetik çıkmış sınav arşivi (P4): archive.json → packages/llm/fixtures (sahte taşıma, OGRENMEN_LLM=fake).

Tek doğruluk kaynağı archive.json'dur (2 yıl × 5 soru, TYT Matematik yaprakları, 4 tarz). Bu betik şu fikstürleri yazar:
  exam_page_items/arsiv-<yıl>.json        fake_match ["arşivi: <yıl>", "sayfa 1/1."] → sayfadaki 5 soru (open)
  exam_item_extract/arsiv-<yıl>-<no>.json fake_match ["arşivi: <yıl>", "madde no: <no>."] → exam-item v2
  style_definition/arsiv.json             ilk kümeleme (2024) kümeleri k1..k4 → tarz adı/tanımı
  style_question_gen/arsiv-tarz.json      fake_match ["tarza özel soru isteği"] → 3 doğrulanabilir soru
Kullanım: python3 -I apps/worker/test/fixtures/styles/build.py <depo kökü>
"""
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
here = root / "apps/worker/test/fixtures/styles"
arc = json.loads((here / "archive.json").read_text(encoding="utf-8"))
out = root / "packages/llm/fixtures"
PLACEHOLDER_SOURCE = "00000000-0000-4000-8000-00000000a5c1"
PLACEHOLDER_STYLE = "00000000-0000-4000-8000-00000000a5c2"


def write(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


styles = {s["key"]: s for s in arc["styles"]}
for src in arc["sources"]:
    year = src["year"]
    items = []
    for it in src["items"]:
        items.append({
            "no": it["no"], "section": None, "kind": "open", "stem_text": it["text"], "options": [],
            "continues_from_previous": False, "continues_on_next": False, "figures": [], "legibility": "clear",
        })
    write(out / "exam_page_items" / f"arsiv-{year}.json",
          {"fake_match": [f"arşivi: {year}", "sayfa 1/1."], "output": {"items": items, "page_notes": None, "unreadable": False}})
    for it in src["items"]:
        st = styles[it["style"]]
        write(out / "exam_item_extract" / f"arsiv-{year}-{it['no']}.json", {
            "fake_match": [f"arşivi: {year}", f"madde no: {it['no']}."],
            "output": {
                "schema_version": "1.0", "source_id": PLACEHOLDER_SOURCE, "item_no": it["no"], "topic": st["topic"],
                "kind": "calc", "points": it["points"], "year": year, "term": src["term"], "instructor_alias": None,
                "skill_id": st["skill_ids"][0], "ocr_text": it["text"], "ocr_confidence": 0.95, "format": st["format"],
                "trick": st["trick"], "difficulty": it["difficulty"], "skill_ids": st["skill_ids"],
            },
        })

write(out / "style_definition" / "arsiv.json", {"styles": [
    {"cluster_id": s["first_cluster"], "code": s["code"], "name": s["name"], "description": s["description"],
     "format": s["format"], "trick": s["trick"], "difficulty_band": s["band"], "skill_ids": s["skill_ids"]}
    for s in arc["styles"]
]})

gen = arc["generated"]
write(out / "style_question_gen" / "arsiv-tarz.json", {
    "fake_match": ["tarza özel soru isteği"],
    "output": {
        "items": [{**q["item"], "style_id": PLACEHOLDER_STYLE, "figure": None} for q in gen],
        "keys": [q["key"] for q in gen],
    },
})
print("yazıldı:", out)
