"""``tablet generate``: LLM soru üretimi (BLUEPRINT §6.1 (0)–(9); zincir ``question_gen``).

Hedef listesi:

* ``--skill`` verilirse yalnız o yaprak, ``--count`` kadar (elle/test; şablonlu yaprakta da açık istek sayılır,
  uyarı yazılır).
* ``--skill`` yoksa (gece): (i) ``generation_requests where needs_generation and served_question_id is null``
  satırları ``generation-request`` şemasıyla doğrulanır, ``(skill_id, difficulty_band, question_kind)`` ile gruplanır
  ve istek sayısına göre azalan sırada alınır (``exam_variant`` → ``topic``/``points`` istemde meta olarak;
  ``regenerate`` → eski sorunun ``review_note``'u); (ii) ardından ``approved`` stoku ``< 30`` olan ve ``enabled``
  şablonu **olmayan** yapraklar en düşük stoktan başlayarak eklenir; toplam ``runtime_flags.tablet_nightly_count``
  ile kesilir (``--count`` verilirse onu aşmaz).

Her hedef için: (1) ``approved`` ≥ 30 → ``pool_sufficient``; (2) başta ``check_spend('question_gen')``;
(3) istem (en yakın 3 ``library_chunks`` + 1 onaylı ``content_pool.explanation``); (4) zarf şeması, kazanım/tür,
şık kuralı, anahtar sızıntısı, ``content_hash`` çakışması; (5) şekil sandbox render + boyut denetimi;
(6) SymPy; (7) vision; (8) en çok 2 deneme: başarı → ``draft`` ekle + ``register_answer_key`` (→ ``pending_review``);
2 başarısız denemede incelenebilir aday (SymPy/render/vision düşen) varsa ``pending_review`` + not
(``verification.review_note``), yoksa hedef ``failed`` ve istek açık kalır; (9) anahtar yalnız
``register_answer_key`` RPC'si ile — ``out/``'a yalnız dry-run'da ``--dump-keys`` ile yazılır.

``batch_worker`` ``questions.review_note`` sütununu yazamaz (§3.8; yalnız ``approve_question`` /
``register_answer_key``): üretim notu ``questions.verification.review_note`` içinde durur (question-item şeması).

Anahtar yalıtımı: SymPy'nin bulduğu değer ve şık harfi (``KeyCheck.note``) yalnız bellekte, yeniden üretim
isteminde (``feedback``) ve ``register_answer_key``'e giden ``sympy_report``'ta (``secure`` şeması) kalır; herkese açık
yerlere (``verification.review_note``, ``generate_report.json``, ``out/questions.jsonl``) değersiz
``KeyCheck.public_note`` yazılır.

Yazım sırası: soru ``draft`` eklenir, ardından ``register_answer_key`` (soru ``pending_review`` olur). RPC düşerse
soru anahtarsız ``draft`` kalır, ``verification.review_note``'a not düşülür; sonraki çalışmada bu taslakların
``content_hash``'i tekrar sayılmaz ve aynı soru yeniden üretilirse satır güncellenip anahtar yeniden kaydedilir.

``pool_sufficient`` istekler: ``approved`` stoku ≥ 30 olan kazanımın ``generation_requests`` satırları üretimsiz kalır
ve açık durur (``served_question_id`` yalnız üretilen soruyla dolar, §6.1; ``batch_worker`` ``needs_generation``'ı
yazamaz). Raporda ``requests_left_open`` olarak listelenir; o kazanımın soruları havuzdan sunulur.
"""

from __future__ import annotations

import json
import uuid
from collections import Counter, defaultdict
from collections.abc import Mapping
from dataclasses import asdict, dataclass, field
from typing import Any

import ogrenmen_contracts as contracts
from ogrenmen_common.adapters.base import LLMRequest, in_, insert_minimal, is_null, update_minimal
from ogrenmen_common.batch import BatchItem
from ogrenmen_common.clock import iso
from ogrenmen_common.errors import LedgerError, OgrError

from . import figures as FG
from . import prompts as P
from . import sandbox as S
from . import shared
from . import verify as V
from .library import Library
from .shared import MAX_ATTEMPTS

POOL_SUFFICIENT = 30
DEFAULT_NIGHTLY_COUNT = 10
DEFAULT_SKILL_COUNT = 10
AVOID_STEMS = 5
REVIEWABLE = frozenset({"sympy", "render", "vision"})
"""Bu nedenlerle düşen aday eğitmen kuyruğuna gidebilir; diğerleri (şema, kazanım, şık, tekrar) atılır."""


