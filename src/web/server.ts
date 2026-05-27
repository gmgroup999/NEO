import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import staticPlugin from '@fastify/static'
import { join } from 'path'
import { routeAndCall, parseMention, RouteRequest } from '../core/router'
import type { ConversationTurn } from '../ai/claude'
import { buildContext, extractMemoriesFromConversation, recallMemories, saveMemory, invalidateProjectCache } from '../core/memory'
import { generateImage, isImageRequest, extractImagePrompt, type ImageProvider } from '../ai/image'
import { logAICall, db, saveMessage } from '../db/client'
import { shouldSearch, webSearch, formatSearchContext } from '../ai/search'
import { neoEvents, NeoEvent } from './events'
import { randomUUID } from 'crypto'
import {
  requireAuth,
  checkPassword,
  createSessionToken,
  setSessionCookie,
  clearSessionCookie,
  parseCookies,
  verifySessionToken,
} from './auth'

const app = Fastify({ logger: false, bodyLimit: 10 * 1024 * 1024 }) // 10MB
app.register(multipart, { limits: { fileSize: 200 * 1024 * 1024 } }) // 200MB for video

// ─── Security headers — ทุก response ───
// CSP ใช้ 'unsafe-inline' เพราะ Web UI เป็น SPA ที่ใช้ inline scripts/styles
// frame-ancestors 'none' ป้องกัน clickjacking
app.addHook('onSend', (_req, reply, _payload, done) => {
  reply.header('X-Content-Type-Options', 'nosniff')
  reply.header('X-Frame-Options', 'DENY')
  reply.header('X-XSS-Protection', '1; mode=block')
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  reply.header(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",       // SPA ใช้ inline script
      "style-src 'self' 'unsafe-inline'",         // SPA ใช้ inline style
      "img-src 'self' data: blob: https:",        // รูปภาพจาก AI + data URI
      "media-src 'self' blob:",                   // TTS audio blob
      "connect-src 'self'",                       // SSE + API calls
      "frame-ancestors 'none'",                   // ป้องกัน clickjacking
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')
  )
  done()
})

// ─── Auth hook — ต้องอยู่ก่อน static plugin ───
app.addHook('onRequest', requireAuth)

app.register(staticPlugin, {
  root: join(process.cwd(), 'public'),
  prefix: '/',
})

// ─── Auth routes ───
app.post('/api/auth/login', async (req, reply) => {
  const { password } = req.body as { password?: string }
  if (!password || !checkPassword(password)) {
    await new Promise(r => setTimeout(r, 500)) // delay ป้องกัน brute force
    return reply.status(401).send({ error: 'รหัสผ่านไม่ถูกต้อง' })
  }
  const token = createSessionToken()
  setSessionCookie(reply, token)
  return { ok: true }
})

app.post('/api/auth/logout', async (req, reply) => {
  clearSessionCookie(reply)
  return { ok: true }
})

app.get('/api/auth/me', async (req, reply) => {
  const cookies = parseCookies(req.headers.cookie)
  const valid = verifySessionToken(cookies['neo_session'] || '')
  if (!valid) return reply.status(401).send({ error: 'unauthorized' })
  return { ok: true, user: 'jack' }
})

// ─── Login page ───
app.get('/login', async (req, reply) => {
  return reply.sendFile('login.html')
})

// ─── Chat API ───
app.post('/api/chat', async (req, reply) => {
  const { message, sessionId = randomUUID(), history = [], imageBase64, imageMime, imageProvider, imageSize } = req.body as {
    message: string
    sessionId?: string
    history?: ConversationTurn[]
    imageBase64?: string
    imageMime?: string
    imageProvider?: ImageProvider
    imageSize?: string
  }

  if (isImageRequest(message)) {
    const prompt = extractImagePrompt(message)
    const provider: ImageProvider = imageProvider === 'openai' ? 'openai' : 'gemini'

    try {
      const result = await generateImage(prompt, provider, imageSize)

      logAICall({
        sessionId,
        model: result.model,
        provider: result.provider === 'openai' ? 'openai' : 'google',
        taskType: 'image',
        routedBy: 'manual',
        promptTokens: 0,
        completionTokens: 0,
        costUsd: result.costUsd,
        latencyMs: 0,
      }).catch(console.error)

      return {
        type: 'image',
        imageUrl: result.url,
        revisedPrompt: result.revisedPrompt,
        model: result.model,
        provider: result.provider,
        costUsd: result.costUsd,
        sessionId,
      }
    } catch (err: any) {
      console.error('Image error:', err)
      const isModeration = err?.error?.code === 'moderation_blocked' || err?.message?.includes('safety')
      const providerName = provider === 'openai' ? 'OpenAI' : 'Gemini'
      const msg = isModeration
        ? `${providerName} ปฏิเสธ prompt นี้ (content policy) — ลองเปลี่ยน prompt หรือสลับ provider ครับ`
        : `Image generation failed (${providerName}): ${err.message}`
      return reply.status(500).send({ error: msg })
    }
  }

  const { model: forcedModel, cleanMessage } = parseMention(message)
  const msgForContext = cleanMessage || message

  // Web search injection (parallel with context build when search needed)
  const [systemPromptBase, searchResults] = await Promise.all([
    buildContext(msgForContext, history.slice(-6)),
    shouldSearch(msgForContext) ? webSearch(msgForContext) : Promise.resolve([]),
  ])
  const searchCtx = formatSearchContext(searchResults)
  const systemPrompt = searchCtx + systemPromptBase

  const response = await routeAndCall({
    message: msgForContext,
    systemPrompt,
    sessionId,
    forcedModel: forcedModel ?? undefined,
    history: history.slice(-20),
    imageBase64,
    imageMime,
  })

  saveMessage({ sessionId, source: 'web', role: 'user', content: message })
  saveMessage({ sessionId, source: 'web', role: 'assistant', content: response.content, model: response.model, costUsd: response.costUsd })

  extractMemoriesFromConversation(msgForContext, response.content, sessionId)
    .catch(console.error)

  return {
    type: 'text',
    content: response.content,
    model: response.model,
    routedBy: response.routedBy,
    costUsd: response.costUsd,
    latencyMs: response.latencyMs,
    sessionId,
  }
})

