"""fixtures/telegram/*.json: Bot API Update örnekleri (telegram-update şeması) ve telegram/api/ altında
sahte Bot API yanıtları (getMe, getChatMember)."""

from __future__ import annotations

from typing import Any

from fxlib import (
    BOT,
    GROUP_A,
    GROUP_A_TITLE,
    GROUP_B,
    GROUP_B_TITLE,
    GROUP_C,
    GROUP_C_TITLE,
    NEWCOMER,
    UNCONSENTED,
    at,
    staff_tg_user,
    tg_user,
    uid,
    unix,
    uuid_b64url,
)

BOT_USER = {"id": BOT["id"], "is_bot": True, "first_name": BOT["first_name"], "username": BOT["username"]}
GROUP_CHAT = {"id": GROUP_A, "type": "supergroup", "title": GROUP_A_TITLE}


def private_chat(user: dict[str, Any]) -> dict[str, Any]:
    c = {"id": user["id"], "type": "private", "first_name": user["first_name"]}
    if user.get("last_name"):
        c["last_name"] = user["last_name"]
    if user.get("username"):
        c["username"] = user["username"]
    return c


def mention_entity(text: str, handle: str) -> dict[str, Any]:
    i = text.index(handle)
    return {"type": "mention", "offset": len(text[:i].encode("utf-16-le")) // 2,
            "length": len(handle.encode("utf-16-le")) // 2}


def updates() -> dict[str, dict[str, Any]]:
    elif_u, mert_u = tg_user("elif"), tg_user("mert")
    inst_u = staff_tg_user("inst")
    out: dict[str, dict[str, Any]] = {}

    text = "Merhaba, ben Elif. 3/4 + 1/8 kaç oluyor? Paydaları ayrı toplayınca 4/12 buldum."
    out["private_text"] = {"update_id": 910000101, "message": {
        "message_id": 41, "from": elif_u, "chat": private_chat(elif_u), "date": unix(at(20, 19, 0)), "text": text}}

    out["private_start"] = {"update_id": 910000102, "message": {
        "message_id": 1, "from": NEWCOMER, "chat": private_chat(NEWCOMER), "date": unix(at(20, 18, 30)),
        "text": "/start", "entities": [{"type": "bot_command", "offset": 0, "length": 6}]}}

    session_b64 = uuid_b64url(uid("diagnostic_session", "elif"))
    question_b64 = uuid_b64url(uid("question", "DIAG-2026.1-01"))
    out["callback_answer"] = {"update_id": 910000103, "callback_query": {
        "id": "4382950193847561", "from": elif_u, "chat_instance": "-6011912345678901",
        "data": f"ans:{session_b64}:{question_b64}:A",
        "message": {"message_id": 52, "from": BOT_USER, "chat": private_chat(elif_u), "date": unix(at(20, 19, 5)),
                    "text": "Soru 1/20 · `-3 + 4 · (-2)` işleminin sonucu kaçtır?\nA) `-11`  B) `-2`  C) `5`  D) `-5`",
                    "reply_markup": {"inline_keyboard": [[
                        {"text": k, "callback_data": f"ans:{session_b64}:{question_b64}:{k}"} for k in "ABCD"]]}}}}

    gtext = "@ogrenmen_bot mutlak değer denkleminde neden iki durum var?"
    out["group_mention"] = {"update_id": 910000104, "message": {
        "message_id": 120, "from": elif_u, "chat": GROUP_CHAT, "date": unix(at(20, 19, 10)), "text": gtext,
        "entities": [mention_entity(gtext, "@ogrenmen_bot")]}}

    out["group_plain"] = {"update_id": 910000105, "message": {
        "message_id": 121, "from": mert_u, "chat": GROUP_CHAT, "date": unix(at(20, 19, 12)),
        "text": "Yarınki denemeye kimler geliyor?"}}

    qtext = "Hocam |x - 2| = 5 denkleminde -3 de çözüm mü?"
    out["group_instructor_reply"] = {"update_id": 910000106, "message": {
        "message_id": 123, "from": inst_u, "chat": GROUP_CHAT, "date": unix(at(20, 19, 40)),
        "text": "Evet, iki durumu da kontrol et: -3 - 2 = -5 ve mutlak değeri 5.",
        "reply_to_message": {"message_id": 122, "from": mert_u, "chat": GROUP_CHAT, "date": unix(at(20, 19, 20)),
                             "text": qtext}}}

    new_u = {"id": 700000005, "is_bot": False, "first_name": "Ece", "last_name": "Şahin", "username": "ece_s",
             "language_code": "tr"}
    out["new_member"] = {"update_id": 910000107, "chat_member": {
        "chat": GROUP_CHAT, "from": new_u, "date": unix(at(20, 20, 0)),
        "old_chat_member": {"status": "left", "user": new_u}, "new_chat_member": {"status": "member", "user": new_u}}}

    svc_u = {"id": 700000006, "is_bot": False, "first_name": "Kaan", "last_name": "Uçar", "username": "kaan_u",
             "language_code": "tr"}
    chat_c = {"id": GROUP_C, "type": "supergroup", "title": GROUP_C_TITLE}
    out["new_member_service_message"] = {"update_id": 910000108, "message": {
        "message_id": 7, "from": svc_u, "chat": chat_c, "date": unix(at(20, 20, 5)), "new_chat_members": [svc_u]}}

    coord_u = staff_tg_user("coord")
    chat_b = {"id": GROUP_B, "type": "supergroup", "title": GROUP_B_TITLE}
    out["bot_added"] = {"update_id": 910000109, "my_chat_member": {
        "chat": chat_b, "from": coord_u, "date": unix(at(20, 10, 0)),
        "old_chat_member": {"status": "left", "user": BOT_USER},
        "new_chat_member": {"status": "administrator", "user": BOT_USER, "can_be_edited": False,
                            "can_manage_chat": True, "can_delete_messages": True, "can_manage_video_chats": False,
                            "can_restrict_members": False, "can_promote_members": False, "can_change_info": False,
                            "can_invite_users": True, "can_pin_messages": True, "is_anonymous": False}}}

    out["bot_added_not_admin"] = {"update_id": 910000110, "my_chat_member": {
        "chat": chat_c, "from": coord_u, "date": unix(at(20, 10, 30)),
        "old_chat_member": {"status": "left", "user": BOT_USER},
        "new_chat_member": {"status": "member", "user": BOT_USER}}}

    out["edited_message"] = {"update_id": 910000111, "edited_message": {
        "message_id": 41, "from": elif_u, "chat": private_chat(elif_u), "date": unix(at(20, 19, 0)),
        "edit_date": unix(at(20, 19, 2)),
        "text": "Merhaba, ben Elif. 3/4 + 1/8 kaç oluyor? Paydaları ayrı toplayınca 4/12 buldum, yanlış mı?"}}

    out["voice"] = {"update_id": 910000112, "message": {
        "message_id": 44, "from": elif_u, "chat": private_chat(elif_u), "date": unix(at(20, 19, 15)),
        "voice": {"file_id": "AwACAgIAAxkBAAIBfake0001", "file_unique_id": "AgADfake0001", "duration": 7,
                  "mime_type": "audio/ogg", "file_size": 18340}}}

    # Gövde 64 KB'ı aşar: Worker işlemez, 200 döner ve log yazar (§5.1).
    long_text = ("Bu soruyu adım adım anlatır mısın? `3/4 + 1/8` ve `5/6 - 1/4` ikisini de çözemedim. " * 760).strip()
    out["oversized"] = {"update_id": 910000113, "message": {
        "message_id": 45, "from": elif_u, "chat": private_chat(elif_u), "date": unix(at(20, 19, 20)), "text": long_text}}

    # 4.000 karakteri aşan ama 64 KB altındaki metin: kırpılır ve "mesajını kısaltarak okudum" denir.
    out["long_text"] = {"update_id": 910000115, "message": {
        "message_id": 46, "from": elif_u, "chat": private_chat(elif_u), "date": unix(at(20, 19, 25)),
        "text": ("Kesirlerde paydaları eşitlemeyi tekrar anlatır mısın? " * 90).strip()}}

    utext = "@ogrenmen_bot bu soruyu bana da açıklar mısın?"
    out["group_unconsented_mention"] = {"update_id": 910000114, "message": {
        "message_id": 124, "from": UNCONSENTED, "chat": GROUP_CHAT, "date": unix(at(20, 19, 50)), "text": utext,
        "entities": [mention_entity(utext, "@ogrenmen_bot")]}}
    return out


def api_responses() -> dict[str, dict[str, Any]]:
    me = {"id": BOT["id"], "is_bot": True, "first_name": BOT["first_name"], "username": BOT["username"],
          "can_join_groups": True, "supports_inline_queries": False}
    return {
        "getMe.privacy_off": {"ok": True, "result": dict(me, can_read_all_group_messages=True)},
        "getMe.privacy_on": {"ok": True, "result": dict(me, can_read_all_group_messages=False)},
        "getChatMember.administrator": {"ok": True, "result": {
            "status": "administrator", "user": BOT_USER, "can_be_edited": False, "can_manage_chat": True,
            "can_delete_messages": True, "can_invite_users": True, "can_pin_messages": True, "is_anonymous": False}},
        "getChatMember.member": {"ok": True, "result": {"status": "member", "user": BOT_USER}},
        "getChatMember.administrator_no_pin": {"ok": True, "result": {
            "status": "administrator", "user": BOT_USER, "can_be_edited": False, "can_manage_chat": True,
            "can_delete_messages": False, "can_invite_users": True, "can_pin_messages": False, "is_anonymous": False}},
    }
