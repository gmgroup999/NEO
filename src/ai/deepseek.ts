import OpenAI from 'openai'
import type { ConversationTurn } from './claude'

const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com',
})

export async function callDeepSeek(
  message: string,
  systemPrompt: string,
  history: ConversationTurn[] = [],
  onToken?: (token: string) => void
): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
  const historyMessages = history.map(t => ({
    role: t.role as 'user' | 'assistant',
    content: t.content,
  }))

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...historyMessages,
    { role: 'user', content: message },
  ]

  if (onToken) {
    const stream = await deepseek.chat.completions.create({
      model: 'deepseek-chat',
      messages,
      stream: true,
      stream_options: { include_usage: true },
    })
    let content = ''
    let promptTokens = 0
    let completionTokens = 0
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content
      if (delta) { onToken(delta); content += delta }
      if (chunk.usage) {
        promptTokens = chunk.usage.prompt_tokens
        completionTokens = chunk.usage.completion_tokens
      }
    }
    return { content, promptTokens, completionTokens }
  }

  const res = await deepseek.chat.completions.create({ model: 'deepseek-chat', messages })
  return {
    content: res.choices[0].message.content ?? '',
    promptTokens: res.usage?.prompt_tokens ?? 0,
    completionTokens: res.usage?.completion_tokens ?? 0,
  }
}