// ─── Rate limiter — ป้องกัน /api/chat/stream cost blowup ───
// Default: 30 requests per minute per IP (ปรับได้ด้วย RATE_LIMIT_PER_MIN)
const _rateLimitWindow = 60_000 // 1 นาที
const _rateLimitMax    = parseInt(process.env.RATE_LIMIT_PER_MIN ?? '30')
const _rateStore       = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now()
  const entry = _rateStore.get(ip)

  if (!entry || now > entry.resetAt) {
    _rateStore.set(ip, { count: 1, resetAt: now + _rateLimitWindow })
    return { allowed: true }
  }

  if (entry.count >= _rateLimitMax) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
    return { allowed: false, retryAfter }
  }

  entry.count++
  return { allowed: true }
}

// Cleanup stale rate-limit entries ทุก 5 นาที (ไม่ให้ Map โต)
setInterval(() => {
  const now = Date.now()
  for (const [ip, entry] of _rateStore) {
    if (now > entry.resetAt) _rateStore.delete(ip)
  }
}, 5 * 60_000)

// ─── Cost Alert — emit SSE when daily cost crosses threshold ───
const _alertedDays = new Map<string, Set<number>>() // date → Set of alerted thresholds

async function checkCostAlert() {
  const threshold = parseFloat(process.env.DAILY_COST_ALERT_USD ?? '1.0')
  if (!threshold) return
  const today = new Date().toISOString().slice(0, 10)
  try {
    const r = await db.query(
      `SELECT COALESCE(SUM(total_cost_usd), 0)::float AS total FROM neo_costs_daily WHERE date = CURRENT_DATE`
    )
    const total: number = r.rows[0].total
    if (total < threshold) return
    if (!_alertedDays.has(today)) _alertedDays.set(today, new Set())
    const alerted = _alertedDays.get(today)!
    if (alerted.has(threshold)) return
    alerted.add(threshold)
    neoEvents.emit('neo', { type: 'cost_alert', channel: 'system', data: { todayCost: total, threshold }, timestamp: Date.now() })
  } catch { /* non-critical */ }
}

// ─── Chat Stream API — SSE token-by-token ───
app.post('/api/chat/stream', async (req, reply) => {
  // Rate limit — ตรวจก่อน hijack เพื่อส่ง 429 ปกติได้
  const ip = req.headers['x-forwarded-for']?.toString().split(',')[0].trim()
          ?? req.ip
          ?? 'unknown'
  const rl = checkRateLimit(ip)
  if (!rl.allowed) {
    return reply
      .status(429)
      .header('Retry-After', String(rl.retryAfter))
      .send({ error: `Too many requests — รอ ${rl.retryAfter}s แล้วลองใหม่` })
  }

  const { message, sessionId: sid = randomUUID(), history = [], imageBase64, imageMime, imageProvider, imageSize } = req.body as {
    message: string
    sessionId?: string
    history?: ConversationTurn[]
    imageBase64?: string
    imageMime?: string
    imageProvider?: ImageProvider
    imageSize?: string
  }

  reply.hijack()
  const raw = reply.raw
  raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  const sessionId = sid
  const sse = (data: object) => raw.write(`data: ${JSON.stringify(data)}\n\n`)

  try {
    if (isImageRequest(message)) {
      const prompt = extractImagePrompt(message)
      const provider: ImageProvider = imageProvider === 'openai' ? 'openai' : 'gemini'
      const result = await generateImage(prompt, provider, imageSize)
      logAICall({
        sessionId, model: result.model,
        provider: result.provider === 'openai' ? 'openai' : 'google',
        taskType: 'image', routedBy: 'manual',
        promptTokens: 0, completionTokens: 0, costUsd: result.costUsd, latencyMs: 0,
      }).catch(console.error)
      sse({ type: 'image', imageUrl: result.url, revisedPrompt: result.revisedPrompt, model: result.model, provider: result.provider, costUsd: result.costUsd, sessionId })
    } else {
      const { model: forcedModel, cleanMessage } = parseMention(message)
      const msgForContext = cleanMessage || message

      const [systemPromptBase, searchResults] = await Promise.all([
        buildContext(msgForContext, history.slice(-6)),
        shouldSearch(msgForContext) ? webSearch(msgForContext) : Promise.resolve([]),
      ])
      const systemPrompt = formatSearchContext(searchResults) + systemPromptBase

      const result = await routeAndCall({
        message: msgForContext,
        systemPrompt,
        sessionId,
        forcedModel: forcedModel ?? undefined,
        history: history.slice(-20),
        imageBase64,
        imageMime,
        onToken: (token: string) => sse({ type: 'token', token }),
      })

      sse({ type: 'done', model: result.model, routedBy: result.routedBy, costUsd: result.costUsd, latencyMs: result.latencyMs, sessionId })

      saveMessage({ sessionId, source: 'web', role: 'user', content: message }).catch(console.error)
      saveMessage({ sessionId, source: 'web', role: 'assistant', content: result.content, model: result.model, costUsd: result.costUsd }).catch(console.error)
      extractMemoriesFromConversation(msgForContext, result.content, sessionId).catch(console.error)
      checkCostAlert().catch(console.error)
    }
  } catch (err: any) {
    const isModeration = err?.error?.code === 'moderation_blocked' || err?.message?.includes('safety')
    sse({ type: 'error', error: isModeration ? 'Content policy — ลองเปลี่ยน prompt ครับ' : (err.message || 'เกิดข้อผิดพลาด') })
  }

  raw.end()
})

