export async function callHermes(
  message: string,
  systemPrompt: string
): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
  const res = await fetch(`${process.env.OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL ?? 'hermes4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      stream: false,
    }),
  })

  const data = await res.json() as any
  return {
    content: data.message?.content ?? '',
    promptTokens: data.prompt_eval_count ?? 0,
    completionTokens: data.eval_count ?? 0,
  }
}
