"""``kalem cluster --course <kod> | --changed`` — madde kümeleri (``exam_clusters``; §6.4).

* Mesafe: ``ocr_text`` gömmelerinin kosinüs mesafesi. **Konu bağı:** aynı normalize ``topic`` ya da aynı
  (boş olmayan) ``skill_id`` taşıyan iki madde arasındaki mesafe 0'dır — OCR'ın çıkardığı konu/kazanım etiketi
  gömmeden güçlü bir kanıttır; ayrıca gömme yokken (sahte vektörler rastgeledir, tavan embedding'i engellediyse
  hiç yoktur) kümeleme bu bağla anlamlı kalır.
* Algoritma: scikit-learn varsa ``AgglomerativeClustering(distance_threshold=0.25, linkage='average')`` (önceden
  hesaplanmış mesafe matrisiyle); yoksa saf numpy **tek bağ**, eşik 0,25 (mesafesi < 0,25 olan çiftler aynı
  bileşen). Küme sırası ve kimlikleri deterministiktir.
* Küme alanları: ``label`` en sık ``topic`` (eşitlikte alfabetik); etiket yasaklı kelime taşıyorsa ya da ham soru
  metninden 12+ karakter kopyalıyorsa (``COPY_WINDOW``; müfredat kazanım adı / izlence başlığıyla birebir aynı
  etiket muaf) kazanım adı, o da olmazsa "Konu kümesi N"; ``kind`` en sık tür, ``skill_id`` en sık kazanım,
  ``item_count``, ``years_hit`` (maddelerin yılları), ``years_total`` (dersin maddesi olan yıl sayısı), ``avg_points``.
* Var olan kümeler en çok ortak maddeye göre yeniden kullanılır (silme yetkisi yok); boşalan küme
  ``item_count=0`` olur. Bitince dersin ``ocr_done`` kaynakları ``clustered`` olur ve dersin
  ``syllabus_topics`` satırı varsa ``align`` otomatik çalışır. Dersin hiç maddesi yoksa da ``ocr_done``
  kaynakları ``clustered`` olur (kümelenecek bir şey kalmadı; ``cluster --changed`` her gece aynı dersi
  yeniden seçmez).
"""

from __future__ import annotations

import sys
from collections import Counter
from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np
from ogrenmen_common.errors import AdapterError, LedgerError

from .common import (
    course_by_id,
    course_items,
    course_sources,
    course_vocabulary,
    curriculum_skills,
    insert_minimal,
    norm_topic,
    now_iso,
    pick_label,
    sort_key_tr,
    stable_uuid,
    update_minimal,
)
from .embed import embed_items
from .kinds import KIND_PRIORITY, normalize_exam_kind

THRESHOLD = 0.25
ALGORITHMS = ("auto", "numpy", "sklearn")


def sklearn_available() -> bool:
    try:
        import sklearn.cluster  # noqa: F401
    except ImportError:
        return False
    return True


