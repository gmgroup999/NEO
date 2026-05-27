import { schedule as cronSchedule, validate as cronValidate, type ScheduledTask } from 'node-cron'
import { db } from '../db/client'
import { tgNotify } from './cron'
import { emitNeoEvent } from '../web/events'

interface CronJobRow {
  id: string
  name: string
  description: string | null
  schedule: string
  action_type: string
  action_config: any
  ai_model: string
  enabled: boolean
}

// jobId → list of scheduled tasks (main + optional report)
const activeTasks = new Map<string, ScheduledTask[]>()

// ─── DB helpers ───

async function loadJob(jobId: string): Promise<CronJobRow | null> {
  const r = await db.query('SELECT * FROM neo_cron_jobs WHERE id = $1', [jobId])
  return r.rows[0] ?? null
}

async function logJobRun(
  jobId: string,
  jobName: string,
  status: string,
  message: string,
  details?: any
): Promise<void> {
  await db.query(
    `INSERT INTO neo_cron_logs (job_name, status, message, details, job_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [jobName, status, message.slice(0, 2000), details ? JSON.stringify(details) : null, jobId]
  ).catch(console.error)
}

// ─── Action handlers ───

async function runDailyReport(job: CronJobRow) {
  const { callDeepSeek } = await import('../ai/deepseek')
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().split('T')[0]

  const costs = await db.query(
    `SELECT model, call_count, total_cost_usd FROM neo_costs_daily WHERE date = $1 ORDER BY total_cost_usd DESC`,
    [yesterday]
  ).catch(() => ({ rows: [] as any[] }))

  if (!costs.rows.length) {
    return { status: 'skipped', message: `ไม่มีข้อมูล cost วันที่ ${yesterday}` }
  }

  const total = costs.rows.reduce((s: number, r: any) => s + parseFloat(r.total_cost_usd), 0)
  const breakdown = costs.rows
    .map((r: any) => `${r.model}: $${parseFloat(r.total_cost_usd).toFixed(4)} (${r.call_count} calls)`)
    .join('\n')

  const { content } = await callDeepSeek(
    `NEO cost report ${yesterday}:\n${breakdown}\nรวม: $${total.toFixed(4)}\nวิเคราะห์ใน 2 ประโยค`,
    'คุณวิเคราะห์ค่าใช้จ่าย AI ตอบภาษาไทย กระชับ'
  )

  const report = `📊 Cost Report ${yesterday}\n${breakdown}\n💰 รวม: $${total.toFixed(4)}\n\n${content}`
  await tgNotify(report)
  return { status: 'success', message: report, details: { total, models: costs.rows } }
}

async function runMemoryCleanup(job: CronJobRow) {
  const { minImportance = 3, olderThanDays = 7 } = job.action_config ?? {}

  const result = await db.query(
    `DELETE FROM neo_memories
     WHERE importance <= $1
       AND source = 'ai-extracted'
       AND created_at < NOW() - ($2 || ' days')::INTERVAL
     RETURNING id`,
    [minImportance, olderThanDays]
  )

  const deleted = result.rowCount ?? 0
  const message = `🧹 Memory cleanup: ลบ ${deleted} memories (importance ≤ ${minImportance}, อายุ > ${olderThanDays} วัน)`
  return { status: 'success', message, details: { deleted } }
}

async function runSpendAlert(job: CronJobRow) {
  const budget = parseFloat(process.env.NEO_MONTHLY_BUDGET ?? '10')

  const r = await db.query(
    `SELECT COALESCE(SUM(cost_usd), 0) AS total FROM neo_ai_calls
     WHERE date_trunc('month', created_at) = date_trunc('month', NOW())`
  ).catch(() => ({ rows: [{ total: 0 }] }))

  const spent = parseFloat(r.rows[0].total)
  const pct = Math.round((spent / budget) * 100)

  if (pct < 50) {
    return { status: 'success', message: `💰 Monthly: $${spent.toFixed(2)}/$${budget} (${pct}%) — ปกติดี`, details: { spent, budget, pct } }
  }

  const emoji = pct >= 100 ? '🚨' : pct >= 80 ? '⚠️' : '💛'
  const note  = pct >= 100 ? 'เกิน budget แล้ว!' : pct >= 80 ? 'ใกล้ถึง budget' : 'ผ่าน 50% แล้ว'
  const msg   = `${emoji} NEO Spend Alert\n$${spent.toFixed(2)} / $${budget} (${pct}%)\n${note}`
  await tgNotify(msg)
  return { status: 'success', message: msg, details: { spent, budget, pct } }
}

async function runYoutubeSummary(job: CronJobRow) {
  const { channels = [], maxVideosPerChannel = 3, sinceHours = 48 } = job.action_config ?? {}
  if (!channels.length) throw new Error('ไม่มี channels ใน config — แก้ไข job แล้วเพิ่ม channel IDs')

  const { fetchChannelVideos, summarizeYouTubeDigest } = await import('../ai/youtube')

  const results = await Promise.all(
    (channels as Array<{ channelId: string; name?: string }>)
      .map(ch => fetchChannelVideos(ch.channelId, maxVideosPerChannel, sinceHours))
  )

  const summary = await summarizeYouTubeDigest(results, job.ai_model)
  const totalVideos = results.reduce((s, r) => s + r.videos.length, 0)
  const message = `🎬 YouTube Digest — ${totalVideos} videos จาก ${channels.length} ช่อง\n\n${summary}`

  return {
    status: 'success', message,
    details: { totalVideos, channels: results.map(r => ({ name: r.channelName, count: r.videos.length, error: r.error })) },
  }
}

// ─── SSRF guard ───
// ป้องกัน web_scrape cron ถูกใช้เพื่อ probe internal network
function isSafeUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr)
    // อนุญาตเฉพาะ http / https
    if (!['http:', 'https:'].includes(u.protocol)) return false
    const h = u.hostname.toLowerCase()
    // Block localhost variants
    if (h === 'localhost' || h === '0.0.0.0') return false
    // Block metadata endpoints
    if (h === 'metadata.google.internal' || h === '169.254.169.254') return false
    // Block IPv6 loopback / link-local
    if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc00:') || h.startsWith('fd')) return false
    // Block private IPv4 ranges using regex
    if (/^127\./.test(h)) return false                          // 127.0.0.0/8
    if (/^10\./.test(h)) return false                           // 10.0.0.0/8
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false     // 172.16-31.x
    if (/^192\.168\./.test(h)) return false                     // 192.168.x.x
    if (/^0\./.test(h)) return false                            // 0.x.x.x
    if (/^100\.6[4-9]\.|^100\.[7-9]\d\.|^100\.1[01]\d\.|^100\.12[0-7]\./.test(h)) return false // CGNAT 100.64/10
    return true
  } catch {
    return false
  }
}

async function runWebScrape(job: CronJobRow) {
  const { urls = [], prompt = 'สรุปเนื้อหาจาก URLs เหล่านี้เป็นภาษาไทย' } = job.action_config ?? {}
  if (!urls.length) throw new Error('ไม่มี URLs ใน config')

  // ตรวจ SSRF ทุก URL ก่อน fetch
  const safeUrls = (urls as string[]).filter(u => {
    if (!isSafeUrl(u)) {
      console.warn(`[web_scrape] SSRF blocked: ${u}`)
      return false
    }
    return true
  })
  if (!safeUrls.length) throw new Error('ทุก URL ถูก block เนื่องจาก SSRF policy (ห้าม fetch internal network)')

  const scraped = await Promise.all(
    safeUrls.map(async url => {
      try {
        const res  = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Mozilla/5.0 NEO-Bot/1.0' } })
        const html = await res.text()
        const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3000)
        return `URL: ${url}\n${text}`
      } catch (e: any) {
        return `URL: ${url}\nError: ${e.message}`
      }
    })
  )

  const { callDeepSeek } = await import('../ai/deepseek')
  const { content } = await callDeepSeek(
    `${prompt}\n\n${scraped.join('\n\n---\n\n')}`,
    'คุณสรุปเนื้อหาจากเว็บ ตอบภาษาไทย กระชับ'
  )

  if (job.action_config?.sendToTelegram !== false) await tgNotify(`🌐 ${job.name}\n\n${content}`)
  return { status: 'success', message: content, details: { urls } }
}

// ─── RSS helpers ───

function extractTag(xml: string, tag: string): string {
  const m = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${tag}>`, 'i').exec(xml)
  return (m?.[1] ?? m?.[2] ?? '').trim().replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'")
}