class GenerateError(OgrError):
    """Üretim hedefleri kurulamadı (bilinmeyen kazanım, aktif müfredat yok …)."""


@dataclass
class Target:
    skill_id: str
    band: str = "mid"
    question_kind: str | None = None
    source: str = "stock"
    """``manual`` (``--skill``) | ``request`` (generation_requests grubu) | ``stock`` (< 30 stoklu yaprak)"""
    requests: list[dict[str, Any]] = field(default_factory=list)
    topic: str | None = None
    points: float | None = None
    review_notes: list[str] = field(default_factory=list)
    slot: int = 1
    slots: int = 1
    stock: int = 0

    @property
    def key(self) -> str:
        return f"{self.source}:{self.skill_id}:{self.band}:{self.question_kind or '-'}:{self.slot}"

    @property
    def request_ids(self) -> list[str]:
        return [str(r["id"]) for r in self.requests]


@dataclass
class Candidate:
    envelope: V.EnvelopeCheck
    render: S.RenderResult | None
    vision: FG.VisionOutcome | None
    failure: str | None
    reason: str | None
    """Herkese açık neden (rapor, ``verification.review_note``): anahtar değeri ya da şık harfi içermez."""
    model: str | None
    cost_usd: float
    feedback: str | None = None
    """Yalnız bellekte: yeniden üretim istemine giden ayrıntılı neden (SymPy değeri dahil); yoksa ``reason``."""


@dataclass
class TargetResult:
    skill_id: str
    source: str
    band: str
    question_kind: str | None
    slot: int
    request_ids: list[str]
    stock_before: int
    status: str = "pending"
    """``generated`` | ``review`` (2 başarısız deneme → pending_review) | ``failed`` | ``pool_sufficient`` |
    ``cap_blocked`` | ``deferred`` (Batch süresi doldu; ertesi gece) | ``error``"""
    question_id: str | None = None
    figure_id: str | None = None
    attempts: int = 0
    sympy: str | None = None
    render: str | None = None
    vision: str | None = None
    errors: list[str] = field(default_factory=list)
    review_note: str | None = None
    library_chunk_ids: list[int] = field(default_factory=list)
    cost_usd: float = 0.0


@dataclass
class Context:
    curriculum: dict[str, Any]
    skills: dict[str, dict[str, Any]]
    leaves: list[str]
    templated: set[str]
    tags_by_skill: dict[str, list[dict[str, Any]]]
    stock: Counter
    hashes: set[str]
    stems_by_skill: dict[str, list[str]]
    retired_notes: list[dict[str, Any]]
    pool: dict[str, str]
    nightly_count: int
    library: Library
    stale_drafts: set[str] = field(default_factory=set)
    """Anahtarı kaydedilememiş (RPC'si düşmüş) LLM taslaklarının kimlikleri; ``content_hash``'leri tekrar sayılmaz."""

    @property
    def curriculum_code(self) -> str:
        return f"{self.curriculum['code']}@{self.curriculum['version']}"


@dataclass
class Options:
    skill: str | None = None
    count: int | None = None
    band: str | None = None
    batch: bool = False
    dump_keys: bool = False


# --- bağlam ---------------------------------------------------------------------------------------


def _flag(db: Any, key: str, default: Any) -> Any:
    rows = db.select("runtime_flags", where={"key": key}, columns=["key", "value"])
    return rows[0]["value"] if rows else default


