export interface SearchResult {
  title: string
  url: string
  content: string
  score: number
}

export async function webSearch(query: string, maxResults = 5): Promise<SearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) return []
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, query, search_depth: 'basic', max_results: maxResults }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return []
    const data = await res.json() as { results?: SearchResult[] }
    return data.results ?? []
  } catch {
    return []
  }
}

export function shouldSearch(message: string): boolean {
  if (!process.env.TAVILY_API_KEY) return false
  const msg = message.toLowerCase()
  return (
    /^@search\b/.test(msg) ||
    msg.includes('ค้นหา') ||
    msg.includes('ข่าวล่าสุด') ||
    msg.includes('ราคาตอนนี้') ||
    msg.includes('ราคาล่าสุด') ||
    (msg.includes('วันนี้') && (msg.includes('ราคา') || msg.includes('ข่าว') || msg.includes('อัปเดต'))) ||
    /(latest news|current price|today.*price|price.*today)/.test(msg)
  )
}

export function formatSearchContext(results: SearchResult[]): string {
  if (!results.length) return ''
  const items = results.slice(0, 4).map(r =>
    `**${r.title}**\n${r.content.slice(0, 400)}\nSource: ${r.url}`
  ).join('\n\n')
  return `## ข้อมูลจาก Web (real-time)\n${items}\n\n`
}