// ─── TTS — Google Cloud TTS (Thai) + ElevenLabs (others) ───
app.get('/api/tts', async (req, reply) => {
  const { text, voiceId } = req.query as { text: string; voiceId?: string }
  if (!text) return reply.status(400).send({ error: 'text required' })

  // Google Cloud TTS voices (prefixed google:)
  if (voiceId?.startsWith('google:')) {
    try {
      const { generateSpeechGoogle, GOOGLE_THAI_VOICES } = await import('../ai/gtts')
      const voice = GOOGLE_THAI_VOICES.find(v => v.id === voiceId)
      if (!voice) return reply.status(400).send({ error: 'unknown Google voice' })
      const audio = await generateSpeechGoogle(text.slice(0, 5000), voice.voiceName, voice.languageCode)
      reply.header('Content-Type', 'audio/mpeg')
      reply.header('Cache-Control', 'no-cache')
      return reply.send(audio)
    } catch (err: any) {
      console.error('[TTS] Google Cloud error:', err.message)
      return reply.status(502).send({ error: err.message })
    }
  }

  // ElevenLabs voices
  if (process.env.ELEVENLABS_API_KEY) {
    try {
      const { generateSpeech } = await import('../ai/tts')
      const audio = await generateSpeech(text.slice(0, 1000), voiceId)
      reply.header('Content-Type', 'audio/mpeg')
      reply.header('Cache-Control', 'no-cache')
      return reply.send(audio)
    } catch (err: any) {
      console.error('[TTS] ElevenLabs error:', err.message)
    }
  }

  return reply.status(502).send({ error: 'TTS unavailable' })
})

// ─── TTS Voices — Google Thai + ElevenLabs ───
app.get('/api/tts/voices', async () => {
  const { listVoices } = await import('../ai/tts')
  const { GOOGLE_THAI_VOICES } = await import('../ai/gtts')

  const elevenVoices = await listVoices()
  const googleVoices = GOOGLE_THAI_VOICES.map(v => ({
    id:         v.id,
    name:       v.name,
    labels:     { gender: v.gender === 'FEMALE' ? 'female' : 'male', language: 'thai', tier: v.tier },
    previewUrl: null,
    category:   'google',
  }))

  const eleven = elevenVoices.map(v => ({
    id:         v.voice_id,
    name:       v.name,
    labels:     v.labels,
    previewUrl: v.preview_url,
    category:   v.category,
  }))

  // Google Thai voices first, then ElevenLabs
  return [...googleVoices, ...eleven]
})

// ─── Video Analysis — clip upload ───
app.post('/api/analyze-video', async (req, reply) => {
  const data = await req.file()
  if (!data) return reply.status(400).send({ error: 'video file required' })

  const mimeType = data.mimetype || 'video/mp4'
  const prompt   = (req.query as any).prompt || 'วิเคราะห์วิดีโอนี้ สรุปเนื้อหา ประเด็นสำคัญ และ key insights เป็นภาษาไทย'

  const chunks: Buffer[] = []
  for await (const chunk of data.file) chunks.push(chunk)
  const videoBuffer = Buffer.concat(chunks)

  const { analyzeVideo } = await import('../ai/video')
  const result = await analyzeVideo(videoBuffer, mimeType, prompt)

  logAICall({ sessionId: randomUUID(), model: result.model, provider: 'google', taskType: 'video', routedBy: 'manual', promptTokens: 0, completionTokens: 0, costUsd: result.costUsd, latencyMs: 0 }).catch(console.error)

  return result
})

// ─── Video Frame Analysis — live camera ───
app.post('/api/analyze-frame', async (req, reply) => {
  const { frameBase64, prompt, sessionId = randomUUID() } = req.body as { frameBase64: string; prompt?: string; sessionId?: string }
  if (!frameBase64) return reply.status(400).send({ error: 'frameBase64 required' })

  const { analyzeFrame } = await import('../ai/video')
  const result = await analyzeFrame(frameBase64, prompt)

  logAICall({ sessionId, model: result.model, provider: 'google', taskType: 'vision', routedBy: 'manual', promptTokens: 0, completionTokens: 0, costUsd: result.costUsd, latencyMs: 0 }).catch(console.error)

  return result
})

// ─── Memory API ───
app.get('/api/memories', async (req) => {
  const { query = 'jack projects', limit = 10 } = req.query as any
  return recallMemories(query, { limit: Number(limit) })
})

// ─── Status API ───
app.get('/api/status', async () => {
  const [costs, memCount, projectCount] = await Promise.all([
    db.query(`
      SELECT model, call_count, total_cost_usd
      FROM neo_costs_daily WHERE date = CURRENT_DATE
      ORDER BY total_cost_usd DESC
    `),
    db.query('SELECT COUNT(*) as count FROM neo_memories'),
    db.query("SELECT COUNT(*) as count FROM neo_projects WHERE status = 'active'"),
  ])

  const totalCost = costs.rows.reduce(
    (sum: number, r: any) => sum + parseFloat(r.total_cost_usd), 0
  )

  return {
    memories: parseInt(memCount.rows[0].count),
    activeProjects: parseInt(projectCount.rows[0].count),
    todayCost: totalCost,
    models: costs.rows,
  }
})

