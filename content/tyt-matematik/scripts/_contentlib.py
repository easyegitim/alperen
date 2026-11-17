"""İçerik betiklerinin (validate.py, export-sql.py, seed-keys.py) ortak kitaplığı.

Kaynaklar: BLUEPRINT §2.7, §3.2, §3.4, §3.11, §10. Bu modül veritabanına bağlanmaz; SQL metni üretir.
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter, defaultdict, deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

CONTENT_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = CONTENT_DIR.parents[1]
if str(CONTENT_DIR) not in sys.path:
    sys.path.insert(0, str(CONTENT_DIR))

import templates  # noqa: E402
from templates import _common as C  # noqa: E402

EXPECTED_TAG_COUNT = 27
EXPECTED_ITEM_COUNT = 20
FIGURE_MIN_PX, FIGURE_MAX_PX = C.FIGURE_MIN_PX, C.FIGURE_MAX_PX
LEGAL_KINDS = ("kvkk_aydinlatma", "veli_onayi", "grup_kayit", "ders_kaydi", "kullanim_kosullari")
# "sen" dili denetimi: resmî "siz" hitabı ve çoğul emir kipleri yasak (tasarım sistemi README: sen dili)
_SIZ = re.compile(r"\b(siz|sizin|size|sizi|sizce)\b|(m[ae]n[ıi]z|[ıiuü]n[ıiuü]z)\b", re.IGNORECASE)
_EMOJI = re.compile("[☀-➿⭐-⭕\U0001f000-\U0001faff]")


class ContentError(Exception):
    """Çıkış 1 ile durması gereken içerik hatası."""


# --- Yükleme ---------------------------------------------------------------------------------


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ContentError(f"dosya yok: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ContentError(f"JSON okunamadı: {path}: {exc}") from exc


@dataclass
class Content:
    base: Path
    curriculum: dict[str, Any]
    skills: list[dict[str, Any]]
    prerequisites: list[dict[str, Any]]
    tags: list[dict[str, Any]]
    items: list[dict[str, Any]]
    keys: dict[str, Any] | None

    @property
    def code(self) -> str:
        return f"{self.curriculum['code']}@{self.curriculum['version']}"

    @property
    def skill_map(self) -> dict[str, dict[str, Any]]:
        return {s["id"]: s for s in self.skills}

    @property
    def tag_map(self) -> dict[str, dict[str, Any]]:
        return {t["tag"]: t for t in self.tags}


def load_content(base: Path = CONTENT_DIR, with_keys: bool = True) -> Content:
    keys_path = base / "diagnostic" / "answer-keys.json"
    return Content(
        base=base,
        curriculum=read_json(base / "curriculum.json"),
        skills=read_json(base / "skills.json"),
        prerequisites=read_json(base / "prerequisites.json"),
        tags=read_json(base / "misconception-tags.json"),
        items=read_json(base / "diagnostic" / "items.json"),
        keys=read_json(keys_path) if with_keys and keys_path.exists() else None,
    )


def version_tuple(version: str) -> tuple[int, ...]:
    return tuple(int(p) for p in version.split("."))


# --- Rapor -----------------------------------------------------------------------------------


@dataclass
class Report:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    infos: list[str] = field(default_factory=list)

    def err(self, msg: str) -> None:
        self.errors.append(msg)

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)

    def info(self, msg: str) -> None:
        self.infos.append(msg)

    @property
    def ok(self) -> bool:
        return not self.errors

    def render(self) -> str:
        lines = [f"BİLGİ: {m}" for m in self.infos]
        lines += [f"UYARI: {m}" for m in self.warnings]
        lines += [f"HATA: {m}" for m in self.errors]
        return "\n".join(lines)


# --- Doğrulama -------------------------------------------------------------------------------


def _schema_errors(report: Report, schema_id: str, data: Any, label: str) -> None:
    from ogrenmen_contracts import errors

    for issue in errors(schema_id, data)[:20]:
        report.err(f"{label}: şema ({schema_id}): {issue}")


def prerequisite_graph(prereqs: list[dict[str, Any]]) -> dict[str, set[str]]:
    """kazanım → doğrudan ön koşulları."""
    graph: dict[str, set[str]] = defaultdict(set)
    for edge in prereqs:
        graph[edge["skill_id"]].add(edge["prereq_id"])
    return graph


def transitive_prereqs(graph: dict[str, set[str]], skill: str) -> set[str]:
    seen: set[str] = set()
    stack = list(graph.get(skill, ()))
    while stack:
        node = stack.pop()
        if node not in seen:
            seen.add(node)
            stack.extend(graph.get(node, ()))
    return seen


def find_cycle_nodes(nodes: set[str], prereqs: list[dict[str, Any]]) -> list[str]:
    """Kahn algoritması; döngüde kalan düğümleri döner (boş = asiklik)."""
    indeg = {n: 0 for n in nodes}
    out: dict[str, list[str]] = defaultdict(list)
    for edge in prereqs:
        a, b = edge["prereq_id"], edge["skill_id"]
        if a in indeg and b in indeg:
            out[a].append(b)
            indeg[b] += 1
    queue = deque(sorted(n for n, d in indeg.items() if d == 0))
    visited = 0
    while queue:
        node = queue.popleft()
        visited += 1
        for nxt in out[node]:
            indeg[nxt] -= 1
            if indeg[nxt] == 0:
                queue.append(nxt)
    return sorted(n for n, d in indeg.items() if d > 0)


def check_curriculum(content: Content, report: Report, siblings: list[Path] | None = None) -> None:
    cur = content.curriculum
    _schema_errors(report, "curriculum#/$defs/curriculum", cur, "curriculum.json")
    _schema_errors(report, "curriculum", {"curriculum": cur, "skills": content.skills,
                                          "prerequisites": content.prerequisites}, "müfredat paketi")
    if "status" not in cur:
        report.err("curriculum.json: status zorunlu (draft|active|retired)")
    # aynı code için tam bir active sürüm (content/*/curriculum.json ve versions/*.json anlık görüntüleri)
    actives = [content.code] if cur.get("status") == "active" else []
    for path in siblings or []:
        try:
            other = read_json(path)
        except ContentError as exc:
            report.err(str(exc))
            continue
        if path.resolve() == (content.base / "curriculum.json").resolve():
            continue
        if other.get("code") == cur.get("code") and other.get("status") == "active":
            actives.append(f"{other.get('code')}@{other.get('version')} ({path})")
    if len(actives) != 1:
        report.err(f"{cur.get('code')} için tam bir active sürüm olmalı; bulunan: {actives or 'yok'}")


def check_skills(content: Content, report: Report) -> None:
    ids = [s["id"] for s in content.skills]
    for sid, n in Counter(ids).items():
        if n > 1:
            report.err(f"skills.json: yinelenen kimlik {sid}")
    smap = content.skill_map
    children: dict[str, list[str]] = defaultdict(list)
    for s in content.skills:
        parent = s.get("parent_id")
        if parent is not None:
            if parent not in smap:
                report.err(f"skills.json: {s['id']} → parent_id {parent} yok")
                continue
            children[parent].append(s["id"])
            if not s["id"].startswith(parent + "."):
                report.err(f"skills.json: {s['id']} kimliği ebeveyn önekiyle ({parent}.) başlamalı")
    for s in content.skills:
        if s["is_leaf"] and children.get(s["id"]):
            report.err(f"skills.json: {s['id']} yaprak ama çocukları var")
        if not s["is_leaf"] and not children.get(s["id"]):
            report.err(f"skills.json: {s['id']} düğüm (is_leaf=false) ama çocuğu yok")
        if s.get("parent_id") is None and s["is_leaf"]:
            report.err(f"skills.json: {s['id']} kök kazanım yaprak olamaz (mastery yalnız yapraklarda)")
        for p in ("p_init", "p_learn", "p_guess", "p_slip"):
            if p in s and not 0.001 <= s[p] <= 0.999:
                report.err(f"skills.json: {s['id']}.{p} aralık dışı")
    orders = [s.get("order_no") for s in content.skills if "order_no" in s]
    for o, n in Counter(orders).items():
        if n > 1:
            report.err(f"skills.json: order_no {o} yineleniyor")
    nodes = sum(1 for s in content.skills if not s["is_leaf"])
    leaves = sum(1 for s in content.skills if s["is_leaf"])
    report.info(f"kazanım ağacı: {nodes} düğüm + {leaves} yaprak")


def check_prerequisites(content: Content, report: Report) -> None:
    smap = content.skill_map
    seen = set()
    for e in content.prerequisites:
        pair = (e["skill_id"], e["prereq_id"])
        if pair in seen:
            report.err(f"prerequisites.json: yinelenen kenar {pair}")
        seen.add(pair)
        for side in pair:
            if side not in smap:
                report.err(f"prerequisites.json: {side} skills.json'da yok")
            elif not smap[side]["is_leaf"]:
                report.err(f"prerequisites.json: {side} düğüm kazanım; ön koşul kenarları yapraklar arasındadır")
        if pair[0] == pair[1]:
            report.err(f"prerequisites.json: {pair[0]} kendisinin ön koşulu olamaz")
    cyc = find_cycle_nodes(set(smap), content.prerequisites)
    if cyc:
        report.err(f"prerequisites.json: ön koşul grafında döngü var: {cyc}")


def check_tags(content: Content, report: Report) -> None:
    _schema_errors(report, "misconception-tags", content.tags, "misconception-tags.json")
    if len(content.tags) != EXPECTED_TAG_COUNT:
        report.err(f"misconception-tags.json: {EXPECTED_TAG_COUNT} etiket beklenir, {len(content.tags)} var")
    for t, n in Counter(t["tag"] for t in content.tags).items():
        if n > 1:
            report.err(f"misconception-tags.json: yinelenen etiket {t}")
    smap = content.skill_map
    graph = prerequisite_graph(content.prerequisites)
    for t in content.tags:
        name, skill, prereq = t["tag"], t.get("skill_id"), t.get("prereq_skill_id")
        if skill is None:
            if not name.startswith("genel."):
                report.err(f"{name}: skill_id null yalnız genel.* etiketlerde olur")
            if prereq is not None:
                report.err(f"{name}: genel etiket ön koşul taşıyamaz")
        else:
            if name.startswith("genel."):
                report.err(f"{name}: genel.* etiketin skill_id'si null olmalı")
            if skill not in smap:
                report.err(f"{name}: skill_id {skill} yok")
            elif not smap[skill]["is_leaf"]:
                report.err(f"{name}: skill_id {skill} yaprak olmalı")
            if prereq is not None and prereq not in graph.get(skill, set()):
                report.err(f"{name}: prereq_skill_id {prereq}, prerequisites.json'da {skill} kazanımının ön koşulu değil")
        for field_name in ("text_instructor", "text_student"):
            text = t.get(field_name, "")
            if "!" in text or _EMOJI.search(text):
                report.err(f"{name}.{field_name}: ünlem ya da emoji var")
        if _SIZ.search(t.get("text_student", "")):
            report.err(f"{name}.text_student: 'siz' hitabı; öğrenci metni sen dilindedir")
        words = re.findall(r"[a-zçğıöşü]+", t.get("text_instructor", "").lower())
        if not words or not words[-1].endswith("yor"):
            report.err(f"{name}.text_instructor: üçüncü tekil şimdiki zamanla (-yor) bitmeli")


def figure_path(content: Content, rel: str) -> Path:
    return content.base / "diagnostic" / rel


def check_items(content: Content, report: Report) -> None:
    items, smap, tmap = content.items, content.skill_map, content.tag_map
    _schema_errors(report, "diagnostic-test", items, "diagnostic/items.json")
    if '"correct' in json.dumps(items, ensure_ascii=False):
        report.err("diagnostic/items.json: doğru şık alanı (correct*) bulunmamalı")
    if len(items) != EXPECTED_ITEM_COUNT:
        report.err(f"diagnostic/items.json: {EXPECTED_ITEM_COUNT} madde beklenir, {len(items)} var")
    version = content.curriculum["version"]
    graph = prerequisite_graph(content.prerequisites)
    per_skill: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for idx, item in enumerate(items, start=1):
        code = item.get("code")
        expected_code = f"DIAG-{version}-{idx:02d}"
        if code != expected_code:
            report.err(f"madde {idx}: kod {code} ≠ {expected_code} (sabit sıra)")
        allowed_tag_skills: set[str] = set()
        for sid in item.get("skill_ids", []):
            if sid not in smap:
                report.err(f"{code}: kazanım {sid} yok")
                continue
            if not smap[sid]["is_leaf"]:
                report.err(f"{code}: {sid} düğüm kazanım; teşhis yalnız yapraklarda")
            per_skill[sid].append(item)
            allowed_tag_skills |= {sid} | transitive_prereqs(graph, sid)
        for opt in item.get("options", []):
            tag = opt.get("misconception_tag")
            if tag is None:
                continue
            if tag not in tmap:
                report.err(f"{code} {opt['key']}: etiket {tag} misconception-tags.json'da yok")
                continue
            tag_skill = tmap[tag]["skill_id"]
            if tag_skill is not None and tag_skill not in allowed_tag_skills:
                report.err(f"{code} {opt['key']}: etiket {tag} ({tag_skill}) maddenin kazanımına ya da ön koşullarına ait değil")
        texts = [item.get("stem", ""), *(o.get("text", "") for o in item.get("options", []))]
        if item.get("figure"):
            texts.append(item["figure"].get("alt_text", ""))
        if any("!" in t or _EMOJI.search(t) for t in texts):
            report.err(f"{code}: kök, şık ya da şekil metninde ünlem/emoji var (telegram.md)")
        fig = item.get("figure")
        if fig:
            png = figure_path(content, fig["png_path"])
            if not png.exists():
                report.err(f"{code}: şekil dosyası yok: {png}")
            else:
                try:
                    w, h = C.png_size(png)
                except ValueError as exc:
                    report.err(f"{code}: {exc}")
                else:
                    if not (FIGURE_MIN_PX <= w <= FIGURE_MAX_PX and FIGURE_MIN_PX <= h <= FIGURE_MAX_PX):
                        report.err(f"{code}: şekil boyutu {w}×{h} px, {FIGURE_MIN_PX}–{FIGURE_MAX_PX} aralığında olmalı")
            src = fig.get("source_path")
            if not src or not figure_path(content, src).exists():
                report.err(f"{code}: şekli üreten .py kaynağı yok ({src})")
    for prev, cur in zip(items, items[1:], strict=False):
        if set(prev.get("skill_ids", [])) & set(cur.get("skill_ids", [])):
            report.err(f"{prev.get('code')} ve {cur.get('code')}: aynı kazanımın iki maddesi ardışık")
    exempt = set(content.curriculum.get("diagnostic_exempt", []))
    for sid in sorted(exempt):
        if sid not in smap or not smap[sid]["is_leaf"]:
            report.err(f"diagnostic_exempt: {sid} yaprak kazanım değil")
        elif per_skill.get(sid):
            report.warn(f"diagnostic_exempt: {sid} istisna listesinde ama teşhis maddesi var")
    for s in content.skills:
        if s["is_leaf"] and not per_skill.get(s["id"]) and s["id"] not in exempt:
            report.err(f"{s['id']}: teşhis maddesi yok ve diagnostic_exempt listesinde değil")
    for sid, its in per_skill.items():
        diffs = sorted(i["difficulty"] for i in its)
        if len(its) == 1 and diffs != [0.5]:
            report.err(f"{sid}: tek maddenin zorluğu orta (0.5) olmalı")
        if len(its) == 2 and diffs != [0.3, 0.5]:
            report.err(f"{sid}: iki maddeli kazanımda zorluklar 0.5 + 0.3 olmalı")
        if len(its) > 2:
            report.err(f"{sid}: en çok iki teşhis maddesi")
    figured = sum(1 for i in items if i.get("figure"))
    report.info(f"teşhis: {len(items)} madde, {figured} şekilli, istisna {sorted(exempt)}")


def verify_key(item: dict[str, Any], key: dict[str, Any]) -> tuple[str | None, dict[str, Any]]:
    """SymPy doğrulaması: (hata | None, sympy_report)."""
    expr = key.get("canonical_expr")
    if not expr:
        return "canonical_expr yok; teşhis anahtarı SymPy ile doğrulanır", {}
    try:
        value = C.sympify_expr(expr)
        matched = C.match_options(value, item["options"])
    except C.MathParseError as exc:
        return str(exc), {}
    report = {"expr": expr, "value": str(value), "matched_option": matched[0] if len(matched) == 1 else None}
    if matched != [key.get("correct_option")]:
        return f"canonical_expr {expr} = {value}; eşleşen şıklar {matched}, anahtar {key.get('correct_option')}", report
    if key.get("numeric_value") is not None:
        try:
            if not C.values_equal(C.sympify_expr(key["numeric_value"]), value):
                return f"numeric_value {key['numeric_value']} ≠ {value}", report
        except C.MathParseError as exc:
            return str(exc), report
    return None, report


def check_keys(content: Content, report: Report) -> None:
    if content.keys is None:
        report.warn("diagnostic/answer-keys.json yok; anahtar denetimi atlandı (seed-keys.py da SKIP yazar)")
        return
    _schema_errors(report, "diagnostic-keys", content.keys, "diagnostic/answer-keys.json")
    codes = [i.get("code") for i in content.items]
    for code in sorted(set(content.keys) - set(codes)):
        report.err(f"answer-keys.json: {code} için madde yok")
    for item in content.items:
        code = item.get("code")
        key = content.keys.get(code)
        if key is None:
            report.err(f"{code}: cevap anahtarı yok")
            continue
        options = {o["key"]: o for o in item.get("options", [])}
        correct = options.get(key.get("correct_option"))
        if correct is None:
            report.err(f"{code}: doğru şık {key.get('correct_option')} maddede yok")
            continue
        if correct.get("misconception_tag") is not None:
            report.err(f"{code}: doğru şık etiketsiz (null) olmalı")
        distractors = [o for k, o in options.items() if k != key.get("correct_option")]
        tagged = sum(1 for o in distractors if o.get("misconception_tag"))
        if tagged < 2:
            report.err(f"{code}: üç çeldiricinin en az 2'si etiketli olmalı ({tagged})")
        if tagged == len(distractors):
            report.err(f"{code}: en az bir çeldirici etiketsiz (hesap hatası) olmalı")
        if "!" in key.get("solution", "") or _EMOJI.search(key.get("solution", "")):
            report.err(f"{code}: çözüm metninde ünlem/emoji var")
        problem, _ = verify_key(item, key)
        if problem:
            report.err(f"{code}: SymPy: {problem}")


def check_settings(content: Content, report: Report, repo_root: Path) -> None:
    path = repo_root / "supabase" / "seed" / "01_settings.sql"
    if not path.exists():
        report.info("supabase/seed/01_settings.sql yok; period_label ↔ settings.default_period denetimi atlandı")
        return
    try:
        values = sql_insert_rows(path.read_text(encoding="utf-8"), "settings")
    except ContentError as exc:
        report.err(str(exc))
        return
    period = None
    for row in values:
        if row.get("key") == "default_period":
            raw = row.get("value")
            period = json.loads(raw) if isinstance(raw, str) and raw.startswith('"') else raw
    if period is None:
        report.warn("01_settings.sql: default_period satırı bulunamadı")
    elif period != content.curriculum.get("period_label"):
        report.err(f"period_label {content.curriculum.get('period_label')!r} ≠ settings.default_period {period!r}")


def check_dev_seed(content: Content, report: Report, repo_root: Path) -> None:
    """``fixtures/db/dev-seed.json`` (M01) teşhis soruları bizim kimliklerimizle duruyorsa içerikleri aynı mı?

    Farklıysa ``db-test.sh --dev`` (seed/dev → export-sql.py) ``OGR-SEED-003`` ile durur; bu M01 fixture'ının
    ``items.json``'dan yeniden üretilmesini ister. Kendi içeriğimiz geçerli olduğundan uyarıdır, hata değil."""
    path = repo_root / "fixtures" / "db" / "dev-seed.json"
    if not path.exists():
        return
    try:
        rows = read_json(path).get("questions", [])
    except (ContentError, AttributeError):
        report.warn(f"{path}: okunamadı; teşhis sorusu eşitliği denetlenemedi")
        return
    ours = {C.uid("question", i["code"]): i for i in content.items if "code" in i and "options" in i}
    drift = sorted(ours[r["id"]]["code"] for r in rows if isinstance(r, dict) and r.get("id") in ours
                   and r.get("content_hash") != C.content_hash(ours[r["id"]]["stem"], ours[r["id"]]["options"]))
    if drift:
        report.warn(f"fixtures/db/dev-seed.json: {len(drift)} teşhis sorusu aynı kimlikte ama items.json'dan farklı "
                    f"içerikte ({', '.join(drift[:5])}{' …' if len(drift) > 5 else ''}); db-test.sh --dev export "
                    "adımında OGR-SEED-003 verir — M01 fixture'ı items.json'dan yeniden üretilmeli")


