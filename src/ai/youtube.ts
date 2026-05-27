export interface VideoInfo {
  videoId: string
  title: string
  description: string
  publishedAt: Date
  url: string
  channelId: string
  channelName: string
}

export interface ChannelResult {
  channelId: string
  channelName: string
  videos: VideoInfo[]
  error?: string
}

function decodeXML(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .trim()
}

function parseRSSFeed(xml: string, channelId: string): VideoInfo[] {
  const videos: VideoInfo[] = []
  const entries = xml.split('<entry>').slice(1)

  for (const entry of entries) {
    const videoId = entry.match(/<yt:videoId>(.*?)<\/yt:videoId>/)?.[1]?.trim()
    if (!videoId) continue

    const title       = decodeXML(entry.match(/<title>(.*?)<\/title>/)?.[1] ?? '')
    const description = decodeXML(entry.match(/<media:description>([\s\S]*?)<\/media:description>/)?.[1] ?? '').slice(0, 600)
    const published   = entry.match(/<published>(.*?)<\/published>/)?.[1] ?? ''
    const channelName = decodeXML(entry.match(/<name>(.*?)<\/name>/)?.[1] ?? '')

    videos.push({
      videoId,
      title,
      description,
      publishedAt: published ? new Date(published) : new Date(0),
      url: `https://www.youtube.com/watch?v=${videoId}`,
      channelId,
      channelName,
    })
  }

  return videos
}

export async function fetchChannelVideos(
  channelId: string,
  maxVideos = 3,
  sinceHours = 48
): Promise<ChannelResult> {
  const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`

  try {
    const res = await fetch(rssUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) {
      const hint = res.status === 404
        ? `RSS 404 — channel ID อาจผิด หรือ YouTube บล็อก VPS IP (Hetzner ถูกบล็อกบ่อย) ลอง verify ที่: https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
        : `RSS ${res.status} for channel ${channelId}`
      throw new Error(hint)
    }

    const xml = await res.text()
    const all = parseRSSFeed(xml, channelId)
    const since = new Date(Date.now() - sinceHours * 3_600_000)
    const recent = all.filter(v => v.publishedAt >= since).slice(0, maxVideos)

    return { channelId, channelName: all[0]?.channelName || channelId, videos: recent }
  } catch (err: any) {
    return { channelId, channelName: channelId, videos: [], error: err.message }
  }
}

export async function summarizeYouTubeDigest(
  results: ChannelResult[],
  aiModel: string
): Promise<string> {
  const withVideos = results.filter(r => r.videos.length > 0)

  if (!withVideos.length) {
    const errors = results.filter(r => r.error).map(r => `${r.channelId}: ${r.error}`).join(', ')
    return `ไม่มี video ใหม่ในช่วงเวลาที่กำหนด${errors ? `\nErrors: ${errors}` : ''}`
  }

  const content = withVideos.map(ch =>
    `**${ch.channelName}**\n` + ch.videos.map(v =>
      `  • ${v.title}\n    ${v.description.slice(0, 250)}\n    ${v.url}`
    ).join('\n')
  ).join('\n\n')

  const noVideos = results.filter(r => !r.videos.length && !r.error)
  const noVideoNote = noVideos.length
    ? `\n\nช่องที่ไม่มี video ใหม่: ${noVideos.map(r => r.channelName || r.channelId).join(', ')}`
    : ''

  const prompt = `วันนี้ ${new Date().toLocaleDateString('th-TH')} — ข่าว AI จาก YouTube ช่องไทย

${content}${noVideoNote}

กรุณาสรุปให้ Jack (เจ้าของ personal AI brain ชื่อ NEO):
1. **ประเด็นร้อน** — 3-5 ข้อที่น่าสนใจที่สุด
2. **เทรนด์** — theme ที่ซ้ำกันหลายช่อง
3. **ควรดูเพิ่ม** — video ที่ไม่ควรพลาด พร้อม URL

ตอบภาษาไทย กระชับ ไม่เกิน 400 คำ`

  if (aiModel === 'deepseek') {
    const { callDeepSeek } = await import('./deepseek')
    const r = await callDeepSeek(prompt, 'คุณสรุปข่าว AI จาก YouTube ให้กระชับ ตรงประเด็น ภาษาไทย')
    return r.content
  }

  // Default: Gemini Flash (context window ใหญ่, รองรับภาษาไทยดี)
  const { GoogleGenerativeAI } = await import('@google/generative-ai')
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!)
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
  const result = await model.generateContent(prompt)
  return result.response.text()
}
