// src/ai/qwen.ts — Qwen 2.5 via Ollama (local, $0)
export async function callQwen(
  message: string,
  systemPrompt: string
): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'
  const model   = process.env.OLLAMA_MODEL    ?? 'qwen2.5'

  const controller = new AbortController()
  const timeout    = setTimeout(() => controller.abort(), 30_000)

  try {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: message },
        ],
        stream: false,
      }),
    })
    clearTimeout(timeout)

    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`)

    const data    = await res.json() as any
    const content = data.message?.content ?? ''
    if (!content.trim()) throw new Error('Qwen returned empty response')

    return {
      content,
      promptTokens:     data.prompt_eval_count ?? 0,
      completionTokens: data.eval_count         ?? 0,
    }
  } catch (err) {
    clearTimeout(timeout)
    throw err
  }
}
