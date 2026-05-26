import { GoogleGenerativeAI } from '@google/generative-ai'

const GEMINI_FILES_API = 'https://generativelanguage.googleapis.com/upload/v1beta/files'

// Upload video to Gemini Files API (for files > 20MB)
async function uploadToGeminiFiles(buffer: Buffer, mimeType: string): Promise<string> {
  const key = process.env.GOOGLE_API_KEY!

  // Initiate resumable upload
  const initRes = await fetch(`${GEMINI_FILES_API}?key=${key}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol':        'resumable',
      'X-Goog-Upload-Command':         'start',
      'X-Goog-Upload-Header-Content-Length': String(buffer.length),
      'X-Goog-Upload-Header-Content-Type':   mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { displayName: 'neo-video' } }),
  })

  const uploadUrl = initRes.headers.get('x-goog-upload-url')
  if (!uploadUrl) throw new Error('Failed to initiate Gemini file upload')

  // Upload bytes
  const uploadRes = await fetch(uploadUrl, {
    method:  'POST',
    headers: {
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Offset':  '0',
      'Content-Type': mimeType,
    },
    body: buffer,
    signal: AbortSignal.timeout(120000),
  })

  const fileData = await uploadRes.json() as any
  const fileUri  = fileData.file?.uri
  if (!fileUri) throw new Error('No file URI returned from Gemini Files API')

  // Poll until ACTIVE
  const statusUrl = `${fileData.file.name ? `https://generativelanguage.googleapis.com/v1beta/${fileData.file.name}?key=${key}` : ''}`
  if (statusUrl && statusUrl !== `https://generativelanguage.googleapis.com/v1beta/?key=${key}`) {
    for (let i = 0; i < 30; i++) {
      const st = await fetch(statusUrl).then(r => r.json()) as any
      if (st.state === 'ACTIVE') break
      if (st.state === 'FAILED') throw new Error('Gemini file processing failed')
      await new Promise(r => setTimeout(r, 2000))
    }
  }

  return fileUri
}

// Analyze a video file with Gemini
export async function analyzeVideo(
  videoBuffer: Buffer,
  mimeType:    string,
  prompt:      string = 'วิเคราะห์วิดีโอนี้ สรุปเนื้อหา ประเด็นสำคัญ และ key insights เป็นภาษาไทย'
): Promise<{ content: string; model: string; costUsd: number }> {
  const key = process.env.GOOGLE_API_KEY
  if (!key) throw new Error('GOOGLE_API_KEY not configured')

  const genAI = new GoogleGenerativeAI(key)
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

  let videoPart: any

  if (videoBuffer.length <= 20 * 1024 * 1024) {
    // Small file → inline base64
    videoPart = {
      inlineData: {
        data:     videoBuffer.toString('base64'),
        mimeType,
      },
    }
  } else {
    // Large file → Files API
    const fileUri = await uploadToGeminiFiles(videoBuffer, mimeType)
    videoPart = { fileData: { mimeType, fileUri } }
  }

  const result = await model.generateContent([videoPart, { text: prompt }])
  const content = result.response.text()

  // Estimate cost: video ≈ 258 tokens/second, text output ~500 tokens
  // gemini-2.0-flash: $0.075/1M input tokens
  const durationSec = Math.min(videoBuffer.length / 100_000, 300) // rough estimate
  const inputTokens = durationSec * 258
  const costUsd = (inputTokens / 1_000_000) * 0.075

  return { content, model: 'gemini-2.0-flash', costUsd }
}

// Analyze a single image frame (for live camera)
export async function analyzeFrame(
  frameBase64: string,
  prompt:      string = 'อธิบายสิ่งที่เห็นในภาพนี้ให้ละเอียด'
): Promise<{ content: string; model: string; costUsd: number }> {
  const key = process.env.GOOGLE_API_KEY
  if (!key) throw new Error('GOOGLE_API_KEY not configured')

  const genAI  = new GoogleGenerativeAI(key)
  const model  = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
  const result = await model.generateContent([
    { inlineData: { data: frameBase64, mimeType: 'image/jpeg' } },
    { text: prompt },
  ])

  const content = result.response.text()
  const costUsd = 258 / 1_000_000 * 0.075 // 1 frame ≈ 258 tokens

  return { content, model: 'gemini-2.0-flash', costUsd }
}