// ─── Usage API — สถิติรายละเอียด ───
app.get('/api/usage', async () => {
  const [today, week, month, byModel, recent] = await Promise.all([
    // วันนี้
    db.query(`
      SELECT
        COALESCE(SUM(total_cost_usd),0)  AS cost,
        COALESCE(SUM(call_count),0)       AS calls,
        COALESCE(SUM(total_tokens),0)     AS tokens
      FROM neo_costs_daily WHERE date = CURRENT_DATE
    `),
    // 7 วัน
    db.query(`
      SELECT
        COALESCE(SUM(total_cost_usd),0)  AS cost,
        COALESCE(SUM(call_count),0)       AS calls,
        COALESCE(SUM(total_tokens),0)     AS tokens
      FROM neo_costs_daily WHERE date >= CURRENT_DATE - 6
    `),
    // เดือนนี้
    db.query(`
      SELECT
        COALESCE(SUM(total_cost_usd),0)  AS cost,
        COALESCE(SUM(call_count),0)       AS calls,
        COALESCE(SUM(total_tokens),0)     AS tokens
      FROM neo_costs_daily
      WHERE date_trunc('month', date) = date_trunc('month', CURRENT_DATE)
    `),
    // แยกตาม model เดือนนี้
    db.query(`
      SELECT
        model,
        SUM(call_count)       AS calls,
        SUM(total_cost_usd)   AS cost,
        SUM(total_tokens)     AS tokens
      FROM neo_costs_daily
      WHERE date_trunc('month', date) = date_trunc('month', CURRENT_DATE)
      GROUP BY model ORDER BY cost DESC
    `),
    // 5 calls ล่าสุด
    db.query(`
      SELECT model, task_type, cost_usd, latency_ms, created_at
      FROM neo_ai_calls
      ORDER BY created_at DESC LIMIT 8
    `).catch(() => ({ rows: [] })),
  ])

  return {
    today:   today.rows[0],
    week:    week.rows[0],
    month:   month.rows[0],
    byModel: byModel.rows,
    recent:  recent.rows,
  }
})

// ─── Billing Balances API ───
app.get('/api/billing/balances', async () => {
  const results: Record<string, { balance: number | null; spentMonth: number; spentToday: number; source: 'api' | 'tracked' }> = {}

  // DeepSeek — มี public balance API
  try {
    const res = await fetch('https://api.deepseek.com/user/balance', {
      headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
      signal: AbortSignal.timeout(5000),
    })
    const data = await res.json() as any
    const info = data.balance_infos?.[0]
    results.deepseek = { balance: info ? parseFloat(info.total_balance) : null, spentMonth: 0, spentToday: 0, source: 'api' }
  } catch {
    results.deepseek = { balance: null, spentMonth: 0, spentToday: 0, source: 'tracked' }
  }

  // Monthly spend by provider
  const spendByProvider = await db.query(`
    SELECT provider, COALESCE(SUM(cost_usd), 0) AS spent
    FROM neo_ai_calls
    WHERE date_trunc('month', created_at) = date_trunc('month', NOW())
    GROUP BY provider
  `).catch(() => ({ rows: [] as any[] }))

  // Today's spend by provider
  const spendToday = await db.query(`
    SELECT provider, COALESCE(SUM(cost_usd), 0) AS spent
    FROM neo_ai_calls
    WHERE created_at::date = CURRENT_DATE
    GROUP BY provider
  `).catch(() => ({ rows: [] as any[] }))

  const providerMonth: Record<string, number> = {}
  spendByProvider.rows.forEach((r: any) => { providerMonth[r.provider] = parseFloat(r.spent) })

  const providerDay: Record<string, number> = {}
  spendToday.rows.forEach((r: any) => { providerDay[r.provider] = parseFloat(r.spent) })

  results.deepseek = { ...results.deepseek, spentMonth: providerMonth['deepseek'] ?? 0, spentToday: providerDay['deepseek'] ?? 0 }
  results.openai    = { balance: null, spentMonth: providerMonth['openai'] ?? 0, spentToday: providerDay['openai'] ?? 0, source: 'tracked' }
  results.anthropic = { balance: null, spentMonth: providerMonth['anthropic'] ?? 0, spentToday: providerDay['anthropic'] ?? 0, source: 'tracked' }
  results.google    = { balance: null, spentMonth: providerMonth['google'] ?? 0, spentToday: providerDay['google'] ?? 0, source: 'tracked' }
  results.local     = { balance: null, spentMonth: 0, spentToday: 0, source: 'tracked' }

  return results
})

// ─── Projects API ───
app.get('/api/projects', async () => {
  const r = await db.query('SELECT project_id, name, status, description, claude_md_path FROM neo_projects ORDER BY name')
  return r.rows
})

app.put('/api/projects/:projectId', async (req, reply) => {
  const { projectId } = req.params as { projectId: string }
  const { claude_md_path } = req.body as { claude_md_path?: string }
  await db.query(
    'UPDATE neo_projects SET claude_md_path = $1, updated_at = NOW() WHERE project_id = $2',
    [claude_md_path ?? null, projectId]
  )
  return { ok: true }
})

// ─── Feedback API ───
app.post('/api/feedback', async (req, reply) => {
  const { userMessage = '', aiResponse = '', rating } = req.body as {
    userMessage?: string
    aiResponse?: string
    rating: 'up' | 'down'
  }
  if (!rating || !['up', 'down'].includes(rating))
    return reply.status(400).send({ error: 'rating required: up | down' })

  const topic = userMessage.slice(0, 100)
  const snippet = aiResponse.slice(0, 200)

  if (rating === 'up') {
    await saveMemory({
      scope: 'jack',
      category: 'preference',
      content: `Jack ชอบวิธีที่ NEO ตอบเรื่อง: ${topic}`,
      importance: 6,
      source: 'feedback',
    }).catch(console.error)
  } else {
    await saveMemory({
      scope: 'jack',
      category: 'insight',
      content: `Jack ไม่พอใจคำตอบเรื่อง: ${topic}${snippet ? ` — NEO ตอบว่า: ${snippet}` : ''}`,
      importance: 9,
      source: 'feedback',
    }).catch(console.error)
  }

  return { ok: true }
})

// ─── History API ───
app.get('/api/history', async (req) => {
  const { search = '', source = '', limit = 50, offset = 0, date = '' } = req.query as any

  let where = 'WHERE 1=1'
  const params: any[] = []
  let p = 1

  if (search) {
    where += ` AND content ILIKE $${p++}`
    params.push(`%${search}%`)
  }
  if (source) {
    where += ` AND source = $${p++}`
    params.push(source)
  }
  if (date) {
    where += ` AND created_at::date = $${p++}`
    params.push(date)
  }

  const [rows, countRow] = await Promise.all([
    db.query(
      `SELECT id, session_id, source, role, content, model, cost_usd, created_at
       FROM neo_messages ${where}
       ORDER BY created_at DESC
       LIMIT $${p++} OFFSET $${p++}`,
      [...params, Number(limit), Number(offset)]
    ),
    db.query(
      `SELECT COUNT(*) as total FROM neo_messages ${where}`,
      params
    ),
  ])

  return {
    messages: rows.rows,
    total: parseInt(countRow.rows[0].total),
    limit: Number(limit),
    offset: Number(offset),
  }
})

