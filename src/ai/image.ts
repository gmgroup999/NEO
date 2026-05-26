import OpenAI from 'openai'
import { GoogleGenerativeAI } from '@google/generative-ai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export type ImageProvider = 'gemini' | 'openai'

export interface ImageResult {
  url: string
  revisedPrompt: string
  costUsd: number
  provider: ImageProvider
  model: string
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

async function generateImageGemini(prompt: string): Promise<ImageResult> {
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!)
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-image' })

  const result = await (model as any).generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
  })

  const parts = result.response.candidates?.[0]?.content?.parts ?? []
  const imgPart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith('image/'))
  if (!imgPart) throw new Error('No image in Gemini response')

  const { mimeType, data: b64 } = imgPart.inlineData
  return {
    url:           `data:${mimeType};base64,${b64}`,
    revisedPrompt: prompt,
    costUsd:       0.02,
    provider:      'gemini',
    model:         'gemini-2.5-flash-image',
  }
}

async function generateImageOpenAI(prompt: string, size = '1024x1024'): Promise<ImageResult> {
  const validSizes = ['1024x1024', '1536x1024', '1024x1536']
  const resolvedSize = validSizes.includes(size) ? size : '1024x1024'
  const response = await openai.images.generate({
    model: 'gpt-image-1',
    prompt,
    n: 1,
    size: resolvedSize as any,
    quality: 'medium',
  })

  const image = response.data?.[0]
  if (!image) throw new Error('No image returned')

  const url = image.url ?? (image.b64_json ? `data:image/png;base64,${image.b64_json}` : null)
  if (!url) throw new Error('No image URL or base64 in response')

  return {
    url,
    revisedPrompt: (image as any).revised_prompt ?? prompt,
    costUsd: 0.042,
    provider: 'openai',
    model: 'gpt-image-1',
  }
}

export async function generateImage(prompt: string, provider: ImageProvider = 'gemini', size?: string): Promise<ImageResult> {
  if (provider === 'openai') return generateImageOpenAI(prompt, size)
  return generateImageGemini(prompt)
}
