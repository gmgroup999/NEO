const GOOGLE_TTS_API = 'https://texttospeech.googleapis.com/v1/text:synthesize'

export interface GoogleVoice {
  id: string          // e.g. "google:th-TH-Neural2-C"
  name: string        // display name
  languageCode: string
  voiceName: string   // Google voice name
  gender: 'MALE' | 'FEMALE'
  tier: 'Standard' | 'Wavenet' | 'Neural2'
}

export const GOOGLE_THAI_VOICES: GoogleVoice[] = [
  { id: 'google:th-TH-Neural2-C', name: '🇹🇭 Neural2-C (ชาย)', languageCode: 'th-TH', voiceName: 'th-TH-Neural2-C', gender: 'MALE',   tier: 'Neural2'   },
  { id: 'google:th-TH-Wavenet-A', name: '🇹🇭 Wavenet-A (หญิง)', languageCode: 'th-TH', voiceName: 'th-TH-Wavenet-A', gender: 'FEMALE', tier: 'Wavenet'   },
  { id: 'google:th-TH-Wavenet-B', name: '🇹🇭 Wavenet-B (ชาย)',  languageCode: 'th-TH', voiceName: 'th-TH-Wavenet-B', gender: 'MALE',   tier: 'Wavenet'   },
  { id: 'google:th-TH-Wavenet-C', name: '🇹🇭 Wavenet-C (ชาย)',  languageCode: 'th-TH', voiceName: 'th-TH-Wavenet-C', gender: 'MALE',   tier: 'Wavenet'   },
  { id: 'google:th-TH-Wavenet-D', name: '🇹🇭 Wavenet-D (หญิง)', languageCode: 'th-TH', voiceName: 'th-TH-Wavenet-D', gender: 'FEMALE', tier: 'Wavenet'   },
  { id: 'google:th-TH-Standard-A', name: '🇹🇭 Standard-A (หญิง)', languageCode: 'th-TH', voiceName: 'th-TH-Standard-A', gender: 'FEMALE', tier: 'Standard' },
  { id: 'google:th-TH-Standard-B', name: '🇹🇭 Standard-B (ชาย)',  languageCode: 'th-TH', voiceName: 'th-TH-Standard-B', gender: 'MALE',   tier: 'Standard' },
  { id: 'google:th-TH-Standard-C', name: '🇹🇭 Standard-C (ชาย)',  languageCode: 'th-TH', voiceName: 'th-TH-Standard-C', gender: 'MALE',   tier: 'Standard' },
  { id: 'google:th-TH-Standard-D', name: '🇹🇭 Standard-D (หญิง)', languageCode: 'th-TH', voiceName: 'th-TH-Standard-D', gender: 'FEMALE', tier: 'Standard' },
]

export async function generateSpeechGoogle(
  text: string,
  voiceName: string,
  languageCode: string = 'th-TH'
): Promise<Buffer> {
  const key = process.env.GOOGLE_TTS_KEY || process.env.GOOGLE_API_KEY
  if (!key) throw new Error('GOOGLE_TTS_KEY not configured')

  const res = await fetch(`${GOOGLE_TTS_API}?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { text: text.slice(0, 5000) },
      voice: { languageCode, name: voiceName },
      audioConfig: { audioEncoding: 'MP3', speakingRate: 1.0, pitch: 0 },
    }),
    signal: AbortSignal.timeout(20000),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any
    throw new Error(err.error?.message ?? `Google TTS ${res.status}: ${res.statusText}`)
  }

  const data = await res.json() as { audioContent: string }
  return Buffer.from(data.audioContent, 'base64')
}