def load_context(rt: Any) -> Context:
    db = rt.db
    try:
        cur = shared.active_curriculum(db)
    except shared.CurriculumError as exc:
        raise GenerateError(exc.message) from exc
    skills = {r["id"]: dict(r) for r in db.select(
        "skills", where={"curriculum_id": cur["id"]},
        columns=["id", "name", "description", "parent_id", "is_leaf", "order_no"])}
    leaves = [s["id"] for s in sorted(skills.values(), key=lambda s: (int(s.get("order_no") or 0), s["id"]))
              if s.get("is_leaf")]
    templated = {r["skill_id"] for r in db.select("question_templates", where={"enabled": True},
                                                  columns=["id", "skill_id", "curriculum_id"])
                 if r.get("curriculum_id") in (None, cur["id"])}
    tags_by_skill: dict[str, list[dict[str, Any]]] = defaultdict(list)
    general: list[dict[str, Any]] = []
    for t in db.select("misconception_tags", columns=["tag", "skill_id", "text_instructor"], order="tag"):
        (tags_by_skill[t["skill_id"]] if t.get("skill_id") else general).append(dict(t))
    for sid in leaves:
        tags_by_skill[sid] = tags_by_skill.get(sid, []) + general[:2]
    stock: Counter = Counter()
    hashes: set[str] = set()
    stems: dict[str, list[str]] = defaultdict(list)
    retired: list[dict[str, Any]] = []
    stale: set[str] = set()
    for q in db.select("questions", where={"curriculum_id": cur["id"]},
                       columns=["id", "skill_ids", "status", "source", "content_hash", "stem", "reviewed_by",
                                "reviewed_at", "review_note"], order="created_at"):
        if q.get("source") == "llm" and q.get("status") == "draft":
            stale.add(str(q["id"]))  # register_answer_key düşmüş: anahtarsız taslak, yeniden üretilebilir
        elif q.get("content_hash"):
            hashes.add(q["content_hash"])
        for sid in q.get("skill_ids") or []:
            if q.get("status") == "approved":
                stock[sid] += 1
            if q.get("status") in ("approved", "pending_review", "draft"):
                stems[sid].append(q.get("stem") or "")
        if q.get("status") == "retired" and q.get("review_note"):
            retired.append(dict(q))
    pool: dict[str, str] = {}
    for p in db.select("content_pool", where={"status": "approved", "kind": "explanation", "curriculum_id": cur["id"]},
                       columns=["skill_id", "body", "created_at"], order="created_at"):
        pool.setdefault(p["skill_id"], p["body"])
    nightly = _flag(db, "tablet_nightly_count", DEFAULT_NIGHTLY_COUNT)
    try:
        nightly = int(nightly)
    except (TypeError, ValueError):
        nightly = DEFAULT_NIGHTLY_COUNT
    return Context(curriculum=cur, skills=skills, leaves=leaves, templated=templated, tags_by_skill=tags_by_skill,
                   stock=stock, hashes=hashes, stems_by_skill=stems, retired_notes=retired, pool=pool,
                   nightly_count=nightly, library=Library(rt, cur["id"]), stale_drafts=stale)


def _regenerate_notes(ctx: Context, request: Mapping[str, Any]) -> list[str]:
    """``regenerate`` isteğinin eski sorusu: aynı kazanımda, isteyen eğitmenin ``retired`` yaptığı en yeni soru."""
    staff = request.get("requested_by_staff")
    created = str(request.get("created_at") or "")
    best = None
    for q in ctx.retired_notes:
        if request["skill_id"] not in (q.get("skill_ids") or []):
            continue
        if staff and q.get("reviewed_by") and q["reviewed_by"] != staff:
            continue
        if created and q.get("reviewed_at") and str(q["reviewed_at"]) > created:
            continue
        if best is None or str(q.get("reviewed_at") or "") > str(best.get("reviewed_at") or ""):
            best = q
    return [best["review_note"]] if best else []


def open_requests(rt: Any) -> tuple[list[dict[str, Any]], list[str]]:
    rows = rt.db.select("generation_requests", where={"needs_generation": True, "served_question_id": is_null()},
                        order="created_at")
    valid, warnings = [], []
    for row in rows:
        problems = contracts.errors("generation-request", dict(row))
        if problems:
            warnings.append(f"generation_requests {row.get('id')}: şemaya uymuyor, atlandı ({problems[0].message})")
            continue
        valid.append(dict(row))
    return valid, warnings


