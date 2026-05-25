import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export interface ImageResult {
  url: string
  revisedPrompt: string
  costUsd: number
}

export function isImageRequest(message: string): boolean {
  const triggers = [
    'สร้างภาพ', 'วาดภาพ', 'สร้างรูป', 'ทำภาพ',
    'generate image', 'create image', 'draw',
    '@dalle', '@dall-e', 'dall-e',
    'ภาพของ', 'รูปของ',
  ]
  return triggers.some(t => message.toLowerCase().includes(t))
}

export function extractImagePrompt(message: string): string {
  const removals = [
    'สร้างภาพ', 'วาดภาพ', 'สร้างรูป', 'ทำภาพ',
    'generate image', 'create image', 'draw me', 'draw',
    '@dalle', '@dall-e', 'dall-e',
    'ภาพของ', 'รูปของ',
  ]
  let prompt = message
  removals.forEach(r => { prompt = prompt.replace(new RegExp(r, 'gi'), '') })
  return prompt.trim()
}

export async function generateImage(prompt: string): Promise<ImageResult> {
  const response = await openai.images.generate({
    model: 'dall-e-3',
    prompt,
    n: 1,
    size: '1024x1024',
    quality: 'standard',
    response_format: 'url',
  })

  return {
    url: response.data[0].url!,
    revisedPrompt: response.data[0].revised_prompt ?? prompt,
    costUsd: 0.04, // DALL-E 3 standard 1024x1024
  }
}