function parseRss(xml: string): Array<{ title: string; link: string; pubDate: Date | null; description: string }> {
  const items: Array<{ title: string; link: string; pubDate: Date | null; description: string }> = []
  const re = /<item[^>]*>([\s\S]*?)<\/item>/gi
  let m
  while ((m = re.exec(xml)) !== null) {
    const raw = m[1]
    const title = extractTag(raw, 'title')
    const link  = extractTag(raw, 'link') || extractTag(raw, 'guid')
    const pub   = extractTag(raw, 'pubDate') || extractTag(raw, 'dc:date') || extractTag(raw, 'published')
    const desc  = (extractTag(raw, 'content:encoded') || extractTag(raw, 'description')).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0, 300)
    items.push({ title, link, pubDate: pub ? new Date(pub) : null, description: desc })
  }
  return items
}

async function runRssDigest(job: CronJobRow) {
  const {
    feeds = [] as Array<{ url: string; name?: string }>,
    maxItemsPerFeed = 5,
    sinceHours = 24,
    sendToTelegram = true,
  } = job.action_config ?? {}

  if (!feeds.length) throw new Error('ไม่มี feeds ใน config — เพิ่ม [{url, name}] ใน action_config')

  const cutoff = new Date(Date.now() - sinceHours * 3_600_000)
  const allItems: string[] = []

  for (const feed of feeds as Array<{ url: string; name?: string }>) {
    try {
      const res = await fetch(feed.url, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'NEO/1.0 RSS Reader' } })
      const xml  = await res.text()
      const items = parseRss(xml)
        .filter(i => !i.pubDate || i.pubDate >= cutoff)
        .slice(0, maxItemsPerFeed)

      if (!items.length) continue
      allItems.push(`## ${feed.name ?? feed.url}\n` + items.map(i => `- ${i.title}\n  ${i.description}`).join('\n'))
    } catch (e: any) {
      allItems.push(`## ${feed.name ?? feed.url}\n❌ ${e.message}`)
    }
  }

  if (!allItems.length) {
    return { status: 'success', message: `📰 RSS Digest — ไม่มีบทความใหม่ใน ${sinceHours}h ที่ผ่านมา`, details: {} }
  }

  const { callDeepSeek } = await import('../ai/deepseek')
  const { content } = await callDeepSeek(
    `สรุปข่าวและบทความเหล่านี้เป็นภาษาไทย กระชับ เน้น insight ที่สำคัญ:\n\n${allItems.join('\n\n---\n\n')}`,
    'คุณสรุปข่าวและบทความ ตอบภาษาไทย'
  )

  const message = `📰 ${job.name}\n\n${content}`
  if (sendToTelegram) await tgNotify(message)
  return { status: 'success', message, details: { feeds: feeds.length, items: allItems.length } }
}