// ─── Import .md → Memories ───
app.post('/api/import-md', async (req, reply) => {
  const { filename, content, scope = 'jack', projectId } = req.body as {
    filename: string
    content: string
    scope?: 'jack' | 'project' | 'global'
    projectId?: string
  }

  if (!content?.trim()) return reply.status(400).send({ error: 'content required' })
  if (content.length > 100_000) return reply.status(400).send({ error: 'file too large (max 100KB)' })

  const { callClaude } = await import('../ai/claude')

  // แบ่งเป็น chunks ถ้าไฟล์ยาว (max 6000 chars/chunk)
  const CHUNK = 6000
  const chunks: string[] = []
  for (let i = 0; i < content.length; i += CHUNK) {
    chunks.push(content.slice(i, i + CHUNK))
  }

  const allMemories: Array<{
    scope: 'jack' | 'project' | 'global'
    category: 'rule' | 'decision' | 'fact' | 'preference' | 'insight' | 'context'
    content: string
    importance: number
    projectId?: string
  }> = []

  for (const chunk of chunks) {
    const prompt = `Extract important memories from this markdown document for Jack's personal AI brain (NEO).

Filename: ${filename}
Content:
${chunk}

Extract 3-10 specific, actionable memories. Return ONLY a JSON array:
[{"scope":"jack"|"project"|"global","category":"fact"|"decision"|"rule"|"preference"|"insight"|"context","content":"specific memory in Thai or English (max 150 chars)","importance":1-10,"projectId":"known project_id from context or null"}]

Rules:
- importance 8-10: critical rules, key decisions, strong preferences
- importance 5-7: useful facts, project context, technical details
- Skip generic/obvious content
- Be specific and actionable
- Preserve exact names, versions, URLs, numbers
- projectId: set if content relates to a specific project, else null`

    try {
      const result = await callClaude(prompt,
        'You extract structured memories from documents. Return only valid JSON arrays.',
        'claude-haiku-4-5-20251001'
      )
      const match = result.content.match(/\[[\s\S]*?\]/)
      if (match) {
        const parsed = JSON.parse(match[0])
        allMemories.push(...parsed.filter((m: any) => m.content && m.importance >= 4))
      }
    } catch { /* skip failed chunk */ }
  }

  // Normalize projectId เป็น lowercase เสมอ (FK ใน DB เป็น lowercase)
  const normalizedProjectId = projectId?.toLowerCase() ?? undefined

  // Auto-create project ถ้ายังไม่มีใน DB
  if (normalizedProjectId) {
    await db.query(
      `INSERT INTO neo_projects (project_id, name, status, description)
       VALUES ($1, $2, 'active', $3)
       ON CONFLICT (project_id) DO NOTHING`,
      [normalizedProjectId, projectId, `Imported from ${filename}`]
    ).catch(console.error)
  }

  // Auto-cleanup: ลบ ai-extracted memories ที่ hallucinate project นี้ (project_id IS NULL)
  if (normalizedProjectId) {
    const kwResult = await db.query(
      `SELECT name FROM neo_projects WHERE project_id = $1`,
      [normalizedProjectId]
    ).catch(() => ({ rows: [] as any[] }))
    const cleanupKeywords = [normalizedProjectId, kwResult.rows[0]?.name?.toLowerCase()].filter(Boolean)
    for (const kw of cleanupKeywords) {
      const deleted = await db.query(
        `DELETE FROM neo_memories
         WHERE source = 'ai-extracted' AND project_id IS NULL AND content ILIKE $1
         RETURNING id`,
        [`%${kw}%`]
      ).catch(() => ({ rowCount: 0 }))
      if ((deleted as any).rowCount > 0)
        console.log(`[import] cleanup: deleted ${(deleted as any).rowCount} conflicting ai-extracted memories for "${kw}"`)
    }
  }

  // Save memories — นับเฉพาะที่สำเร็จจริง
  let saved = 0
  for (const mem of allMemories) {
    const effectiveProjectId = normalizedProjectId ?? mem.projectId?.toLowerCase() ?? undefined
    try {
      await saveMemory({
        scope: effectiveProjectId ? 'project' : (mem.scope ?? scope),
        category: mem.category,
        content: mem.content,
        importance: mem.importance,
        projectId: effectiveProjectId,
        source: `import:${filename}`,
      })
      saved++
    } catch (err) {
      console.error('saveMemory failed:', err)
    }
  }

  invalidateProjectCache()  // ให้ buildContext รู้จัก project ใหม่ทันที
  return { saved, total: allMemories.length, filename, chunks: chunks.length }
})

