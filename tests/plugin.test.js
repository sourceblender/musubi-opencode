import { expect, test } from "bun:test"
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin from "../plugin/index.js"

test("injects a nonempty continuity block once and disposes the context hook", async () => {
  const directory = await mkdtemp(join(tmpdir(), "musubi-opencode-plugin-"))
  const bridge = join(directory, "bridge")
  await writeFile(bridge, '#!/usr/bin/env node\nprocess.stdin.resume(); process.stdin.on("end", () => process.stdout.write(JSON.stringify({ok:true,text:"## Musubi continuity\\nRecent memory available."})))\n')
  await chmod(bridge, 0o755)
  const old = Object.fromEntries(["MUSUBI_ACTOR", "MUSUBI_PRESENCE", "MUSUBI_ZONE", "MUSUBI_OPENCODE_BRIDGE_BIN"].map((key) => [key, process.env[key]]))
  Object.assign(process.env, {
    MUSUBI_ACTOR: "iris",
    MUSUBI_PRESENCE: "iris/agent",
    MUSUBI_ZONE: "home",
    MUSUBI_OPENCODE_BRIDGE_BIN: bridge,
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
    cleanup()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(disposed).toBe(true)
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(directory, { recursive: true, force: true })
  }
})