async function runProjectSync(_job: CronJobRow) {
  const fs   = await import('fs/promises')
  const path = await import('path')

  // Load all projects — explicit path takes priority over auto-scan
  const projectRows = await db.query('SELECT project_id, name, claude_md_path FROM neo_projects')
    .catch(() => ({ rows: [] as any[] }))
  const knownIds = new Set(projectRows.rows.map((r: any) => r.project_id as string))

  // Build explicit-path map
  const explicitPaths = new Map<string, string>() // projectId → path
  for (const r of projectRows.rows) {
    if (r.claude_md_path) explicitPaths.set(r.project_id, r.claude_md_path)
  }

  // Recursively find CLAUDE.md files (auto-scan for projects without explicit path)
  const SKIP_DIRS = new Set(['.git', 'node_modules', '.next', 'dist', 'build', '__pycache__', '.venv'])
  async function findFiles(dir: string, depth = 0): Promise<string[]> {
    if (depth > 5) return []
    const out: string[] = []
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const e of entries) {
        if (e.name.startsWith('.') && e.name !== '.') continue
        if (SKIP_DIRS.has(e.name)) continue
        const full = path.join(dir, e.name)
        if (e.isFile() && /CLAUDE\.md$/i.test(e.name)) out.push(full)
        else if (e.isDirectory()) out.push(...await findFiles(full, depth + 1))
      }
    } catch { /* unreadable dir — skip */ }
    return out
  }

  const scannedFiles: string[] = []
  for (const root of ['/mnt/opt', '/mnt/home']) {
    try { scannedFiles.push(...await findFiles(root)) } catch {}
  }

  // Merge: explicit paths + auto-scanned files (skip if already covered by explicit)
  const GENERIC = new Set(['app', 'apps', 'src', 'projects', 'opt', 'home', 'jack', 'mnt', 'backend', 'frontend', 'api', 'web'])

  function extractProjectId(filePath: string): string {
    const segments = filePath.replace(/^\/mnt\/(opt|home)\//, '').split('/').slice(0, -1).filter(s => s && !GENERIC.has(s))
    for (const seg of [...segments].reverse()) { if (knownIds.has(seg)) return seg }
    return segments[0] ?? path.basename(path.dirname(filePath))
  }

  // Build final file→projectId map
  const toSync = new Map<string, string>() // filePath → projectId

  // 1. Explicit paths first
  for (const [pid, p] of explicitPaths) toSync.set(p, pid)

  // 2. Auto-scanned (skip files whose projectId is already covered by explicit)
  const coveredByExplicit = new Set(explicitPaths.keys())
  for (const f of scannedFiles) {
    const pid = extractProjectId(f)
    if (!coveredByExplicit.has(pid)) toSync.set(f, pid)
  }

  if (!toSync.size) return { status: 'success', message: '📁 Project Sync — ไม่พบ CLAUDE.md ใดๆ', details: {} }

  const syncedAt = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })
  const results: string[] = []

  for (const [filePath, projectId] of toSync) {
    try {
      const content = await fs.readFile(filePath, 'utf8')

      await db.query(
        `INSERT INTO neo_projects (project_id, name, description, status)
         VALUES ($1, $2, 'Auto-discovered', 'active')
         ON CONFLICT (project_id) DO NOTHING`,
        [projectId, projectId]
      ).catch(console.error)
      knownIds.add(projectId)

      const prev = await db.query(
        `SELECT content FROM neo_memories WHERE project_id = $1 AND source = 'project-sync' ORDER BY created_at DESC LIMIT 1`,
        [projectId]
      ).catch(() => ({ rows: [] as any[] }))

      const prevRaw = (prev.rows[0]?.content ?? '').replace(/^\[Synced:.*?\]\n\n/, '')
      if (prev.rows.length && prevRaw === content) { results.push(`${projectId}: ไม่มีการเปลี่ยนแปลง`); continue }

      await db.query(`DELETE FROM neo_memories WHERE project_id = $1 AND source = 'project-sync'`, [projectId]).catch(console.error)
      await db.query(
        `INSERT INTO neo_memories (scope, category, project_id, content, source, importance, tags)
         VALUES ('project', 'context', $1, $2, 'project-sync', 8, $3)`,
        [projectId, `[Synced: ${syncedAt}]\n\n${content}`, [projectId, 'project-doc']]
      )
      results.push(`${projectId}: ✅ ${content.length} chars`)
    } catch (e: any) {
      results.push(e.code === 'ENOENT' ? `${projectId}: ⏭️ ไม่พบไฟล์ที่ ${filePath}` : `${projectId}: ❌ ${e.message}`)
    }
  }

  const message = `📁 Project Sync ${syncedAt}\n${results.map(r => `• ${r}`).join('\n')}`
  if (results.some(r => r.includes('✅'))) await tgNotify(message)
  return { status: 'success', message, details: { total: toSync.size, results } }
}

