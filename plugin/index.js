import { spawn } from "node:child_process"
import { Plugin } from "@opencode/plugin"
import { completedTurn } from "./turn.js"

const BRIDGE_TIMEOUT_MS = 28_000

function bridge(request) {
  const binary = process.env.MUSUBI_OPENCODE_BRIDGE_BIN || "musubi-opencode-bridge"
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"], shell: false })
    let output = ""
    let error = ""
    const timer = setTimeout(() => child.kill("SIGKILL"), BRIDGE_TIMEOUT_MS)
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => { output += chunk.slice(0, 256_000) })
    child.stderr.on("data", (chunk) => { error += chunk.slice(0, 1000) })
    child.on("error", (cause) => { clearTimeout(timer); reject(cause) })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (code !== 0) return reject(new Error(`bridge_exit_${code}: ${error.slice(0, 200)}`))
      try { resolve(JSON.parse(output)) } catch { reject(new Error("bridge_response_invalid")) }
    })
    child.stdin.end(JSON.stringify(request))
  })
}

export default Plugin.define({
  id: "musubi-opencode",
  async setup(ctx) {
    const mcpBinary = process.env.MUSUBI_OPENCODE_MCP_BIN || "musubi-opencode-mcp"
    await ctx.mcp.transform((editor) => {
      editor.set("musubi", { type: "local", command: [mcpBinary] })
    })

    const continuitySeen = new Set()
    await ctx.session.hook("context", async (event) => {
      if (continuitySeen.has(event.sessionID)) return
      try {
        const session = await ctx.session.get({ sessionID: event.sessionID })
        if (session.parentID) return
        const result = await bridge({ action: "continuity" })
        if (result.ok && typeof result.text === "string") {
          event.system.push({ type: "text", text: result.text })
          continuitySeen.add(event.sessionID)
        } else {
          console.error("musubi-opencode continuity unavailable", result.detail || "unknown")
        }
      } catch (error) {
        console.error("musubi-opencode continuity unavailable", String(error).slice(0, 200))
      }
    })

    const controller = new AbortController()
    const captured = new Set()
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          if (event.type !== "session.execution.succeeded") continue
          const sessionID = event.data?.sessionID
          if (typeof sessionID !== "string") continue
          try {
            const session = await ctx.session.get({ sessionID })
            if (session.parentID) continue
            const messages = await ctx.session.context({ sessionID })
            const turn = completedTurn(session, messages)
            if (!turn) continue
            const key = `${turn.session_id}:${turn.user_id}`
            if (captured.has(key)) continue
            const result = await bridge({ action: "capture", turn })
            if (!result.ok) {
              console.error("musubi-opencode capture unavailable", result.detail || "unknown")
              continue
            }
            captured.add(key)
            if (captured.size > 1000) captured.clear()
          } catch (error) {
            console.error("musubi-opencode capture unavailable", String(error).slice(0, 200))
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) console.error("musubi-opencode events unavailable", String(error).slice(0, 200))
      }
    })()
    return () => controller.abort()
  },
})
