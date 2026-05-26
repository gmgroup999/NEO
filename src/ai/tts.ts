const ELEVENLABS_API = 'https://api.elevenlabs.io/v1'

export const DEFAULT_VOICE_ID   = '21m00Tcm4TlvDq8ikWAM'  // Rachel
export const DEFAULT_VOICE_NAME = 'Rachel'

export interface ElevenLabsVoice {
  voice_id:    string
  name:        string
  labels:      Record<string, string>
  preview_url: string | null
  category:    string
}

export async function generateSpeech(
  text:    string,
  voiceId: string = DEFAULT_VOICE_ID,
  model:   string = 'eleven_multilingual_v2'
): Promise<Buffer> {
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) throw new Error('ELEVENLABS_API_KEY not configured')

  const res = await fetch(`${ELEVENLABS_API}/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: model,
      voice_settings: {
        stability:          0.5,
        similarity_boost:   0.75,
        style:              0.0,
        use_speaker_boost:  true,
      },
    }),
    signal: AbortSignal.timeout(20000),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any
    throw new Error(err.detail?.message ?? `ElevenLabs ${res.status}: ${res.statusText}`)
  }

  return Buffer.from(await res.arrayBuffer())
}

// Fallback voices when API key lacks voices_read permission
const FALLBACK_VOICES: ElevenLabsVoice[] = [
  { voice_id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel',  labels: { gender: 'female', accent: 'american' }, preview_url: null, category: 'premade' },
  { voice_id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi',    labels: { gender: 'female', accent: 'american' }, preview_url: null, category: 'premade' },
  { voice_id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella',   labels: { gender: 'female', accent: 'american' }, preview_url: null, category: 'premade' },
  { voice_id: 'ErXwobaYiN019PkySvjV', name: 'Antoni',  labels: { gender: 'male',   accent: 'american' }, preview_url: null, category: 'premade' },
  { voice_id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli',    labels: { gender: 'female', accent: 'american' }, preview_url: null, category: 'premade' },
  { voice_id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh',    labels: { gender: 'male',   accent: 'american' }, preview_url: null, category: 'premade' },
  { voice_id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold',  labels: { gender: 'male',   accent: 'american' }, preview_url: null, category: 'premade' },
  { voice_id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam',    labels: { gender: 'male',   accent: 'american' }, preview_url: null, category: 'premade' },
  { voice_id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam',     labels: { gender: 'male',   accent: 'american' }, preview_url: null, category: 'premade' },
  { voice_id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel',  labels: { gender: 'male',   accent: 'british'  }, preview_url: null, category: 'premade' },
  { voice_id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte',labels: { gender: 'female', accent: 'british' }, preview_url: null, category: 'premade' },
  { voice_id: 'jsCqWAovK2LkecY7zXl4', name: 'Freya',   labels: { gender: 'female', accent: 'american' }, preview_url: null, category: 'premade' },
]

export async function listVoices(): Promise<ElevenLabsVoice[]> {
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) return FALLBACK_VOICES

  try {
    const res = await fetch(`${ELEVENLABS_API}/voices`, {
      headers: { 'xi-api-key': key },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return FALLBACK_VOICES
    const data = await res.json() as any
    const voices = (data.voices ?? []) as ElevenLabsVoice[]
    return voices.length > 0 ? voices : FALLBACK_VOICES
  } catch {
    return FALLBACK_VOICES
  }
}