async function runMemorySynthesis(_job: CronJobRow) {
  const { callClaude } = await import('../ai/claude')
  const { saveMemory } = await import('./memory')

  const result = await db.query(`
    SELECT scope, category, project_id, content, importance
    FROM neo_memories
    WHERE importance >= 5
      AND source != 'synthesis'
      AND created_at >= NOW() - INTERVAL '7 days'
    ORDER BY importance DESC, created_at DESC
    LIMIT 80
  `).catch(() => ({ rows: [] as any[] }))

  if (result.rows.length < 5) {
    return { status: 'skipped', message: 'ยังมี memories ไม่พอสำหรับ synthesis', details: {} }
  }

  const memoriesText = result.rows.map((r: any) =>
    `[${r.scope}/${r.category}${r.project_id ? `/${r.project_id}` : ''}] imp:${r.importance} — ${r.content}`
  ).join('\n')

  const prompt = `นี่คือ memories ของ Jack จาก 7 วันที่ผ่านมา:\n\n${memoriesText}\n\nสังเคราะห์ 3-7 insights ระดับสูงจาก memories เหล่านี้ — patterns, ความชอบ, แนวโน้มที่ซ่อนอยู่\n\nReturn ONLY JSON array:\n[{"scope":"jack"|"global","category":"insight"|"preference"|"rule","content":"insight สังเคราะห์ (max 150 chars) ภาษาไทย","importance":7-9,"projectId":"project_id หรือ null"}]\n\nRules:\n- เน้น patterns ที่เห็นจากหลาย memory รวมกัน ไม่ใช่แค่ copy\n- ต้องเป็นสิ่งใหม่ที่ไม่มีใน memory เดิม\n- Return [] ถ้าไม่มี pattern ที่น่าสนใจ`

  const aiResult = await callClaude(
    prompt,
    'You synthesize patterns from memories. Return only valid JSON arrays, nothing else.',
    'claude-haiku-4-5-20251001'
  )

  const jsonMatch = aiResult.content.match(/\[[\s\S]*?\]/)
  if (!jsonMatch) return { status: 'success', message: '🧠 Synthesis: ไม่พบ patterns ใหม่', details: {} }

  const insights = JSON.parse(jsonMatch[0]) as Array<{
    scope: 'jack' | 'global'
    category: 'rule' | 'decision' | 'fact' | 'preference' | 'insight' | 'context'
    content: string
    importance: number
    projectId?: string
  }>

  // ลบ synthesis เก่าก่อน (ไม่ให้สะสม)
  await db.query(`DELETE FROM neo_memories WHERE source = 'synthesis' AND created_at < NOW() - INTERVAL '2 days'`)
    .catch(console.error)

  let saved = 0
  for (const ins of insights) {
    if (ins.content && ins.importance >= 7) {
      await saveMemory({
        scope: ins.scope ?? 'jack',
        category: ins.category ?? 'insight',
        content: ins.content,
        importance: ins.importance,
        projectId: ins.projectId ?? undefined,
        source: 'synthesis',
      }).catch(console.error)
      saved++
    }
  }

  const message = `🧠 Memory Synthesis: สร้าง ${saved} insights จาก ${result.rows.length} memories`
  await tgNotify(message)
  return { status: 'success', message, details: { saved, inputMemories: result.rows.length } }
}

