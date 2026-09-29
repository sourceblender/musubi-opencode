import { spawn } from "node:child_process"
import { Plugin } from "@opencode/plugin"
import { completedTurn } from "./turn.js"

const BRIDGE_TIMEOUT_MS = 28_000
const MAX_CONTINUITY_SESSIONS = 200

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
    if (!process.env.MUSUBI_ACTOR || !process.env.MUSUBI_PRESENCE || !process.env.MUSUBI_ZONE) {
      console.error("musubi-opencode unavailable: seat identity is missing; launch OpenCode with --standalone from the seat launcher")
    }
    const mcpBinary = process.env.MUSUBI_OPENCODE_MCP_BIN || "musubi-opencode-mcp"
    await ctx.mcp.transform((editor) => {
      editor.set("musubi", { type: "local", command: [mcpBinary] })
    })

    const continuityCache = new Map()
    const continuityHookSeen = new Set()
    const continuityAppliedCount = new Map()
    const contextHook = await ctx.session.hook("context", async (event) => {
      let cached = continuityCache.get(event.sessionID)
      if (!cached) {
        cached = (async () => {
          const session = await ctx.session.get({ sessionID: event.sessionID })
          if (session.parentID) return null
          const result = await bridge({ action: "continuity" })
          if (!result.ok || typeof result.text !== "string" || !result.text.trim()) {
            throw new Error(result.detail || "empty_block")
          }
          return result.text
        })()
        continuityCache.set(event.sessionID, cached)
        while (continuityCache.size > MAX_CONTINUITY_SESSIONS) {
          const oldest = continuityCache.keys().next().value
          continuityCache.delete(oldest)
          continuityHookSeen.delete(oldest)
          continuityAppliedCount.delete(oldest)
        }
      }
      try {
        const text = await cached
        if (!text) return
        if (!continuityHookSeen.has(event.sessionID)) {
          continuityHookSeen.add(event.sessionID)
          console.info("musubi-opencode continuity context hook", JSON.stringify({ session_id: event.sessionID }))
        }
        if (!event.system.some((part) => part.type === "text" && part.text === text)) {
          event.system.push({ type: "text", text })
        }
        const applied = (continuityAppliedCount.get(event.sessionID) || 0) + 1
        continuityAppliedCount.set(event.sessionID, applied)
        if (applied <= 2) {
          console.info("musubi-opencode continuity injected", JSON.stringify({ session_id: event.sessionID, chars: text.length, request: applied }))
        }
      } catch (error) {
        continuityCache.delete(event.sessionID)
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
    return async () => {
      controller.abort()
      continuityCache.clear()
      continuityHookSeen.clear()
      continuityAppliedCount.clear()
      await contextHook.dispose().catch((error) => {
        console.error("musubi-opencode continuity hook disposal failed", String(error).slice(0, 200))
      })
    }
  },
})
