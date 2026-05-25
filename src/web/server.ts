import Fastify from 'fastify'
import staticPlugin from '@fastify/static'
import { join } from 'path'
import { routeAndCall, parseMention } from '../core/router'
import { buildContext, extractMemoriesFromConversation, recallMemories } from '../core/memory'
import { generateImage, isImageRequest, extractImagePrompt } from '../ai/image'
import { logAICall, db } from '../db/client'
import { neoEvents, NeoEvent } from './events'
import { randomUUID } from 'crypto'

const app = Fastify({ logger: false })

app.register(staticPlugin, {
  root: join(process.cwd(), 'public'),
  prefix: '/',
})

// ─── Chat API ───
app.post('/api/chat', async (req, reply) => {
  const { message, sessionId = randomUUID() } = req.body as {
    message: string
    sessionId?: string
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
    } catch (err) {
      console.error('DALL-E error:', err)
      return reply.status(500).send({ error: 'Image generation failed' })
    }
  }

  const { model: forcedModel, cleanMessage } = parseMention(message)
  const systemPrompt = await buildContext(cleanMessage || message)

  const response = await routeAndCall({
    message: cleanMessage || message,
    systemPrompt,
    sessionId,
    forcedModel: forcedModel ?? undefined,
  })

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