// ─── Import Preview — extract แต่ไม่ save ───
app.post('/api/import-md/preview', async (req, reply) => {
  const { filename, content, scope = 'jack', projectId } = req.body as {
    filename: string
    content: string
    scope?: 'jack' | 'project' | 'global'
    projectId?: string
  }

  if (!content?.trim()) return reply.status(400).send({ error: 'content required' })
  if (content.length > 100_000) return reply.status(400).send({ error: 'file too large (max 100KB)' })

  const { callClaude } = await import('../ai/claude')
  const CHUNK = 6000
  const chunks: string[] = []
  for (let i = 0; i < content.length; i += CHUNK) chunks.push(content.slice(i, i + CHUNK))

  const allMemories: Array<{
    scope: 'jack' | 'project' | 'global'
    category: 'rule' | 'decision' | 'fact' | 'preference' | 'insight' | 'context'
    content: string
    importance: number
    projectId?: string
  }> = []

  for (const chunk of chunks) {
    const prompt = `Extract important memories from this markdown document for Jack's personal AI brain (NEO).

Filename: ${filename}
Content:
${chunk}

Extract 3-10 specific, actionable memories. Return ONLY a JSON array:
[{"scope":"jack"|"project"|"global","category":"fact"|"decision"|"rule"|"preference"|"insight"|"context","content":"specific memory in Thai or English (max 150 chars)","importance":1-10,"projectId":"known project_id from context or null"}]

Rules:
- importance 8-10: critical rules, key decisions, strong preferences
- importance 5-7: useful facts, project context, technical details
- Skip generic/obvious content
- Be specific and actionable`

    try {
      const result = await callClaude(prompt,
        'You extract structured memories from documents. Return only valid JSON arrays.',
        'claude-haiku-4-5-20251001'
      )
      const match = result.content.match(/\[[\s\S]*?\]/)
      if (match) {
        const parsed = JSON.parse(match[0])
        allMemories.push(...parsed.filter((m: any) => m.content && m.importance >= 4))
      }
    } catch { /* skip failed chunk */ }
  }

  return { memories: allMemories, total: allMemories.length, chunks: chunks.length, filename }
})

// ─── Memory Export ───
app.get('/api/memories/export', async (req, reply) => {
  const { format = 'json' } = req.query as { format?: string }
  const result = await db.query(
    `SELECT id, scope, category, project_id, content, importance, source, created_at
     FROM neo_memories ORDER BY importance DESC, created_at DESC`
  )

  if (format === 'csv') {
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const header = 'id,scope,category,project_id,content,importance,source,created_at\n'
    const rows = result.rows.map((r: any) =>
      [r.id, r.scope, r.category, r.project_id ?? '', r.content, r.importance, r.source, r.created_at].map(esc).join(',')
    ).join('\n')
    reply.header('Content-Type', 'text/csv; charset=utf-8')
    reply.header('Content-Disposition', `attachment; filename="neo-memories-${Date.now()}.csv"`)
    return reply.send(header + rows)
  }

  reply.header('Content-Type', 'application/json; charset=utf-8')
  reply.header('Content-Disposition', `attachment; filename="neo-memories-${Date.now()}.json"`)
  return reply.send(JSON.stringify(result.rows, null, 2))
})

// ─── Memory Management — list ───
app.get('/api/memories-manage', async (req) => {
  const { search = '', scope = '', projectId = '', limit = 30, offset = 0 } = req.query as any

  let where = 'WHERE 1=1'
  const params: any[] = []
  let p = 1

  if (search) { where += ` AND content ILIKE $${p++}`; params.push(`%${search}%`) }
  if (scope)  { where += ` AND scope = $${p++}`; params.push(scope) }
  if (projectId === '__null__') { where += ` AND project_id IS NULL` }
  else if (projectId) { where += ` AND project_id = $${p++}`; params.push(projectId) }

  const [rows, countRow] = await Promise.all([
    db.query(
      `SELECT id, scope, category, project_id, content, importance, source, created_at
       FROM neo_memories ${where}
       ORDER BY importance DESC, created_at DESC
       LIMIT $${p++} OFFSET $${p++}`,
      [...params, Number(limit), Number(offset)]
    ),
    db.query(`SELECT COUNT(*) as total FROM neo_memories ${where}`, params),
  ])

  return {
    memories: rows.rows,
    total: parseInt(countRow.rows[0].total),
    limit: Number(limit),
    offset: Number(offset),
  }
})

// ─── Memory Management — update ───
app.put('/api/memories/:id', async (req, reply) => {
  const { id } = req.params as { id: string }
  const { content, importance } = req.body as { content?: string; importance?: number }

  if (!content?.trim()) return reply.status(400).send({ error: 'content required' })

  const result = await db.query(
    `UPDATE neo_memories SET content = $1, importance = COALESCE($2, importance), updated_at = NOW()
     WHERE id = $3 RETURNING id`,
    [content.trim(), importance ?? null, id]
  ).catch(() => ({ rows: [] as any[] }))

  if (!(result as any).rows?.length) return reply.status(404).send({ error: 'not found' })
  return { ok: true, id }
})

// ─── Memory Management — delete single ───
app.delete('/api/memories/:id', async (req, reply) => {
  const { id } = req.params as { id: string }
  const result = await db.query(
    `DELETE FROM neo_memories WHERE id = $1 RETURNING id`,
    [id]
  ).catch(() => ({ rowCount: 0 }))
  if (!(result as any).rowCount) return reply.status(404).send({ error: 'not found' })
  return { ok: true, id }
})

// ─── List Imported Files ───
app.get('/api/import-md', async () => {
  const result = await db.query(`
    SELECT
      source,
      project_id,
      COUNT(*)::int        AS memory_count,
      MAX(created_at)      AS imported_at
    FROM neo_memories
    WHERE source LIKE 'import:%'
    GROUP BY source, project_id
    ORDER BY MAX(created_at) DESC
  `)
  return result.rows.map((r: any) => ({
    filename:    r.source.replace(/^import:/, ''),
    source:      r.source,
    projectId:   r.project_id,
    memoryCount: r.memory_count,
    importedAt:  r.imported_at,
  }))
})

// ─── Delete Imported Memories ───
app.delete('/api/import-md', async (req, reply) => {
  const { filename } = req.body as { filename: string }
  if (!filename?.trim()) return reply.status(400).send({ error: 'filename required' })

  const source = `import:${filename}`
  const result = await db.query(
    `DELETE FROM neo_memories WHERE source = $1 RETURNING id`,
    [source]
  )

  return { deleted: result.rowCount, filename }
})

// ─── System Health API ───
app.get('/api/health', async () => {
  const { collectHealth } = await import('./health')
  return collectHealth()
})