def build_targets(rt: Any, ctx: Context, opts: Options) -> tuple[list[Target], list[TargetResult], list[str]]:
    """Hedefler, üretimsiz sonuçlanan hedefler (``pool_sufficient``) ve uyarılar."""
    warnings: list[str] = []
    skipped: list[TargetResult] = []
    band = opts.band or "mid"
    if opts.skill:
        skill = ctx.skills.get(opts.skill)
        if skill is None:
            raise GenerateError(f"OGR-GEN-001 bilinmeyen kazanım: {opts.skill} ({ctx.curriculum_code})")
        if not skill.get("is_leaf"):
            raise GenerateError(f"OGR-GEN-001 yaprak olmayan kazanıma soru üretilmez: {opts.skill}")
        if opts.skill in ctx.templated:
            warnings.append(f"{opts.skill} şablonlu yaprak; stok `template --fill` ile dolar. --skill açık istek "
                            "sayıldı, LLM ile üretiliyor")
        n = opts.count or DEFAULT_SKILL_COUNT
        stock = ctx.stock[opts.skill]
        if stock >= POOL_SUFFICIENT:
            skipped.append(TargetResult(opts.skill, "manual", band, None, 1, [], stock, status="pool_sufficient"))
            return [], skipped, warnings
        return [Target(opts.skill, band, None, "manual", slot=i + 1, slots=n, stock=stock) for i in range(n)], \
            skipped, warnings
    limit = ctx.nightly_count if opts.count is None else min(opts.count, ctx.nightly_count)
    requests, req_warnings = open_requests(rt)
    warnings.extend(req_warnings)
    groups: dict[tuple[str, str, str | None], list[dict[str, Any]]] = defaultdict(list)
    for r in requests:
        groups[(r["skill_id"], r.get("difficulty_band") or "mid", r.get("question_kind"))].append(r)
    ordered = sorted(groups.items(), key=lambda kv: (-len(kv[1]), str(kv[1][0].get("created_at") or ""), kv[0][0]))
    targets: list[Target] = []
    taken: set[str] = set()
    for (sid, gband, qkind), rows in ordered:
        if sid not in ctx.skills or not ctx.skills[sid].get("is_leaf"):
            warnings.append(f"generation_requests {sid}: müfredatta yaprak kazanım değil, atlandı")
            continue
        stock = ctx.stock[sid]
        if stock >= POOL_SUFFICIENT:
            skipped.append(TargetResult(sid, "request", gband, qkind, 1, [str(r["id"]) for r in rows], stock,
                                        status="pool_sufficient"))
            continue
        if len(targets) >= limit:
            continue
        topic = next((r.get("topic") for r in rows if r.get("topic")), None)
        points = next((float(r["points"]) for r in rows if r.get("points") is not None), None)
        notes: list[str] = []
        for r in rows:
            if r.get("kind") == "regenerate":
                notes.extend(n for n in _regenerate_notes(ctx, r) if n not in notes)
        targets.append(Target(sid, gband, qkind, "request", rows, topic=topic, points=points, review_notes=notes,
                              stock=stock))
        taken.add(sid)
    leaves = [sid for sid in ctx.leaves if sid not in ctx.templated and sid not in taken]
    for sid in sorted(leaves, key=lambda s: (ctx.stock[s], ctx.leaves.index(s))):
        if len(targets) >= limit:
            break
        stock = ctx.stock[sid]
        if stock >= POOL_SUFFICIENT:
            skipped.append(TargetResult(sid, "stock", band, None, 1, [], stock, status="pool_sufficient"))
            continue
        targets.append(Target(sid, band, None, "stock", stock=stock))
    return targets, skipped, warnings


# --- üretim ----------------------------------------------------------------------------------------


@dataclass
class _State:
    target: Target
    result: TargetResult
    feedback: str | None = None
    candidate: Candidate | None = None
    done: bool = False
    library: list[dict[str, Any]] = field(default_factory=list)


def _request_for(ctx: Context, state: _State) -> LLMRequest:
    t = state.target
    prompt = P.generation_prompt(
        curriculum_code=ctx.curriculum_code, skill=ctx.skills[t.skill_id], band=t.band,
        question_kind=t.question_kind, tags=ctx.tags_by_skill.get(t.skill_id, []), topic=t.topic, points=t.points,
        review_notes=t.review_notes, library=state.library, pool_example=ctx.pool.get(t.skill_id),
        avoid_stems=ctx.stems_by_skill.get(t.skill_id, [])[-AVOID_STEMS:], slot=t.slot, slots=t.slots,
        feedback=state.feedback)
    return LLMRequest(purpose="question_gen", model="", system=P.SYSTEM_PROMPT, prompt=prompt,
                      schema_id=V.ENVELOPE_SCHEMA, max_tokens=4096, temperature=0.4)


def _ref(state: _State) -> tuple[str, str]:
    if state.library:
        return "library_chunks", ",".join(str(c["id"]) for c in state.library)
    if state.target.requests:
        return "generation_requests", ",".join(state.target.request_ids)
    return "skills", state.target.skill_id