async function runCustomPrompt(job: CronJobRow) {
  const { prompt, sendToTelegram = true } = job.action_config ?? {}
  if (!prompt) throw new Error('ไม่มี prompt ใน config')

  let content = ''
  const m = job.ai_model

  if (m === 'gemini' || m === 'gemini-flash') {
    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    const genAI  = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!)
    const model  = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
    const result = await model.generateContent(prompt)
    content = result.response.text()
  } else if (m.startsWith('claude')) {
    const { callClaude } = await import('../ai/claude')
    const modelId = m === 'claude-haiku' ? 'claude-haiku-4-5-20251001'
      : m === 'claude-opus' ? 'claude-opus-4-7' : 'claude-sonnet-4-6'
    const r = await callClaude(prompt, 'You are a helpful assistant', modelId)
    content = r.content
  } else {
    const { callDeepSeek } = await import('../ai/deepseek')
    const r = await callDeepSeek(prompt, 'You are a helpful assistant')
    content = r.content
  }

  if (sendToTelegram) await tgNotify(`🤖 ${job.name}\n\n${content}`)
  return { status: 'success', message: content }
}

// ─── Dispatch ───

async function executeAction(job: CronJobRow): Promise<{ status: string; message: string; details?: any }> {
  switch (job.action_type) {
    case 'daily_report':    return runDailyReport(job)
    case 'memory_cleanup':  return runMemoryCleanup(job)
    case 'spend_alert':     return runSpendAlert(job)
    case 'youtube_summary': return runYoutubeSummary(job)
    case 'web_scrape':      return runWebScrape(job)
    case 'custom_prompt':   return runCustomPrompt(job)
    case 'project_sync':      return runProjectSync(job)
    case 'rss_digest':        return runRssDigest(job)
    case 'memory_synthesis':  return runMemorySynthesis(job)
    default: throw new Error(`Unknown action type: ${job.action_type}`)
  }
}

