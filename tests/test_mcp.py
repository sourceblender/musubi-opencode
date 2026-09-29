"""OpenCode advertises canonical tools without borrowing another identity."""

import io
import json

from musubi_opencode.mcp import serve


def test_mcp_lists_tools_without_seat_token(monkeypatch):
    for name in ("MUSUBI_ACTOR", "MUSUBI_PRESENCE", "MUSUBI_ZONE", "MUSUBI_TOKEN"):
        monkeypatch.delenv(name, raising=False)
    output = io.StringIO()
    serve([json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})], output)
    response = json.loads(output.getvalue())
    names = {tool["name"] for tool in response["result"]["tools"]}
    assert names == {
        "musubi_recent",
        "musubi_search",
        "musubi_get",
        "musubi_remember",
        "musubi_status",
    }


def test_mcp_call_without_identity_reports_unavailable(monkeypatch):
    for name in ("MUSUBI_ACTOR", "MUSUBI_PRESENCE", "MUSUBI_ZONE"):
        monkeypatch.delenv(name, raising=False)
    output = io.StringIO()
    serve(
        [
            json.dumps(
                {
                    "jsonrpc": "2.0",
                    "id": 2,
                    "method": "tools/call",
                    "params": {"name": "musubi_status", "arguments": {}},
                }
            )
        ],
        output,
    )
    response = json.loads(output.getvalue())
    assert response["result"]["isError"] is True
    assert "explicit_identity_config_missing" in response["result"]["content"][0]["text"]