def _call_round(rt: Any, ctx: Context, states: list[_State], *, batch: bool) -> dict[str, Any]:
    """Bir deneme turu: ``{target.key: CallResult | LedgerError}``; ``"__deferred__"`` anahtarı Batch ertelemesi."""
    out: dict[str, Any] = {}
    if batch:
        items = []
        for s in states:
            table, ref = _ref(s)
            items.append(BatchItem(key=s.target.key, request=_request_for(ctx, s), ref_table=table, ref_id=ref))
        outcome = rt.batch.run("question_gen", items, display_name="tablet-generate")
        if outcome.status == "deferred":
            out["__deferred__"] = True
            return out
        for s in states:
            if s.target.key in outcome.results:
                out[s.target.key] = outcome.results[s.target.key]
            else:
                out[s.target.key] = LedgerError(outcome.errors.get(s.target.key, "OGR-LLM-001 Batch sonucu yok"))
        return out
    for s in states:
        table, ref = _ref(s)
        try:
            out[s.target.key] = rt.ledger.call("question_gen", _request_for(ctx, s), ref_table=table, ref_id=ref)
        except LedgerError as exc:
            out[s.target.key] = exc
            if exc.message.startswith("OGR-LLM-002"):  # tavan: kalan hedefler için çağrı yapılmaz
                for rest in states[states.index(s) + 1:]:
                    out[rest.target.key] = exc
                break
    return out


def _evaluate(rt: Any, ctx: Context, state: _State, call: Any) -> Candidate | str:
    """Zarfı denetler; başarılı/incelenebilir aday ya da atılan denemenin nedeni (metin)."""
    t = state.target
    try:
        env = V.check_envelope(call.data, target_skill=t.skill_id, curriculum_code=ctx.curriculum_code,
                               question_kind=t.question_kind)
    except V.VerifyError as exc:
        return f"{exc.code}: {exc.message}"
    if env.content_hash in ctx.hashes:
        return "duplicate: aynı kök ve şıklarla soru zaten var (content_hash)"
    cost = float(call.cost_usd or 0)
    if env.sympy.status == "failed":
        return Candidate(env, None, None, "sympy", f"SymPy doğrulaması başarısız: {env.sympy.public_note}",
                         call.model, cost, feedback=f"SymPy doğrulaması başarısız: {env.sympy.note}")
    figure = env.item.get("figure")
    render = vision = None
    if figure:
        render = S.render(str(figure["tool"]), str(figure["code"]), expected_px=figure.get("expected_px"))
        if not render.ok:
            first = render.log.splitlines()[0] if render.log else render.status
            return Candidate(env, render, None, "render", f"şekil çizilemedi ({render.status}): {first}", call.model,
                             cost)
        vision = FG.vision_check(rt, render, env.item)
        if vision.status == "mismatch":
            detail = json.dumps(vision.mismatches, ensure_ascii=False)[:400]
            return Candidate(env, render, vision, "vision", f"şekil kökle uyuşmuyor, kodu düzelt: {detail}",
                             call.model, cost)
    return Candidate(env, render, vision, None, None, call.model, cost)


def question_id_for(content_hash: str) -> str:
    return str(uuid.uuid5(shared.NAMESPACE_OGRENMEN, f"llm-question:{content_hash}"))


def _verification(c: Candidate, *, attempts: int, status: str, note: str | None) -> dict[str, Any]:
    figure = c.envelope.item.get("figure")
    if not figure:
        render = vision = "not_applicable"
    else:
        render = c.render.verification_render if c.render else "pending"
        if c.vision is not None and c.vision.status in ("match", "mismatch", "skipped"):
            vision = c.vision.status
        elif c.render is not None and not c.render.ok:
            vision = "skipped"
        else:
            vision = "pending"
    return {"schema": True, "sympy": c.envelope.sympy.status, "render": render, "vision": vision,
            "attempts": min(3, attempts), "status": status, "review_note": note}


