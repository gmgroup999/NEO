import Fastify from 'fastify'
import staticPlugin from '@fastify/static'
import { join } from 'path'
import { routeAndCall, parseMention, RouteRequest } from '../core/router'
import type { ConversationTurn } from '../ai/claude'
import { buildContext, extractMemoriesFromConversation, recallMemories, saveMemory, invalidateProjectCache } from '../core/memory'
import { generateImage, isImageRequest, extractImagePrompt } from '../ai/image'
import { logAICall, db, saveMessage } from '../db/client'
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
  const { message, sessionId = randomUUID(), history = [], imageBase64, imageMime } = req.body as {
    message: string
    sessionId?: string
    history?: ConversationTurn[]
    imageBase64?: string
    imageMime?: string
  }

  if (isImageRequest(message)) {
    const prompt = extractImagePrompt(message)

    try {
      const result = await generateImage(prompt)

      logAICall({
        sessionId,
        model: 'gpt-image-1',
        provider: 'openai',
        taskType: 'image',
        routedBy: 'auto',
        promptTokens: 0,
        completionTokens: 0,
        costUsd: result.costUsd,
        latencyMs: 0,
      }).catch(console.error)

      return {
        type: 'image',
        imageUrl: result.url,
        revisedPrompt: result.revisedPrompt,
        model: 'gpt-image-1',
        costUsd: result.costUsd,
        sessionId,
      }
    } catch (err: any) {
      console.error('Image error:', err)
      const isModeration = err?.error?.code === 'moderation_blocked'
      const msg = isModeration
        ? 'OpenAI ปฏิเสธ prompt นี้ (content policy) — ลองเปลี่ยน prompt หรือใช้ภาษาอังกฤษครับ'
        : 'Image generation failed'
      return reply.status(500).send({ error: msg })
    }
  }

  const { model: forcedModel, cleanMessage } = parseMention(message)
  const systemPrompt = await buildContext(cleanMessage || message, history.slice(-6))

  const response = await routeAndCall({
    message: cleanMessage || message,
    systemPrompt,
    sessionId,
    forcedModel: forcedModel ?? undefined,
    history: history.slice(-20),
    imageBase64,
    imageMime,
  })

  saveMessage({ sessionId, source: 'web', role: 'user', content: message })
  saveMessage({ sessionId, source: 'web', role: 'assistant', content: response.content, model: response.model, costUsd: response.costUsd })

  extractMemoriesFromConversation(message, response.content, sessionId)
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

// ─── TTS Proxy — ดึง Google TTS server-side เพื่อหลีก CORS ───
app.get('/api/tts', async (req, reply) => {
  const { text, lang = 'th' } = req.query as { text: string; lang?: string }
  if (!text) return reply.status(400).send({ error: 'text required' })

  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.slice(0, 200))}&tl=${lang}&client=tw-ob`

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://translate.google.com/',
    },
  })

  if (!res.ok) return reply.status(502).send({ error: 'TTS fetch failed' })

  reply.header('Content-Type', 'audio/mpeg')
  reply.header('Cache-Control', 'public, max-age=3600')
  return reply.send(Buffer.from(await res.arrayBuffer()))
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
[{"scope":"jack"|"project"|"global","category":"fact"|"decision"|"rule"|"preference"|"insight"|"context","content":"specific memory in Thai or English (max 150 chars)","importance":1-10,"projectId":"joyride"|"boonma"|"sabaidee"|"pawfect"|"neo"|null}]

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
[{"scope":"jack"|"project"|"global","category":"fact"|"decision"|"rule"|"preference"|"insight"|"context","content":"specific memory in Thai or English (max 150 chars)","importance":1-10,"projectId":"joyride"|"boonma"|"sabaidee"|"pawfect"|"neo"|null}]

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

// ─── Cron Logs API ───
app.get('/api/cron/logs', async () => {
  const [logs, summary] = await Promise.all([
    db.query(`
      SELECT id, job_name, status, message, details, ran_at
      FROM neo_cron_logs
      ORDER BY ran_at DESC LIMIT 50
    `).catch(() => ({ rows: [] as any[] })),
    db.query(`
      SELECT job_name, status, message, details, ran_at
      FROM neo_cron_logs l1
      WHERE ran_at = (
        SELECT MAX(ran_at) FROM neo_cron_logs l2 WHERE l2.job_name = l1.job_name
      )
      ORDER BY job_name
    `).catch(() => ({ rows: [] as any[] })),
  ])
  return { logs: logs.rows, lastRuns: summary.rows }
})

app.post('/api/cron/run/:job', async (req, reply) => {
  const { job } = req.params as { job: string }
  const { runDailyCostReport, runWeeklyMemoryCleanup, runMonthlySpendAlert } = await import('../core/cron')
  const jobs: Record<string, () => Promise<void>> = {
    'daily-cost-report':    runDailyCostReport,
    'weekly-memory-cleanup': runWeeklyMemoryCleanup,
    'monthly-spend-alert':  runMonthlySpendAlert,
  }
  if (!jobs[job]) return reply.status(404).send({ error: 'unknown job' })
  jobs[job]().catch(console.error)
  return { ok: true, job, triggered: new Date() }
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