// ─── Execution with logging ───

async function executeJobWithLogging(jobId: string): Promise<void> {
  const job = await loadJob(jobId)
  if (!job || !job.enabled) return

  console.log(`[cron] ▶ ${job.name}`)
  emitNeoEvent({ type: 'cron_start', channel: 'system', data: { name: job.name, id: jobId }, timestamp: Date.now() })
  await db.query(
    'UPDATE neo_cron_jobs SET last_run_at = NOW(), last_status = $1 WHERE id = $2',
    ['running', jobId]
  ).catch(console.error)

  try {
    const result = await executeAction(job)
    await db.query(
      'UPDATE neo_cron_jobs SET last_status = $1, last_message = $2, updated_at = NOW() WHERE id = $3',
      [result.status, result.message.slice(0, 500), jobId]
    ).catch(console.error)
    await logJobRun(jobId, job.name, result.status, result.message, result.details)
    console.log(`[cron] ✅ ${job.name} → ${result.status}`)
    emitNeoEvent({ type: 'cron_done', channel: 'system', data: { name: job.name, id: jobId, message: result.message.slice(0, 80) }, timestamp: Date.now() })
  } catch (err: any) {
    const errMsg = (err.message ?? 'Unknown error').slice(0, 500)
    await db.query(
      'UPDATE neo_cron_jobs SET last_status = $1, last_message = $2, updated_at = NOW() WHERE id = $3',
      ['error', errMsg, jobId]
    ).catch(console.error)
    await logJobRun(jobId, job.name, 'error', errMsg)
    await tgNotify(`❌ ${job.name} ล้มเหลว\n${errMsg}`)
    console.error(`[cron] ❌ ${job.name}:`, errMsg)
    emitNeoEvent({ type: 'cron_error', channel: 'system', data: { name: job.name, id: jobId, message: errMsg.slice(0, 80) }, timestamp: Date.now() })
  }
}