def _store(rt: Any, ctx: Context, state: _State, c: Candidate, *, review: bool, keys_sink: list | None) -> None:
    """Soru (+ şekil) yazımı ve anahtar RPC'si; ``review`` iken ``pending_review`` + not."""
    res = state.result
    item = c.envelope.item
    qid = question_id_for(c.envelope.content_hash)
    note = c.reason if review else None
    figure = item.get("figure")
    fid = None
    if figure:
        render = c.render
        if render is None:  # SymPy'de düşen aday: eğitmen şekli görsün diye şimdi çizilir (vision kuyrukta)
            render = S.render(str(figure["tool"]), str(figure["code"]), expected_px=figure.get("expected_px"))
            c.render = render
        fid = FG.store_figure(rt, figure, render, c.vision, res.attempts if review else res.attempts - 1)
    status = "pending_review" if review else "draft"
    stale = qid in ctx.stale_drafts
    if stale and review:
        raise GenerateError(f"OGR-GEN-004 aynı içerikli anahtarsız taslak var ({qid}); batch_worker durumunu "
                            "değiştiremez, soru incelemeye alınamadı")
    row = {"id": qid, "curriculum_id": ctx.curriculum["id"], "skill_ids": list(item["skill_ids"]),
           "kind": item["kind"], "stem": item["stem"], "stem_values": item.get("stem_values") or {},
           "figure_id": fid, "options": item.get("options") if item["kind"] == "mcq" else None,
           "difficulty": item.get("difficulty"), "source": "llm", "content_hash": c.envelope.content_hash,
           "verification": _verification(c, attempts=res.attempts, status="pending_review", note=note),
           "status": status, "model": c.model, "cost_usd": round(res.cost_usd, 6), "prompt_version": P.PROMPT_VERSION}
    if stale:  # önceki çalışmanın anahtarsız taslağı: içerik aynı, satır güncellenir, anahtar yeniden kaydedilir
        update_minimal(rt.db, "questions", {k: v for k, v in row.items()
                                            if k not in ("id", "curriculum_id", "source", "status")},
                       where={"id": qid})
        ctx.stale_drafts.discard(qid)
    else:
        insert_minimal(rt.db, "questions", row)
    res.question_id, res.figure_id = qid, fid  # anahtar RPC'si düşse de yazılan taslak raporda görünür
    ctx.hashes.add(c.envelope.content_hash)
    ctx.stems_by_skill[state.target.skill_id].append(item["stem"])
    if c.envelope.sympy.status in ("verified", "not_applicable"):
        try:
            rt.db.rpc("register_answer_key", {"p_question": qid, "p_key": V.key_payload(c.envelope.key, qid)})
        except OgrError as exc:
            _mark_key_failure(rt, ctx, row, exc)
            raise
        if keys_sink is not None:
            keys_sink.append({"question_id": qid, "content_hash": c.envelope.content_hash, **c.envelope.key})
    if state.target.request_ids:
        update_minimal(rt.db, "generation_requests", {"served_question_id": qid, "served_at": iso(rt.clock())},
                       where={"id": in_(state.target.request_ids)})
    res.status = "review" if review else "generated"
    res.question_id, res.figure_id, res.review_note = qid, fid, note
    res.sympy = c.envelope.sympy.status
    res.render = row["verification"]["render"]
    res.vision = row["verification"]["vision"]


KEY_RPC_NOTE = ("Anahtar kaydı (register_answer_key) başarısız; soru anahtarsız taslak, sonraki çalışmada yeniden "
                "üretilir")


def _mark_key_failure(rt: Any, ctx: Context, row: Mapping[str, Any], exc: OgrError) -> None:
    """RPC düştü: soru ``draft`` kalır (``status`` ``batch_worker``'a kapalı), nota düşülür, tekrar sayılmaz."""
    verification = dict(row["verification"], status="draft", review_note=KEY_RPC_NOTE)
    try:
        update_minimal(rt.db, "questions", {"verification": verification}, where={"id": row["id"]})
    except OgrError:  # not de yazılamazsa taslak yine anahtarsız ve tekrar sayılmaz (load_context)
        pass
    ctx.hashes.discard(str(row["content_hash"]))
    ctx.stale_drafts.add(str(row["id"]))