def distance_matrix(items: Sequence[Mapping[str, Any]], vectors: Mapping[str, Sequence[float]]) -> np.ndarray:
    """Kosinüs mesafesi (gömmesi olmayan madde herkese 1) + konu bağı (0)."""
    n = len(items)
    dist = np.ones((n, n), dtype=np.float64)
    ids = [str(it["id"]) for it in items]
    have = [i for i, mid in enumerate(ids) if mid in vectors]
    if have:
        mat = np.asarray([vectors[ids[i]] for i in have], dtype=np.float64)
        norms = np.linalg.norm(mat, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        mat = mat / norms
        sub = np.clip(1.0 - mat @ mat.T, 0.0, 2.0)
        idx = np.asarray(have)
        dist[np.ix_(idx, idx)] = sub
    topics = [norm_topic(it.get("topic")) for it in items]
    skills = [it.get("skill_id") or None for it in items]
    for i in range(n):
        for j in range(i + 1, n):
            if (topics[i] and topics[i] == topics[j]) or (skills[i] and skills[i] == skills[j]):
                dist[i, j] = dist[j, i] = 0.0
    np.fill_diagonal(dist, 0.0)
    return dist


def single_link(dist: np.ndarray, threshold: float = THRESHOLD) -> list[int]:
    """Tek bağ: mesafesi ``< threshold`` olan çiftler birleşir (bağlı bileşenler); etiketler ilk görünüş sırası."""
    n = dist.shape[0]
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i in range(n):
        for j in range(i + 1, n):
            if dist[i, j] < threshold:
                ri, rj = find(i), find(j)
                if ri != rj:
                    parent[max(ri, rj)] = min(ri, rj)
    return _relabel([find(i) for i in range(n)])


def average_link_sklearn(dist: np.ndarray, threshold: float = THRESHOLD) -> list[int]:
    from sklearn.cluster import AgglomerativeClustering

    n = dist.shape[0]
    if n < 2:
        return [0] * n
    model = AgglomerativeClustering(n_clusters=None, distance_threshold=threshold, metric="precomputed",
                                    linkage="average")
    return _relabel([int(x) for x in model.fit_predict(dist)])


def _relabel(raw: Sequence[int]) -> list[int]:
    seen: dict[int, int] = {}
    return [seen.setdefault(r, len(seen)) for r in raw]


def assign_labels(dist: np.ndarray, algorithm: str = "auto") -> tuple[list[int], str]:
    if algorithm not in ALGORITHMS:
        raise ValueError(f"algoritma {ALGORITHMS} değerlerinden biri olmalı")
    use_sklearn = algorithm == "sklearn" or (algorithm == "auto" and sklearn_available())
    if use_sklearn:
        return average_link_sklearn(dist), "sklearn-average"
    return single_link(dist), "numpy-single"


def _most_common(values: Sequence[Any], key=None) -> Any:  # noqa: ANN001
    counts = Counter(v for v in values if v not in (None, ""))
    if not counts:
        return None
    best = max(counts.values())
    tied = [v for v, c in counts.items() if c == best]
    return sorted(tied, key=key)[0] if key else sorted(tied)[0]


def _kind_of(members: Sequence[Mapping[str, Any]]) -> str:
    kinds = [normalize_exam_kind(m.get("kind")) for m in members]
    return _most_common(kinds, key=KIND_PRIORITY.index)


def cluster_label(members: Sequence[Mapping[str, Any]], all_texts: Sequence[str], skills: Mapping[str, Mapping],
                  skill_id: str | None, ordinal: int, vocabulary: set[str] | frozenset[str] = frozenset()) -> str:
    """En sık konu; yasaklı kelime taşıyorsa ya da ham metinden kopya ise kazanım adı, o da olmazsa
    ``Konu kümesi N``."""
    topics = [str(m.get("topic") or "").strip() for m in members]
    label = _most_common(topics, key=sort_key_tr)
    candidates = [label]
    if skill_id and skill_id in skills:
        candidates.append(skills[skill_id].get("name"))
    chosen, _ = pick_label(candidates, all_texts, vocabulary, f"Konu kümesi {ordinal}")
    return chosen


def _mark_clustered(db: Any, sources: Sequence[Mapping[str, Any]]) -> None:
    for src in sources:
        if src.get("status") == "ocr_done":
            update_minimal(db, "exam_sources", {"status": "clustered"}, where={"id": str(src["id"])})


def _years_total(items: Sequence[Mapping[str, Any]]) -> int:
    return len({int(it["_year"]) for it in items})


def cluster_course(rt: Any, course: Mapping[str, Any], *, name_hashes: Sequence[str] = (), algorithm: str = "auto",
                   run_align: bool = True) -> dict[str, Any]:
    db = rt.db
    course_id = str(course["id"])
    sources = course_sources(db, course_id)
    items = course_items(db, course_id, sources=sources)
    summary: dict[str, Any] = {"course_code": course["code"], "items": len(items), "clusters": 0,
                               "years_total": _years_total(items), "algorithm": None, "embedding": "ok"}
    if not items:
        summary["embedding"] = "yok"
        _mark_clustered(db, sources)
        return summary
    try:
        vectors = embed_items(rt, items, name_hashes=name_hashes)
    except (LedgerError, AdapterError) as exc:
        print(f"UYARI: gömme alınamadı, kümeleme yalnız konu bağıyla yapılıyor ({exc.message})", file=sys.stderr)
        vectors, summary["embedding"] = {}, "yok (konu bağı)"
    labels, summary["algorithm"] = assign_labels(distance_matrix(items, vectors), algorithm)
    groups: dict[int, list[dict]] = {}
    for item, lab in zip(items, labels, strict=True):
        groups.setdefault(lab, []).append(item)

    skills = curriculum_skills(db, str(course["curriculum_id"])) if course.get("curriculum_id") else {}
    texts = [str(it.get("ocr_text") or "") for it in items]
    vocabulary = course_vocabulary(db, course)
    years_total = _years_total(items)
    existing = {str(c["id"]): c for c in db.select("exam_clusters", where={"course_id": course_id})}
    taken: set[str] = set()
    now = now_iso(rt.clock)
    item_cluster: dict[str, str] = {}
    for ordinal, lab in enumerate(sorted(groups), start=1):
        members = groups[lab]
        prior = Counter(str(m["cluster_id"]) for m in members
                        if m.get("cluster_id") and str(m["cluster_id"]) in existing and
                        str(m["cluster_id"]) not in taken)
        if prior:
            best = max(prior.values())
            cid = sorted(c for c, n in prior.items() if n == best)[0]
        else:
            cid = stable_uuid("exam_cluster", course_id, str(members[0]["id"]))
            while cid in existing or cid in taken:
                cid = stable_uuid("exam_cluster", course_id, cid)
        taken.add(cid)
        skill_id = _most_common([m.get("skill_id") for m in members if m.get("skill_id") in skills])
        points = [float(m["points"]) for m in members if m.get("points") is not None]
        values = {"label": cluster_label(members, texts, skills, skill_id, ordinal, vocabulary),
                  "kind": _kind_of(members), "curriculum_id": course.get("curriculum_id"), "skill_id": skill_id,
                  "item_count": len(members),
                  "years_hit": sorted({int(m["_year"]) for m in members}), "years_total": years_total,
                  "avg_points": round(sum(points) / len(points), 2) if points else None, "updated_at": now}
        if cid in existing:
            update_minimal(db, "exam_clusters", values, where={"id": cid})
        else:
            insert_minimal(db, "exam_clusters", {"id": cid, "course_id": course_id, **values})
        for m in members:
            item_cluster[str(m["id"])] = cid
    for cid in sorted(set(existing) - taken):
        if existing[cid].get("item_count") or existing[cid].get("years_hit"):
            update_minimal(db, "exam_clusters", {"item_count": 0, "years_hit": [], "years_total": years_total,
                                                 "updated_at": now}, where={"id": cid})
    for item in items:
        new = item_cluster[str(item["id"])]
        if str(item.get("cluster_id") or "") != new:
            update_minimal(db, "exam_items", {"cluster_id": new}, where={"id": str(item["id"])})
    _mark_clustered(db, sources)
    summary["clusters"] = len(groups)
    if run_align and db.select("syllabus_topics", where={"course_id": course_id}, columns=("id",), limit=1):
        from .align import align_course

        summary["alignment"] = align_course(rt, course)
    return summary


def changed_courses(rt: Any) -> list[dict]:
    """``ocr_done`` kaynağı olan dersler (``ingest --queue``'nun ardılı)."""
    ids = sorted({str(s["course_id"]) for s in rt.db.select("exam_sources", where={"status": "ocr_done"},
                                                            columns=("course_id",))})
    return [course_by_id(rt.db, cid) for cid in ids]