def check_templates(content: Content, report: Report, seeds: range = range(2)) -> None:
    import random

    from ogrenmen_contracts import errors

    smap = content.skill_map
    for tid in templates.TEMPLATE_FILES:
        try:
            mod = templates.load(tid)
        except Exception as exc:  # noqa: BLE001
            report.err(f"şablon {tid} yüklenemedi: {exc}")
            continue
        if mod.TEMPLATE_ID != tid:
            report.err(f"şablon {tid}: TEMPLATE_ID {mod.TEMPLATE_ID}")
        if mod.SKILL_ID not in smap or not smap[mod.SKILL_ID]["is_leaf"]:
            report.err(f"şablon {tid}: SKILL_ID {mod.SKILL_ID} yaprak kazanım değil")
        for tag in mod.TAGS:
            if tag not in content.tag_map:
                report.err(f"şablon {tid}: etiket {tag} katalogda yok")
        for seed in seeds:
            try:
                item, key, fig = mod.generate(random.Random(seed))
            except Exception as exc:  # noqa: BLE001
                report.err(f"şablon {tid} seed={seed}: {exc}")
                continue
            for issue in errors("question-item", item)[:5] + errors("answer-key", key)[:5]:
                report.err(f"şablon {tid} seed={seed}: {issue}")
            if (fig is not None) != mod.HAS_FIGURE:
                report.err(f"şablon {tid}: HAS_FIGURE={mod.HAS_FIGURE} ama şekil {'var' if fig else 'yok'}")
            for sid in item["skill_ids"]:
                if sid not in smap:
                    report.err(f"şablon {tid}: kazanım {sid} yok")
            for opt in item["options"]:
                if opt["misconception_tag"] and opt["misconception_tag"] not in content.tag_map:
                    report.err(f"şablon {tid}: etiket {opt['misconception_tag']} katalogda yok")
    report.info(f"şablonlar: {len(templates.TEMPLATE_FILES)} ({', '.join(templates.TEMPLATE_FILES)})")


