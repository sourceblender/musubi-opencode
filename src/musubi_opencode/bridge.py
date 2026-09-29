"""Bounded OpenCode event adapter for the shared Musubi outbox."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from datetime import UTC, datetime
from typing import Any

from musubi_harness import TurnEnvelope
from musubi_harness.plugin_continuity import PluginContinuity
from musubi_harness.plugin_runtime import RuntimeConfig, RuntimeConfigError

from .runtime import runtime


class AdapterError(ValueError):
    """OpenCode did not provide a safely completed primary turn."""


def _degraded(reason: str) -> None:
    try:
        root = runtime.data_root()
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        with (root / "degraded.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(
                json.dumps({"at": datetime.now(UTC).isoformat(), "reason": reason}) + "\n"
            )
    except OSError:
        pass


def _required(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise AdapterError(f"{name}_invalid")
    return value


def build_envelope(payload: dict[str, Any], config: RuntimeConfig) -> TurnEnvelope:
    if not isinstance(payload, dict):
        raise AdapterError("capture_payload_invalid")
    session_id = _required(payload.get("session_id"), "session_id")
    user_id = _required(payload.get("user_id"), "user_id")
    user_text = _required(payload.get("user_text"), "user_text")
    assistant_text = _required(payload.get("assistant_text"), "assistant_text")
    completed_at = payload.get("completed_at")
    if isinstance(completed_at, bool) or not isinstance(completed_at, (int, float)):
        raise AdapterError("completed_at_invalid")
    if not 1_600_000_000_000 <= completed_at <= 4_100_000_000_000:
        raise AdapterError("completed_at_invalid")
    digest = hashlib.sha256(f"{session_id}\0{user_id}".encode()).hexdigest()[:40]
    metadata: dict[str, str] = {"session_id": session_id, "user_id": user_id}
    model = payload.get("model")
    if isinstance(model, str) and model.strip():
        metadata["model"] = model[:200]
    return TurnEnvelope.from_mapping(
        {
            "event_id": f"opencode:{digest}",
            "actor": config.actor,
            "presence": config.presence,
            "plane": "episodic",
            "context": "primary",
            "source": "opencode",
            "zone": config.zone,
            "user_text": user_text,
            "assistant_text": assistant_text,
            "captured_at": datetime.fromtimestamp(completed_at / 1000, UTC).isoformat(),
            "metadata": metadata,
        }
    )


def _run(args: list[str], *, input_text: str | None = None, remote: bool = False) -> dict[str, Any]:
    config = runtime.runtime_config()
    completed = subprocess.run(
        args,
        input=input_text,
        text=True,
        capture_output=True,
        timeout=24 if remote else 8,
        check=False,
        env=runtime.tool_environment(config) if remote else runtime.local_tool_environment(config),
    )
    if completed.returncode != 0:
        raise AdapterError("delivery_failed" if remote else "outbox_write_failed")
    try:
        result = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise AdapterError("harness_response_invalid") from exc
    if not isinstance(result, dict):
        raise AdapterError("harness_response_invalid")
    return result


def capture(payload: Any) -> dict[str, Any]:
    config = runtime.runtime_config()
    envelope = build_envelope(payload, config)
    db = runtime.data_root() / config.actor / config.zone / "shadow.db"
    harness = runtime.harness_bin(config)
    _run([harness, "--db", str(db), "enqueue"], input_text=json.dumps(envelope.as_dict()))
    if config.delivery_mode == "shadow":
        return {"ok": True, "event_id": envelope.event_id, "state": "shadow"}
    _run([harness, "--db", str(db), "stage", "--event-id", envelope.event_id])
    result = _run(
        [
            harness,
            "--db",
            str(db),
            "drain",
            "--once",
            "--owner",
            f"{config.actor}-{config.zone}-opencode-idle",
            "--memory-data-bin",
            runtime.memory_data_bin(config),
            "--timeout",
            "5",
            "--max",
            "5",
            "--budget-seconds",
            "3",
        ],
        remote=True,
    )
    entries = result.get("results") or [result.get("result")]
    own = next(
        (
            item
            for item in entries
            if isinstance(item, dict) and item.get("event_id") == envelope.event_id
        ),
        None,
    )
    state = own.get("state") if isinstance(own, dict) else "pending"
    return {"ok": True, "event_id": envelope.event_id, "state": state}


def handle(request: dict[str, Any]) -> dict[str, Any]:
    action = request.get("action")
    if action == "continuity":
        return {"ok": True, "text": PluginContinuity(runtime).continuity_block()}
    if action == "capture":
        return capture(request.get("turn"))
    raise AdapterError("action_invalid")


def main() -> int:
    try:
        request = json.load(sys.stdin)
        if not isinstance(request, dict):
            raise AdapterError("request_invalid")
        response = handle(request)
    except (
        AdapterError, RuntimeConfigError, ValueError, OSError, subprocess.SubprocessError
    ) as exc:
        reason = (
            str(exc)
            if isinstance(exc, (AdapterError, RuntimeConfigError))
            else "adapter_runtime_failed"
        )
        _degraded(reason)
        response = {"ok": False, "status": "unavailable", "detail": reason}
    print(json.dumps(response, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