// Send the stored report via Telegram (for jobs with reportSchedule)
async function sendStoredReport(jobId: string): Promise<void> {
  const job = await loadJob(jobId)
  if (!job) return

  const log = await db.query(
    `SELECT message FROM neo_cron_logs
     WHERE job_id = $1 AND status = 'success'
     ORDER BY ran_at DESC LIMIT 1`,
    [jobId]
  ).catch(() => ({ rows: [] as any[] }))

  if (log.rows.length) {
    await tgNotify(`📊 ${job.name} — รายงานประจำวัน\n\n${log.rows[0].message}`)
  }
}

// ─── Scheduler ───

async function scheduleJob(job: CronJobRow): Promise<void> {
  // Cancel existing tasks for this job
  const existing = activeTasks.get(job.id) ?? []
  existing.forEach(t => t.stop())
  activeTasks.delete(job.id)

  if (!job.enabled) return

  if (!cronValidate(job.schedule)) {
    console.warn(`[cron] Invalid schedule for "${job.name}": ${job.schedule}`)
    return
  }

  const tasks: ScheduledTask[] = []

  tasks.push(
    cronSchedule(job.schedule, () => executeJobWithLogging(job.id), { timezone: 'Asia/Bangkok' })
  )

  const reportSchedule = job.action_config?.reportSchedule
  if (reportSchedule && cronValidate(reportSchedule)) {
    tasks.push(
      cronSchedule(reportSchedule, () => sendStoredReport(job.id), { timezone: 'Asia/Bangkok' })
    )
  }

  activeTasks.set(job.id, tasks)

  const reportNote = reportSchedule ? ` + report ${reportSchedule}` : ''
  console.log(`[cron] 📅 Scheduled: "${job.name}" (${job.schedule}${reportNote})`)
}

// ─── Public API ───

export async function startDynamicCron(): Promise<void> {
  const jobs = await db.query('SELECT * FROM neo_cron_jobs WHERE enabled = true')
    .catch(() => ({ rows: [] as any[] }))

  for (const job of jobs.rows) await scheduleJob(job)
  console.log(`⏰ Dynamic cron: ${jobs.rows.length} jobs scheduled`)
}

export async function reloadJob(jobId: string): Promise<void> {
  const job = await loadJob(jobId)
  if (!job) {
    const existing = activeTasks.get(jobId) ?? []
    existing.forEach(t => t.stop())
    activeTasks.delete(jobId)
    return
  }
  await scheduleJob(job)
}

export async function runJobNow(jobId: string): Promise<void> {
  return executeJobWithLogging(jobId)
}

export function getActiveJobCount(): number {
  return activeTasks.size
}

// Natural language → job config via DeepSeek
export async function parseJobFromNL(input: string): Promise<Partial<CronJobRow & { action_config: any }>> {
  const { callDeepSeek } = await import('../ai/deepseek')

  const systemPrompt = `You parse natural language cron job descriptions into structured JSON.
Available action_types: youtube_summary, web_scrape, custom_prompt, spend_alert, memory_cleanup, daily_report, project_sync, rss_digest
Available ai_models: gemini, deepseek, claude-haiku, claude-sonnet, none

action_config fields:
- youtube_summary: { channels: [{channelId, name}], maxVideosPerChannel: 3, sinceHours: 48, reportSchedule: "cron expr" }
- web_scrape: { urls: [], prompt: "...", sendToTelegram: true }
- custom_prompt: { prompt: "...", sendToTelegram: true }
- memory_cleanup: { minImportance: 3, olderThanDays: 7 }
- spend_alert: {}
- daily_report: { reportType: "cost" }

Return ONLY valid JSON, no markdown.`

  const userPrompt = `Parse this job description:
"${input}"

Return JSON:
{
  "name": "short name",
  "description": "what it does in Thai",
  "schedule": "cron expression",
  "action_type": "...",
  "action_config": {...},
  "ai_model": "...",
  "enabled": true
}`

  const { content } = await callDeepSeek(userPrompt, systemPrompt)
  const match = content.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('Could not parse job config from AI response')
  return JSON.parse(match[0])
}