# --- Sürüm farkı -----------------------------------------------------------------------------


def snapshot_path(base: Path, version: str) -> Path:
    return base / "versions" / f"{version}.json"


def load_skill_ids(path: Path) -> tuple[str | None, set[str]]:
    """Anlık görüntü ({version, skill_ids}) ya da skills.json dizisi."""
    data = read_json(path)
    if isinstance(data, dict):
        return data.get("version"), set(data.get("skill_ids", []))
    return None, {s["id"] for s in data}


def check_version_diff(content: Content, report: Report, previous: Path | None = None) -> None:
    current_ids = {s["id"] for s in content.skills}
    version = content.curriculum["version"]
    own = snapshot_path(content.base, version)
    if own.exists():
        _, snap_ids = load_skill_ids(own)
        if snap_ids != current_ids:
            report.err(f"sürüm {version} içinde kazanım kimlikleri değişti (eklenen {sorted(current_ids - snap_ids)}, "
                       f"kaldırılan {sorted(snap_ids - current_ids)}); yeni kimlik yeni sürüm ister")
    else:
        report.warn(f"versions/{version}.json anlık görüntüsü yok; validate.py --write-snapshot ile oluştur")
    if previous is None:
        older = []
        for path in sorted((content.base / "versions").glob("*.json")):
            try:
                if version_tuple(path.stem) < version_tuple(version):
                    older.append(path)
            except ValueError:
                report.warn(f"versions/{path.name}: sürüm adı okunamadı")
        previous = max(older, key=lambda p: version_tuple(p.stem)) if older else None
    if previous is None:
        report.info(f"sürüm farkı: {version} önceki sürümü olmayan ilk sürüm")
        return
    prev_version, prev_ids = load_skill_ids(previous)
    label = prev_version or previous.name
    added, removed = sorted(current_ids - prev_ids), sorted(prev_ids - current_ids)
    report.info(f"sürüm farkı {label} → {version}: {len(added)} eklenen, {len(removed)} kaldırılan, "
                f"{len(current_ids & prev_ids)} ortak kazanım")
    if added:
        report.info(f"eklenen kazanımlar: {', '.join(added)}")
    for sid in removed:
        report.warn(f"kaldırılan kazanım {sid} ({label} sürümünde vardı; eski mastery satırları dokunulmaz)")


