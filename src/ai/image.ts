import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export interface ImageResult {
  url: string
  revisedPrompt: string
  costUsd: number
}

// Remove Thai tone marks for fuzzy matching (handles misplaced ้ ่ ๊ ๋)
function stripTones(text: string): string {
  return text.replace(/[่-๋]/g, '')
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
  const normalized = stripTones(lower)

  // Match triggers with tone-insensitive comparison
  const hasTrigger = triggers.some(t => normalized.includes(stripTones(t)))
  if (!hasTrigger) return false
  if (questions.some(q => normalized.includes(stripTones(q)))) return false
  if (message.trim().endsWith('?') || message.trim().endsWith('？')) return false

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
    model: 'gpt-image-1',
    prompt,
    n: 1,
    size: '1024x1024',
    quality: 'medium',
  })

  const image = response.data?.[0]
  if (!image) throw new Error('No image returned')

  // gpt-image-1 returns b64_json by default, dall-e-3 returns url
  const url = image.url ?? (image.b64_json ? `data:image/png;base64,${image.b64_json}` : null)
  if (!url) throw new Error('No image URL or base64 in response')

  return {
    url,
    revisedPrompt: (image as any).revised_prompt ?? prompt,
    costUsd: 0.042,
  }
}
