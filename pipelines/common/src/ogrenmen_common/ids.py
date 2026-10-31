"""Kimlik biçimleri — tek kaynak (``ledger``, ``cli_base`` ve ``fakes.jsonl_rpc`` buradan alır).

Pipelines öğrenciyi yalnız ``students.public_ref`` (``s_`` + 12 base32 küçük harf/rakam) ile tanır;
uuid, ad ya da Telegram kimliği kabul edilmez (§6 kural 1).
"""

from __future__ import annotations

import re

STUDENT_REF = re.compile(r"^s_[a-z2-7]{12}$")
"""``students.public_ref`` biçimi."""


def is_student_ref(value: object) -> bool:
    return isinstance(value, str) and STUDENT_REF.match(value) is not None