def write_snapshot(content: Content) -> Path:
    path = snapshot_path(content.base, content.curriculum["version"])
    path.parent.mkdir(parents=True, exist_ok=True)
    data = {"code": content.curriculum["code"], "version": content.curriculum["version"],
            "skill_ids": sorted(s["id"] for s in content.skills)}
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def validate_content(content: Content, *, repo_root: Path = REPO_ROOT, previous: Path | None = None,
                     with_templates: bool = True, siblings: list[Path] | None = None) -> Report:
    report = Report()
    if siblings is None:
        siblings = sorted((content.base.parent).glob("*/curriculum.json"))
    check_curriculum(content, report, siblings)
    check_skills(content, report)
    check_prerequisites(content, report)
    check_tags(content, report)
    check_items(content, report)
    check_keys(content, report)
    check_settings(content, report, repo_root)
    check_dev_seed(content, report, repo_root)
    check_version_diff(content, report, previous)
    if with_templates:
        check_templates(content, report)
    return report


# --- SQL yardımcıları ------------------------------------------------------------------------


def q(value: Any) -> str:
    """SQL metin sabiti (standard_conforming_strings=on); None → null."""
    if value is None:
        return "null"
    text = str(value)
    if "\x00" in text:
        raise ContentError("SQL metninde NUL karakteri")
    return "'" + text.replace("'", "''") + "'"


