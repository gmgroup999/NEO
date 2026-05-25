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

  const image = response.data?.[0]
  if (!image) throw new Error('No image returned from DALL-E')

  return {
    url: image.url!,
    revisedPrompt: image.revised_prompt ?? prompt,
    costUsd: 0.04,
  }
}