def run(rt: Any, opts: Options) -> dict[str, Any]:
    """Üretimi çalıştırır; ``generate_report.json`` gövdesini döner (anahtar içermez)."""
    ctx = load_context(rt)
    targets, skipped, warnings = build_targets(rt, ctx, opts)
    keys_sink: list[dict[str, Any]] | None = [] if opts.dump_keys else None
    states = [_State(t, TargetResult(t.skill_id, t.source, t.band, t.question_kind, t.slot, t.request_ids, t.stock))
              for t in targets]
    gate: dict[str, Any] = {}
    if states:
        gate = dict((rt.db.rpc("check_spend", {"p_purpose": "question_gen"}) or [{}])[0])
        if gate.get("degraded") or not gate.get("paid_allowed", False):
            for s in states:
                s.result.status, s.done = "cap_blocked", True
                s.result.errors.append(f"check_spend: durum {gate.get('state')}, ücretli çağrı izni yok")
    for s in states:
        if not s.done:
            s.library = ctx.library.nearest(ctx.skills[s.target.skill_id].get("name") or s.target.skill_id)
            s.result.library_chunk_ids = [c["id"] for c in s.library]
    for attempt in range(1, MAX_ATTEMPTS + 1):
        active = [s for s in states if not s.done]
        if not active:
            break
        calls = _call_round(rt, ctx, active, batch=opts.batch)
        if calls.get("__deferred__"):
            for s in active:
                s.result.status, s.done = "deferred", True
                s.result.errors.append("Batch işi süresinde bitmedi; ertesi gece yeniden denenir")
            break
        for s in active:
            call = calls[s.target.key]
            s.result.attempts = attempt
            if isinstance(call, LedgerError):
                if call.message.startswith("OGR-LLM-002"):
                    s.result.status, s.done = "cap_blocked", True
                s.result.errors.append(call.message)
                s.feedback = None
                continue
            s.result.cost_usd += float(call.cost_usd or 0)
            outcome = _evaluate(rt, ctx, s, call)
            if isinstance(outcome, str):
                s.result.errors.append(outcome)
                s.feedback = outcome
                continue
            if outcome.failure is None:
                try:
                    _store(rt, ctx, s, outcome, review=False, keys_sink=keys_sink)
                except OgrError as exc:
                    s.result.status = "error"
                    s.result.errors.append(exc.message)
                s.done = True
                continue
            s.result.errors.append(outcome.reason or outcome.failure)
            s.candidate = outcome
            s.feedback = outcome.feedback or outcome.reason
    for s in states:
        if s.done:
            continue
        if s.candidate is not None and s.candidate.failure in REVIEWABLE:
            try:
                s.candidate.reason = f"{shared.TWO_ATTEMPT_PREFIX}; son neden: {s.candidate.reason}"
                _store(rt, ctx, s, s.candidate, review=True, keys_sink=keys_sink)
            except OgrError as exc:
                s.result.status = "error"
                s.result.errors.append(exc.message)
        else:
            s.result.status = "failed"
        s.done = True
    results = [s.result for s in states] + skipped
    counts = Counter(r.status for r in results)
    return {
        "mode": "manual" if opts.skill else "nightly",
        "curriculum": ctx.curriculum_code,
        "generated_at": iso(rt.clock()),
        "batch": opts.batch,
        "limit": (opts.count or DEFAULT_SKILL_COUNT) if opts.skill else (
            ctx.nightly_count if opts.count is None else min(opts.count, ctx.nightly_count)),
        "check_spend": {k: gate.get(k) for k in ("paid_allowed", "degraded", "state")} if gate else None,
        "totals": {"targets": len(states), "by_status": dict(sorted(counts.items())),
                   "questions": sum(1 for r in results if r.question_id),
                   "cost_usd": round(sum(r.cost_usd for r in results), 6)},
        "warnings": warnings,
        "requests_left_open": sorted(rid for r in results if r.status == "pool_sufficient" for rid in r.request_ids),
        "targets": [{**asdict(r), "cost_usd": round(r.cost_usd, 6)} for r in results],
        "_keys": keys_sink,
    }


def has_errors(report: Mapping[str, Any]) -> bool:
    return any(t.get("status") == "error" for t in report.get("targets", []))


def stored_questions(rt: Any, report: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Gerçek kipte ``out/questions.jsonl`` için bu çalışmada yazılan sorular (anahtarsız)."""
    ids = [t["question_id"] for t in report.get("targets", []) if t.get("question_id")]
    if not ids:
        return []
    rows = rt.db.select("questions", where={"id": in_(ids)},
                        columns=["id", "skill_ids", "kind", "stem", "stem_values", "figure_id", "options",
                                 "difficulty", "source", "content_hash", "verification", "status"])
    return [dict(r) for r in rows]


def strip_keys(report: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]] | None]:
    keys = report.pop("_keys", None)
    return report, keys
