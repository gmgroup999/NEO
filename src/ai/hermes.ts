import type { ConversationTurn } from './claude'

export async function callHermes(
  message: string,
  systemPrompt: string,
  history: ConversationTurn[] = [],
  onToken?: (token: string) => void
): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
  const historyMessages = history.map(t => ({
    role: t.role as 'user' | 'assistant',
    content: t.content,
  }))

  const body = JSON.stringify({
    model: process.env.OLLAMA_MODEL ?? 'hermes4',
    messages: [
      { role: 'system', content: systemPrompt },
      ...historyMessages,
      { role: 'user', content: message },
    ],
    stream: !!onToken,
  })

  const res = await fetch(`${process.env.OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })

  if (onToken) {
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let content = ''
    let promptTokens = 0
    let completionTokens = 0
    let buf = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const data = JSON.parse(line) as any
          const token = data.message?.content
          if (token) { onToken(token); content += token }
          if (data.done) {
            promptTokens = data.prompt_eval_count ?? 0
            completionTokens = data.eval_count ?? 0
          }
        } catch {}
      }
    }
    return { content, promptTokens, completionTokens }
  }

  const data = await res.json() as any
  return {
    content: data.message?.content ?? '',
    promptTokens: data.prompt_eval_count ?? 0,
    completionTokens: data.eval_count ?? 0,
  }
}
