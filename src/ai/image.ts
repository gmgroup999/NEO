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
  const questions = [
    'ได้มั้ย', 'ได้ไหม', 'ทำได้มั้ย', 'ทำได้ไหม', 'สามารถ', 'รองรับ',
    'can you', 'could you', 'do you', 'support',
  ]
  const lower = message.toLowerCase()
  if (!triggers.some(t => lower.includes(t))) return false
  if (questions.some(q => lower.includes(q))) return false
  if (message.trim().endsWith('?') || message.trim().endsWith('？')) return false

  // Require meaningful prompt after removing trigger keywords
  const cleaned = extractImagePrompt(message)
  return cleaned.length >= 3
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
