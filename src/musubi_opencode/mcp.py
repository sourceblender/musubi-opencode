"""Five canonical Musubi tools over stdio MCP for OpenCode."""

from __future__ import annotations

import json
import sys
from collections.abc import Iterable
from typing import Any, TextIO

from musubi_harness.plugin_mcp import PluginMcpFacade
from musubi_harness.plugin_runtime import RuntimeConfig, RuntimeConfigError

from .runtime import runtime

facade = PluginMcpFacade(
    runtime,
    source="opencode",
    event_prefix="opencode",
    owner_label="opencode-mcp",
    server_name="musubi-opencode",
)


def serve(stdin: Iterable[str], stdout: TextIO) -> int:
    placeholder = RuntimeConfig(actor="unavailable", presence="unavailable/mcp", zone="home")
    for line in stdin:
        request: dict[str, Any] | None = None
        try:
            parsed = json.loads(line)
            if not isinstance(parsed, dict):
                raise ValueError("request_invalid")
            request = parsed
            if parsed.get("method") == "tools/call":
                try:
                    config = runtime.runtime_config()
                except RuntimeConfigError as exc:
                    response: dict[str, Any] | None = {
                        "jsonrpc": "2.0",
                        "id": parsed.get("id"),
                        "result": {
                            "content": [
                                {
                                    "type": "text",
                                    "text": json.dumps(
                                        {"ok": False, "status": "unavailable", "detail": str(exc)}
                                    ),
                                }
                            ],
                            "isError": True,
                        },
                    }
                else:
                    response = facade.response_for(parsed, config)
            else:
                response = facade.response_for(parsed, placeholder)
        except (json.JSONDecodeError, ValueError):
            response = {
                "jsonrpc": "2.0",
                "id": request.get("id") if request else None,
                "error": {"code": -32700, "message": "Parse error"},
            }
        if response is not None:
            print(json.dumps(response, separators=(",", ":")), file=stdout, flush=True)
    return 0


def main() -> int:
    return serve(sys.stdin, sys.stdout)


if __name__ == "__main__":
    raise SystemExit(main())
