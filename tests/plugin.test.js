import { expect, test } from "bun:test"
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin from "../plugin/index.js"

test("fetches continuity once, applies it to every model request, and disposes the hook", async () => {
  const directory = await mkdtemp(join(tmpdir(), "musubi-opencode-plugin-"))
  const bridge = join(directory, "bridge")
  const calls = join(directory, "calls")
  await writeFile(bridge, '#!/usr/bin/env node\nconst fs = require("node:fs"); process.stdin.resume(); process.stdin.on("end", () => { fs.appendFileSync(process.env.MUSUBI_TEST_BRIDGE_CALLS, "x"); process.stdout.write(JSON.stringify({ok:true,text:process.env.MUSUBI_TEST_BRIDGE_TEXT ?? "## Musubi continuity\\nRecent memory available."})) })\n')
  await chmod(bridge, 0o755)
  const old = Object.fromEntries(["MUSUBI_ACTOR", "MUSUBI_PRESENCE", "MUSUBI_ZONE", "MUSUBI_OPENCODE_BRIDGE_BIN", "MUSUBI_TEST_BRIDGE_CALLS", "MUSUBI_TEST_BRIDGE_TEXT"].map((key) => [key, process.env[key]]))
  Object.assign(process.env, {
    MUSUBI_ACTOR: "iris",
    MUSUBI_PRESENCE: "iris/agent",
    MUSUBI_ZONE: "home",
    MUSUBI_OPENCODE_BRIDGE_BIN: bridge,
    MUSUBI_TEST_BRIDGE_CALLS: calls,
  })
  let contextHook
  let disposed = false
  const context = {
    mcp: { transform: async () => {} },
    session: {
      hook: async (name, callback) => {
        expect(name).toBe("context")
        contextHook = callback
        return { dispose: async () => { disposed = true } }
      },
      get: async () => ({ id: "ses_primary" }),
    },
    event: {
      async *subscribe({ signal }) {
        await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }))
      },
    },
  }
  try {
    const cleanup = await plugin.setup(context)
    const request = { sessionID: "ses_primary", system: [] }
    await contextHook(request)
    expect(request.system).toEqual([{ type: "text", text: "## Musubi continuity\nRecent memory available." }])
    await contextHook(request)
    expect(request.system).toHaveLength(1)
    const laterRequest = { sessionID: "ses_primary", system: [] }
    await contextHook(laterRequest)
    expect(laterRequest.system).toEqual([{ type: "text", text: "## Musubi continuity\nRecent memory available." }])
    expect(await Bun.file(calls).text()).toBe("x")
    process.env.MUSUBI_TEST_BRIDGE_TEXT = "  \n  "
    const emptyRequest = { sessionID: "ses_empty", system: [] }
    await contextHook(emptyRequest)
    expect(emptyRequest.system).toHaveLength(0)
    process.env.MUSUBI_TEST_BRIDGE_TEXT = "## Musubi continuity\nRecovered memory."
    await contextHook(emptyRequest)
    expect(emptyRequest.system).toEqual([{ type: "text", text: "## Musubi continuity\nRecovered memory." }])
    expect(await Bun.file(calls).text()).toBe("xxx")
    await cleanup()
    expect(disposed).toBe(true)
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(directory, { recursive: true, force: true })
  }
})
