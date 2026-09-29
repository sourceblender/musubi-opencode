/** Project only the completed primary user/assistant turn onto Musubi's envelope. */
export function completedTurn(session, messages) {
  if (session?.parentID || session?.outcome === "failed" || session?.outcome === "interrupted") return null
  if (!Array.isArray(messages)) return null

  let userIndex = -1
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.type === "user") {
      userIndex = index
      break
    }
  }
  if (userIndex < 0) return null
  const user = messages[userIndex]
  if (typeof user.id !== "string" || typeof user.text !== "string" || !user.text.trim()) return null

  const suffix = messages.slice(userIndex + 1)
  const idle = suffix.findLast((item) => item?.type === "idle")
  if (idle && idle.outcome !== "succeeded") return null
  if (!idle && session?.outcome !== "succeeded") return null

  const assistant = suffix.findLast(
    (item) => item?.type === "assistant" && item.finish === "stop" &&
      !item.error && Number.isFinite(item.time?.completed),
  )
  if (!assistant) return null
  const assistantText = assistant.content
    ?.filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")
  if (!assistantText) return null
  const model = assistant.model
  return {
    session_id: session.id,
    user_id: user.id,
    user_text: user.text,
    assistant_text: assistantText,
    completed_at: assistant.time.completed,
    model: model?.providerID && model?.id ? `${model.providerID}/${model.id}` : undefined,
  }
}
