import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export interface ConversationTurn {
  role: 'user' | 'assistant'
  content: string
}

export async function callClaude(
  message: string,
  systemPrompt: string,
  model: string = 'claude-sonnet-4-6',
  history: ConversationTurn[] = [],
  onToken?: (token: string) => void
): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
  const messages: Anthropic.MessageParam[] = [
    ...history.map(t => ({ role: t.role, content: t.content })),
    { role: 'user', content: message },
  ]

  if (onToken) {
    const stream = await anthropic.messages.create({
      model, max_tokens: 4096, system: systemPrompt, messages, stream: true,
    })
    let content = ''
    let promptTokens = 0
    let completionTokens = 0
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        onToken(event.delta.text)
        content += event.delta.text
      } else if (event.type === 'message_start') {
        promptTokens = event.message.usage?.input_tokens ?? 0
      } else if (event.type === 'message_delta') {
        completionTokens = (event as any).usage?.output_tokens ?? 0
      }
    }
    return { content, promptTokens, completionTokens }
  }

  const res = await anthropic.messages.create({ model, max_tokens: 4096, system: systemPrompt, messages })
  return {
    content: res.content[0].type === 'text' ? res.content[0].text : '',
    promptTokens: res.usage.input_tokens,
    completionTokens: res.usage.output_tokens,
  }
}
