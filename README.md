# musubi-opencode

OpenCode v2 adapter for identity-scoped Musubi continuity. It uses
[`musubi-harness`](https://github.com/sourceblender/musubi-harness) for the
capture contract, shadow outbox, verified delivery, namespace policy, and the
canonical five-tool memory facade.

## What it does

- Captures a completed **primary** OpenCode user/assistant turn after
  `session.execution.succeeded`. It excludes reasoning, tool outputs, system messages, failed
  turns, interrupted turns, and subagent sessions. Visible text before and
  after tool calls is retained. The stable event ID makes repeat completion
  events idempotent.
- Injects a bounded, clearly labeled recent chronology once per primary
  session. These memories are historical data, never instructions.
- Registers `musubi_recent`, `musubi_search`, `musubi_get`,
  `musubi_remember`, and `musubi_status` as local MCP tools. The first three
  and remember are limited to the configured actor's namespace by the shared
  harness, even if a token has a broader read scope.
- Starts in `shadow` mode. Remote delivery requires an explicit switch to
  `verified` and an exact readback canary. A queued outbox item is not a stored
  memory.

The OpenCode binding targets **OpenCode v2.0.18**. V1 uses a different plugin
API and is not supported by this package.

## Install for one seat

Install the Python commands and the OpenCode plugin from this repository. The
Python package requires `musubi-harness>=1.8.0` because that release adds
`opencode` as a distinct provenance source.

```sh
uv tool install 'git+https://github.com/sourceblender/musubi-opencode.git@v0.1.0'
command -v musubi-opencode-bridge
command -v musubi-opencode-mcp
```

Add the plugin **only to that seat's project-local** `opencode.json` (the
example assumes the repository was cloned at the shown path). Do not add it to
the shared `~/.config/opencode/opencode.json`. Launch the seat with
`opencode --standalone`: the default TUI connects to a shared background
service whose environment does not contain this seat's token or identity.
Restart the seat after the project config and launcher are in place.

```json
{
  "plugins": ["/absolute/path/to/musubi-opencode"]
}
```

The launcher supplies all of these values as process environment, never in
`opencode.json` or this repository:

```sh
MUSUBI_ACTOR=iris
MUSUBI_PRESENCE=iris/agent
MUSUBI_ZONE=home
MUSUBI_API_URL=https://your-musubi-server
MUSUBI_TOKEN=<seat-specific-jwt>
MUSUBI_DELIVERY_MODE=shadow
```

The `MUSUBI_*` identity triple is all-or-nothing. The adapter refuses a
missing or mismatched identity. The JWT's unverified presence and write-scope
claims are checked locally before a remote request; the Musubi server remains
the authority for validity. Local enqueue subprocesses receive no endpoint or
token. For an OpenCode process whose `PATH` does not expose the two Python
commands, set `MUSUBI_OPENCODE_BRIDGE_BIN` and
`MUSUBI_OPENCODE_MCP_BIN` to their absolute paths in the launcher.

## Verify deployment

1. In the seat launcher environment, call `musubi-opencode-mcp` with MCP
   `tools/list` and confirm exactly the five tools above.
2. Start a new OpenCode session. Its first model request should receive a
   `## Musubi continuity` block. A service failure must say *unavailable*;
   it is not an empty memory set.
3. Finish one ordinary primary turn in the persistent OpenCode TUI. Check the seat-specific
   `~/.local/state/musubi-opencode/<actor>/<zone>/shadow.db` for one
   `source=opencode` event. Repeat the completion notification and confirm the event
   is not duplicated. A subagent turn must not produce one.
4. After a reviewed write-token canary has verified an exact object ID and
   readback, set `MUSUBI_DELIVERY_MODE=verified`, restart OpenCode, and
   complete one new turn. Confirm a verified receipt with the exact object ID.
5. Exercise `musubi_recent` and `musubi_get` in the owned namespace. Try a
   foreign actor namespace and confirm the tool refuses it. Read
   `~/.local/state/musubi-opencode/degraded.jsonl` if any step fails.

## Development

```sh
bun install
bun test
uv venv .venv
uv pip install --python .venv/bin/python -e '.[dev]'
ruff check src tests
mypy src
.venv/bin/python -m pytest
```

The OpenCode plugin is in `plugin/`; the Python bridge and MCP server are in
`src/musubi_opencode/`. The host adapter owns OpenCode event parsing and does
not implement its own outbox, memory API, or namespace policy.
