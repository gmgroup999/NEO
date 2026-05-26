import OpenAI from 'openai'
import type { ConversationTurn } from './claude'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function callOpenAI(
  message: string,
  systemPrompt: string,
  imageBase64?: string,
  imageMime?: string,
  history: ConversationTurn[] = [],
  onToken?: (token: string) => void
): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
  const historyMessages: OpenAI.ChatCompletionMessageParam[] = history.map(t => ({
    role: t.role,
    content: t.content,
  }))

  const userContent: OpenAI.ChatCompletionContentPart[] = [
    { type: 'text', text: message || 'ช่วยวิเคราะห์ภาพนี้ให้หน่อยครับ' },
  ]

  if (imageBase64) {
    userContent.push({
      type: 'image_url',
      image_url: {
        url: `data:${imageMime ?? 'image/jpeg'};base64,${imageBase64}`,
        detail: 'high',
      },
    })
  }

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...historyMessages,
    { role: 'user', content: imageBase64 ? userContent : message },
  ]

  if (onToken) {
    const stream = await openai.chat.completions.create({
      model: 'gpt-4o',
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

  const res = await openai.chat.completions.create({ model: 'gpt-4o', messages })
  return {
    content: res.choices[0].message.content ?? '',
    promptTokens: res.usage?.prompt_tokens ?? 0,
    completionTokens: res.usage?.completion_tokens ?? 0,
  }
}