def num(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return repr(value)
    raise ContentError(f"sayı bekleniyor: {value!r}")


def jsonb(value: Any) -> str:
    return q(json.dumps(value, ensure_ascii=False, sort_keys=True)) + "::jsonb"


def text_array(values: list[str]) -> str:
    return "array[" + ", ".join(q(v) for v in values) + "]::text[]"


def uuid_array(values: list[str]) -> str:
    return "array[" + ", ".join(q(v) for v in values) + "]::uuid[]"


def _const(node: Any) -> Any:
    """pglast ifade düğümünden Python değeri (A_Const, TypeCast, A_ArrayExpr); bilinmeyen → ``...``."""
    from pglast import ast

    if isinstance(node, ast.A_Const):
        if node.isnull:
            return None
        val = node.val
        for attr in ("ival", "fval", "sval", "boolval"):
            if hasattr(val, attr):
                out = getattr(val, attr)
                return float(out) if attr == "fval" else out
        return ...
    if isinstance(node, ast.TypeCast):
        return _const(node.arg)
    if isinstance(node, ast.A_ArrayExpr):
        return [_const(e) for e in (node.elements or ())]
    return ...


def sql_insert_rows(sql: str, table: str) -> list[dict[str, Any]]:
    """``insert into [şema.]<table> (...) values (...), ...`` satırlarını sütun adlarıyla döner (pglast)."""
    import pglast
    from pglast import ast

    try:
        stmts = pglast.parse_sql(sql)
    except pglast.parser.ParseError as exc:
        raise ContentError(f"SQL ayrıştırılamadı: {exc}") from exc
    rows: list[dict[str, Any]] = []
    for raw in stmts:
        st = raw.stmt
        if not isinstance(st, ast.InsertStmt) or st.relation.relname != table:
            continue
        cols = [c.name for c in (st.cols or ())]
        select = st.selectStmt
        for values in (select.valuesLists or ()) if select is not None else ():
            rows.append({c: _const(v) for c, v in zip(cols, values, strict=False)})
    return rows


_NO_TABLE = object()


def sql_column_default(sql: str, table: str, column: str) -> Any:
    """``create table <table>`` sütun varsayılanı ve ardından gelen ``alter table … alter column … set/drop default``.

    Dönüş: tablo hiç geçmiyorsa ``_NO_TABLE``; varsayılan yoksa ``None``; sabit değilse ``...``; aksi değer."""
    import pglast
    from pglast import ast
    from pglast.enums import AlterTableType, ConstrType

    value: Any = _NO_TABLE
    for raw in pglast.parse_sql(sql):
        st = raw.stmt
        if isinstance(st, ast.CreateStmt) and st.relation.relname == table:
            value = None
            for el in st.tableElts or ():
                if isinstance(el, ast.ColumnDef) and el.colname == column:
                    for con in el.constraints or ():
                        if con.contype == ConstrType.CONSTR_DEFAULT:
                            value = _const(con.raw_expr)
        elif isinstance(st, ast.AlterTableStmt) and st.relation.relname == table:
            if value is _NO_TABLE:
                value = None
            for cmd in st.cmds or ():
                if cmd.subtype == AlterTableType.AT_ColumnDefault and cmd.name == column:
                    value = None if cmd.def_ is None else _const(cmd.def_)
    return value


# --- Saklama süreleri ve yer tutucular -------------------------------------------------------


@dataclass
class RetentionSource:
    days: dict[str, int]
    tg_chats_retention_days: int | None
    origin: list[str]
    fallback: bool = False


_BP_ROW = re.compile(r"^\|\s*`([a-z_]+(?:\.[a-z_]+)+)`\s*\|[^|]*\|\s*(\d+)\s*\|")
_BP_NOTE = re.compile(r"`([a-z_]+(?:\.[a-z_]+)+)`,\s*(\d+)\)")
_BP_TG = re.compile(r"create table public\.tg_chats\s*\((.*?)\n\);", re.S)
_BP_TG_DAYS = re.compile(r"retention_days\s+smallint\s+not null\s+default\s+(\d+)")


def retention_from_blueprint(blueprint: Path) -> RetentionSource:
    """Yedek kaynak: BLUEPRINT §3.10 saklama tablosu ve §3.5 ``tg_chats`` DDL'i (M02 seed'i yokken)."""
    text = blueprint.read_text(encoding="utf-8")
    start = text.find("### 3.10")
    end = text.find("\n### ", start + 5)
    if start < 0:
        raise ContentError(f"{blueprint}: §3.10 saklama tablosu bulunamadı")
    days: dict[str, int] = {}
    for line in text[start:end].splitlines():
        m = _BP_ROW.match(line)
        if m:
            days[m.group(1)] = int(m.group(2))
            for note_id, note_days in _BP_NOTE.findall(line):
                days.setdefault(note_id, int(note_days))
    tg = None
    m = _BP_TG.search(text)
    if m:
        d = _BP_TG_DAYS.search(m.group(1))
        tg = int(d.group(1)) if d else None
    return RetentionSource(days=days, tg_chats_retention_days=tg, origin=[f"{blueprint} §3.10/§3.5"])


def load_retention(repo_root: Path = REPO_ROOT, seed_path: Path | None = None, migrations_dir: Path | None = None,
                   allow_fallback: bool = True) -> RetentionSource:
    """``supabase/seed/04_retention_policies.sql`` (pglast) + ``tg_chats.retention_days`` varsayılanı (migration).

    Yedek (BLUEPRINT §3.10/§3.5, uyarıyla) yalnız M02 dosyası/dizini **hiç yoksa** ve ``allow_fallback`` açıksa
    kullanılır. Dosya var ama okunamıyorsa (satır yok, ``days`` sabit değil, ``tg_chats`` tablosu ya da
    ``retention_days`` varsayılanı bulunamıyor) ``ContentError`` — kaynak seed'dir, çözülemeyen değer hatadır."""
    seed_path = seed_path or repo_root / "supabase" / "seed" / "04_retention_policies.sql"
    migrations_dir = migrations_dir or repo_root / "supabase" / "migrations"
    days: dict[str, int] = {}
    origin: list[str] = []
    missing: list[str] = []
    tg: int | None = None
    if seed_path.exists():
        for row in sql_insert_rows(seed_path.read_text(encoding="utf-8"), "retention_policies"):
            pid, value = row.get("id"), row.get("days")
            if not isinstance(pid, str):
                raise ContentError(f"{seed_path}: retention_policies satırında id metin sabiti değil: {pid!r}")
            if isinstance(value, bool) or not isinstance(value, int):
                raise ContentError(f"{seed_path}: {pid} için days tam sayı sabiti değil: {value!r}")
            days[pid] = value
        if not days:
            raise ContentError(f"{seed_path}: retention_policies satırı okunamadı "
                               "(insert into public.retention_policies (...) values (...) biçimi bekleniyor)")
        origin.append(str(seed_path))
    else:
        missing.append(str(seed_path))
    if migrations_dir.is_dir():
        table_seen = False
        source: Path | None = None
        for path in sorted(migrations_dir.glob("*.sql")):
            text = path.read_text(encoding="utf-8")
            if "tg_chats" not in text:
                continue
            try:
                value = sql_column_default(text, "tg_chats", "retention_days")
            except Exception as exc:  # noqa: BLE001 — pglast ayrıştırma hatası
                raise ContentError(f"{path}: SQL ayrıştırılamadı: {exc}") from exc
            if value is _NO_TABLE:
                continue
            table_seen = True
            if value is ... or isinstance(value, bool) or (value is not None and not isinstance(value, int)):
                raise ContentError(f"{path}: tg_chats.retention_days varsayılanı tam sayı sabiti değil")
            tg, source = value, path
        if not table_seen:
            raise ContentError(f"{migrations_dir}: public.tg_chats tablosu bulunamadı")
        if tg is None:
            raise ContentError(f"{migrations_dir}: tg_chats.retention_days varsayılanı okunamadı")
        origin.append(str(source))
    else:
        missing.append(str(migrations_dir))
    fallback = False
    if missing:
        if not allow_fallback:
            raise ContentError(f"saklama süreleri okunamadı: {', '.join(missing)} yok")
        fallback = True
        fb = retention_from_blueprint(repo_root / "docs" / "BLUEPRINT.md")
        if not days:
            days = fb.days
        if tg is None:
            tg = fb.tg_chats_retention_days
        origin.extend(fb.origin)
    if not days:
        raise ContentError(f"saklama süreleri okunamadı: {seed_path} yok")
    return RetentionSource(days=days, tg_chats_retention_days=tg, origin=origin, fallback=fallback)


_PLACEHOLDER = re.compile(r"\{\{\s*([A-Za-z0-9_]+)\s*\}\}")


def resolve_placeholders(body: str, placeholders: dict[str, Any], retention: RetentionSource,
                         label: str = "") -> tuple[str, list[str]]:
    """Her ``{{AD}}``'ı gün sayısına çevirir. Çözülemeyen ya da 0 gün → ContentError; dönüş (metin, uyarılar)."""
    problems: list[str] = []
    warnings: list[str] = []

    def value_for(name: str) -> int | None:
        entry = placeholders.get(name)
        if not isinstance(entry, dict):
            problems.append(f"{label}: {{{{{name}}}}} placeholders.json'da tanımsız")
            return None
        source = entry.get("days_source", "retention_policies.days")
        if source == "tg_chats.retention_days":
            value = retention.tg_chats_retention_days
            if value is None:
                problems.append(f"{label}: {{{{{name}}}}} için tg_chats.retention_days varsayılanı okunamadı")
                return None
        elif source == "retention_policies.days":
            policy = entry.get("policy_id")
            if policy not in retention.days:
                problems.append(f"{label}: {{{{{name}}}}} → policy_id {policy} saklama seed'inde yok")
                return None
            value = retention.days[policy]
        else:
            problems.append(f"{label}: {{{{{name}}}}} bilinmeyen days_source {source!r}")
            return None
        if value <= 0:
            problems.append(f"{label}: {{{{{name}}}}} {value} güne çözüldü; '0 gün' yazılamaz (days_source={source})")
            return None
        expected = entry.get("expected_days")
        if isinstance(expected, int) and expected != value:
            warnings.append(f"{label}: {{{{{name}}}}} = {value}, placeholders.json expected_days {expected}")
        return value

    cache: dict[str, int | None] = {}

    def repl(m: re.Match) -> str:
        name = m.group(1)
        if name not in cache:
            cache[name] = value_for(name)
        return str(cache[name]) if cache[name] is not None else m.group(0)

    out = _PLACEHOLDER.sub(repl, body)
    if problems:
        raise ContentError("; ".join(dict.fromkeys(problems)))
    if "{{" in out or "}}" in out:
        raise ContentError(f"{label}: çözülmemiş yer tutucu kaldı")
    return out, list(dict.fromkeys(warnings))


@dataclass
class LegalDoc:
    path: Path
    kind: str
    version: str
    effective_from: str
    body_md: str


_FENCE = re.compile(r"```yaml\n(.*?)\n```\n?", re.S)


def parse_legal_doc(path: Path) -> LegalDoc | None:
    """``legal_texts_kind`` taşıyan belgeyi okur (taşımayan → None). Gövde: yaml başlık bloğu çıkarılmış metin."""
    text = path.read_text(encoding="utf-8")
    m = _FENCE.search(text)
    if not m:
        raise ContentError(f"{path}: yaml başlık bloğu yok")
    meta: dict[str, str] = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip()
    kind = meta.get("legal_texts_kind")
    if not kind:
        return None
    if kind not in LEGAL_KINDS:
        raise ContentError(f"{path}: legal_texts_kind {kind!r} legal_texts.kind kısıtında yok")
    for need in ("doc_version", "effective_from"):
        if not meta.get(need):
            raise ContentError(f"{path}: {need} yok")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", meta["effective_from"]):
        raise ContentError(f"{path}: effective_from tarih değil: {meta['effective_from']}")
    body = (text[: m.start()] + text[m.end():]).strip() + "\n"
    body = re.sub(r"\n{3,}", "\n\n", body)
    return LegalDoc(path=path, kind=kind, version=meta["doc_version"], effective_from=meta["effective_from"],
                    body_md=body)


def load_legal_docs(hukuk_dir: Path) -> list[LegalDoc]:
    docs = []
    for path in sorted(hukuk_dir.glob("*.md")):
        if path.name.lower() == "readme.md":
            continue
        doc = parse_legal_doc(path)
        if doc is not None:
            docs.append(doc)
    kinds = Counter(d.kind for d in docs)
    for kind, n in kinds.items():
        if n > 1:
            raise ContentError(f"legal_texts.kind {kind} birden çok belgede")
    return docs