app.post('/api/health/action', async (req, reply) => {
  const { action, target } = req.body as { action: string; target?: string }
  const http = await import('http')

  function dockerCall(method: string, path: string, body?: object): Promise<{ status: number; data: any }> {
    return new Promise((resolve) => {
      const bodyStr = body ? JSON.stringify(body) : ''
      const opts: any = {
        socketPath: '/var/run/docker.sock',
        path, method,
        headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } : {},
      }
      const req2 = http.default.request(opts, (res) => {
        let data = ''
        res.on('data', c => data += c)
        res.on('end', () => { try { resolve({ status: res.statusCode ?? 0, data: JSON.parse(data) }) } catch { resolve({ status: res.statusCode ?? 0, data }) } })
      })
      req2.on('error', (e) => resolve({ status: 500, data: e.message }))
      if (bodyStr) req2.write(bodyStr)
      req2.end()
    })
  }

  try {
    switch (action) {
      case 'start-container': {
        if (!target) return reply.status(400).send({ error: 'target required' })
        const r = await dockerCall('POST', `/containers/${target}/start`)
        return { ok: r.status === 204 || r.status === 304, action, target, status: r.status }
      }
      case 'restart-container': {
        if (!target) return reply.status(400).send({ error: 'target required' })
        const r = await dockerCall('POST', `/containers/${target}/restart?t=10`)
        return { ok: r.status === 204, action, target, status: r.status }
      }
      case 'remove-container': {
        if (!target) return reply.status(400).send({ error: 'target required' })
        // หยุดก่อน (ถ้ายังรัน) แล้วค่อยลบ
        await dockerCall('POST', `/containers/${target}/stop?t=5`)
        const r = await dockerCall('DELETE', `/containers/${target}`)
        return { ok: r.status === 204, action, target, status: r.status }
      }
      case 'cleanup-docker': {
        // ลบ stopped containers + dangling images (ไม่แตะ running)
        const [containers, images] = await Promise.all([
          dockerCall('POST', '/containers/prune'),
          dockerCall('POST', '/images/prune'),
        ])
        return {
          ok: true, action,
          deletedContainers: (containers.data as any)?.ContainersDeleted?.length ?? 0,
          reclaimedBytes: (containers.data as any)?.SpaceReclaimed ?? 0,
          deletedImages: (images.data as any)?.ImagesDeleted?.length ?? 0,
        }
      }
      default:
        return reply.status(400).send({ error: `unknown action: ${action}` })
    }
  } catch (err: any) {
    return reply.status(500).send({ error: err.message })
  }
})

app.post('/api/health/analyze', async (req) => {
  const { issues, containers, system } = req.body as any
  if (!issues?.length) return { fixes: [] }

  const { callDeepSeek } = await import('../ai/deepseek')
  const issueText = issues.map((i: any, n: number) => `${n + 1}. [${i.severity.toUpperCase()}] ${i.component}: ${i.message}`).join('\n')
  const crashedContainers = (containers ?? []).filter((c: any) => c.state !== 'running').map((c: any) => `- ${c.name}: ${c.status}`).join('\n')

  const prompt = `NEO Personal AI Server มีปัญหาดังนี้:

${issueText}
${crashedContainers ? `\nContainers ที่หยุดทำงาน:\n${crashedContainers}` : ''}

System: CPU ${system?.cpu?.usagePct}%, RAM ${system?.ram?.usedPct}%, Disk ${system?.disk?.usedPct}%

วิเคราะห์แต่ละปัญหาและให้วิธีแก้เป็นข้อๆ ชัดเจน พร้อม command ที่ใช้ได้จริงบน Linux/Docker
ตอบภาษาไทย แต่ command เป็นภาษาอังกฤษ`

  const { content } = await callDeepSeek(prompt,
    'คุณเป็นผู้เชี่ยวชาญ DevOps และ Linux สำหรับ personal server ให้คำแนะนำที่ชัดเจนและปฏิบัติได้จริง'
  )
  return { fixes: content }
})

// ─── Cron Jobs CRUD API ───

app.get('/api/cron/jobs', async () => {
  const r = await db.query(
    'SELECT * FROM neo_cron_jobs ORDER BY created_at ASC'
  ).catch(() => ({ rows: [] as any[] }))
  return r.rows
})

app.post('/api/cron/jobs/parse', async (req, reply) => {
  const { input } = req.body as { input: string }
  if (!input?.trim()) return reply.status(400).send({ error: 'input required' })
  try {
    const { parseJobFromNL } = await import('../core/cron-manager')
    const config = await parseJobFromNL(input.trim())
    return config
  } catch (err: any) {
    return reply.status(500).send({ error: err.message })
  }
})

