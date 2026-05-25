import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function callClaude(
  message: string,
  systemPrompt: string,
  model: string = 'claude-sonnet-4-5'
): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
  const res = await anthropic.messages.create({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: message }],
  })

  return {
    content: res.content[0].type === 'text' ? res.content[0].text : '',
    promptTokens: res.usage.input_tokens,
    completionTokens: res.usage.output_tokens,
  }
}
