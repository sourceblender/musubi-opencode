"""Capture keeps OpenCode provenance and rejects incomplete or unsafe turns."""

import pytest
from musubi_harness.core import ContractError
from musubi_harness.plugin_runtime import RuntimeConfig

from musubi_opencode.bridge import AdapterError, build_envelope

CONFIG = RuntimeConfig(actor="iris", presence="iris/agent", zone="home")


def payload():
    return {
        "session_id": "ses_primary",
        "user_id": "msg_prompt",
        "user_text": "Remember the result",
        "assistant_text": "The result is recorded.",
        "completed_at": 1790640000000,
        "model": "qwen-lan/qwen3.8-flash-next",
    }


def test_envelope_has_stable_identity_scoped_event():
    first = build_envelope(payload(), CONFIG)
    second = build_envelope(payload(), CONFIG)
    assert first.event_id == second.event_id
    assert first.source == "opencode"
    assert first.presence == "iris/agent"
    assert first.metadata["user_id"] == "msg_prompt"


def test_incomplete_turn_is_refused():
    value = payload()
    value["assistant_text"] = ""
    with pytest.raises(AdapterError, match="assistant_text_invalid"):
        build_envelope(value, CONFIG)


def test_secret_like_capture_is_refused_by_harness():
    value = payload()
    value["user_text"] = "Bearer AbCdEfGhIjKlMnOpQrStUvWxYz012345"
    with pytest.raises(ContractError, match="secret-like"):
        build_envelope(value, CONFIG)
