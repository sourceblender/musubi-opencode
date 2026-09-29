import { expect, test } from "bun:test"
import { completedTurn } from "../plugin/turn.js"

const session = { id: "ses_main", outcome: "succeeded" }
const user = { type: "user", id: "msg_user", text: "What changed?", time: { created: 1 } }
const final = {
  type: "assistant", id: "msg_final", finish: "stop", time: { created: 2, completed: 3 },
  model: { providerID: "qwen-lan", id: "qwen3.8-flash-next" },
  content: [{ type: "reasoning", text: "private" }, { type: "text", text: "The code changed." }],
}

test("captures only the completed final text", () => {
  expect(completedTurn(session, [user, { type: "assistant", finish: "tool-calls" }, final, { type: "idle", outcome: "succeeded" }]))
    .toEqual({
      session_id: "ses_main", user_id: "msg_user", user_text: "What changed?",
      assistant_text: "The code changed.", completed_at: 3,
      model: "qwen-lan/qwen3.8-flash-next",
    })
})

test("refuses subagents, interrupted turns, and incomplete outputs", () => {
  expect(completedTurn({ ...session, parentID: "ses_parent" }, [user, final])).toBeNull()
  expect(completedTurn(session, [user, final, { type: "idle", outcome: "interrupted" }])).toBeNull()
  expect(completedTurn(session, [user, { ...final, time: { created: 2 } }])).toBeNull()
})
