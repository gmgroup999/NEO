import { GoogleGenerativeAI } from '@google/generative-ai'
import type { ConversationTurn } from './claude'

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!)

export async function callGemini(
  message: string,
  systemPrompt: string,
  history: ConversationTurn[] = [],
  onToken?: (token: string) => void
): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
  const model = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
    systemInstruction: systemPrompt,
  })

  const chat = model.startChat({
    history: history.map(t => ({
      role: t.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: t.content }],
    })),
  })

  if (onToken) {
    const streamResult = await chat.sendMessageStream(message)
    let content = ''
    for await (const chunk of streamResult.stream) {
      const text = chunk.text()
      if (text) { onToken(text); content += text }
    }
    const finalResponse = await streamResult.response
    const usage = finalResponse.usageMetadata
    return {
      content,
      promptTokens: usage?.promptTokenCount ?? 0,
      completionTokens: usage?.candidatesTokenCount ?? 0,
    }
  }

  const result = await chat.sendMessage(message)
  const text = result.response.text()
  const usage = result.response.usageMetadata

  return {
    content: text,
    promptTokens: usage?.promptTokenCount ?? 0,
    completionTokens: usage?.candidatesTokenCount ?? 0,
  }
}