app.post('/api/cron/jobs', async (req, reply) => {
  const body = req.body as {
    name: string; description?: string; schedule: string
    action_type: string; action_config?: object; ai_model?: string; enabled?: boolean
  }
  if (!body.name || !body.schedule || !body.action_type)
    return reply.status(400).send({ error: 'name, schedule, action_type required' })

  const r = await db.query(
    `INSERT INTO neo_cron_jobs (name, description, schedule, action_type, action_config, ai_model, enabled)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [body.name, body.description ?? null, body.schedule, body.action_type,
     JSON.stringify(body.action_config ?? {}), body.ai_model ?? 'gemini', body.enabled ?? true]
  )
  const job = r.rows[0]
  const { reloadJob } = await import('../core/cron-manager')
  await reloadJob(job.id)
  return job
})

app.put('/api/cron/jobs/:id', async (req, reply) => {
  const { id } = req.params as { id: string }
  const body = req.body as {
    name?: string; description?: string; schedule?: string
    action_type?: string; action_config?: object; ai_model?: string; enabled?: boolean
  }
  const r = await db.query(
    `UPDATE neo_cron_jobs
     SET name = COALESCE($1, name),
         description = COALESCE($2, description),
         schedule = COALESCE($3, schedule),
         action_type = COALESCE($4, action_type),
         action_config = COALESCE($5, action_config),
         ai_model = COALESCE($6, ai_model),
         enabled = COALESCE($7, enabled),
         updated_at = NOW()
     WHERE id = $8 RETURNING *`,
    [body.name ?? null, body.description ?? null, body.schedule ?? null,
     body.action_type ?? null, body.action_config ? JSON.stringify(body.action_config) : null,
     body.ai_model ?? null, body.enabled ?? null, id]
  ).catch(() => ({ rows: [] as any[] }))
  if (!r.rows.length) return reply.status(404).send({ error: 'job not found' })
  const { reloadJob } = await import('../core/cron-manager')
  await reloadJob(id)
  return r.rows[0]
})

app.delete('/api/cron/jobs/:id', async (req, reply) => {
  const { id } = req.params as { id: string }
  const { reloadJob } = await import('../core/cron-manager')
  // Cancel schedule first
  await db.query('UPDATE neo_cron_jobs SET enabled = false WHERE id = $1', [id]).catch(() => {})
  await reloadJob(id)
  const r = await db.query('DELETE FROM neo_cron_jobs WHERE id = $1 RETURNING id', [id])
    .catch(() => ({ rowCount: 0 }))
  if (!(r as any).rowCount) return reply.status(404).send({ error: 'job not found' })
  return { ok: true, id }
})

app.post('/api/cron/jobs/:id/run', async (req, reply) => {
  const { id } = req.params as { id: string }
  const check = await db.query('SELECT id FROM neo_cron_jobs WHERE id = $1', [id])
    .catch(() => ({ rows: [] as any[] }))
  if (!check.rows.length) return reply.status(404).send({ error: 'job not found' })
  const { runJobNow } = await import('../core/cron-manager')
  runJobNow(id).catch(console.error)
  return { ok: true, id, triggered: new Date() }
})

// ─── Cron Logs API ───
app.get('/api/cron/logs', async (req) => {
  const { jobId, limit = 50 } = req.query as { jobId?: string; limit?: number }
  const [logs, summary] = await Promise.all([
    db.query(
      `SELECT id, job_name, status, message, details, ran_at, job_id
       FROM neo_cron_logs
       ${jobId ? 'WHERE job_id = $2' : ''}
       ORDER BY ran_at DESC LIMIT $1`,
      jobId ? [Number(limit), jobId] : [Number(limit)]
    ).catch(() => ({ rows: [] as any[] })),
    db.query(`
      SELECT DISTINCT ON (job_name) job_name, status, message, details, ran_at, job_id
      FROM neo_cron_logs
      ORDER BY job_name, ran_at DESC
    `).catch(() => ({ rows: [] as any[] })),
  ])
  return { logs: logs.rows, lastRuns: summary.rows }
})

// Legacy endpoint — find job by name in DB and run
app.post('/api/cron/run/:job', async (req, reply) => {
  const { job } = req.params as { job: string }
  const nameMap: Record<string, string> = {
    'daily-cost-report':    'Daily Cost Report',
    'weekly-memory-cleanup': 'Weekly Memory Cleanup',
    'monthly-spend-alert':  'Monthly Spend Alert',
  }
  const dbName = nameMap[job]
  if (!dbName) return reply.status(404).send({ error: 'unknown job' })
  const r = await db.query('SELECT id FROM neo_cron_jobs WHERE name = $1 LIMIT 1', [dbName])
    .catch(() => ({ rows: [] as any[] }))
  if (!r.rows.length) return reply.status(404).send({ error: 'job not in DB — run migration 004' })
  const { runJobNow } = await import('../core/cron-manager')
  runJobNow(r.rows[0].id).catch(console.error)
  return { ok: true, job, triggered: new Date() }
})

// ─── Deploy Request — notify Telegram + log ───
app.post('/api/deploy', async (req, reply) => {
  const { note = '' } = req.body as { note?: string }

  const lastDeploy = await db.query(
    `SELECT created_at, note FROM neo_deploy_log ORDER BY created_at DESC LIMIT 1`
  ).catch(() => ({ rows: [] as any[] }))

  const now = new Date()
  await db.query(
    `INSERT INTO neo_deploy_log (note, requested_at) VALUES ($1, NOW())
     ON CONFLICT DO NOTHING`,
    [note || 'manual']
  ).catch(async () => {
    // Table may not exist yet — create it
    await db.query(`
      CREATE TABLE IF NOT EXISTS neo_deploy_log (
        id SERIAL PRIMARY KEY,
        note TEXT,
        requested_at TIMESTAMPTZ DEFAULT NOW()
      )
    `).catch(console.error)
    await db.query(`INSERT INTO neo_deploy_log (note) VALUES ($1)`, [note || 'manual']).catch(console.error)
  })

  const domain = process.env.NEO_DOMAIN ?? 'localhost'
  const cmd = `cd ~/neo && git pull origin master && docker compose build --no-cache neo && docker compose up -d neo`
  const msg = `🚀 NEO Deploy Request\n${note ? `Note: ${note}\n` : ''}\nเวลา: ${now.toLocaleString('th-TH')}\n\nรัน command:\n\`\`\`\n${cmd}\n\`\`\``

  const { tgNotify } = await import('../core/cron')
  tgNotify(msg).catch(console.error)

  neoEvents.emit('neo', { type: 'deploy_requested', channel: 'system', data: { note, timestamp: now.toISOString() }, timestamp: Date.now() })

  return {
    ok: true,
    requestedAt: now.toISOString(),
    lastDeploy: lastDeploy.rows[0]?.created_at ?? null,
    cmd,
    message: 'Deploy request sent to Telegram — SSH in and run the command to apply',
  }
})

// ─── SSE — Real-time push to Web UI ───
app.get('/api/events', async (req, reply) => {
  reply.hijack()
  const res = reply.raw
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders()

  const send = (event: NeoEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  }

  neoEvents.on('neo', send)
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 25000)

  req.raw.on('close', () => {
    neoEvents.off('neo', send)
    clearInterval(keepAlive)
  })
})

export function startWebServer(port = 3000) {
  app.listen({ port, host: '0.0.0.0' }, (err) => {
    if (err) { console.error(err); process.exit(1) }
    console.log(`🌐 NEO Web UI: http://localhost:${port}`)
  })
}
