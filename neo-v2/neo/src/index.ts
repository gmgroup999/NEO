// src/index.ts — NEO Entry Point
import 'dotenv/config'
import Fastify from 'fastify'
import { readFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { startTelegramBot } from './bot/telegram'
import { db } from './db/client'
import { routeAndCall, parseMention } from './core/router'
import { buildContext, extractMemoriesFromConversation } from './core/memory'

const fastify = Fastify({ logger: false })

// ── CORS ──────────────────────────────────
fastify.addHook('onRequest', async (_req, reply) => {
  reply.header('Access-Control-Allow-Origin', '*')
  reply.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  reply.header('Access-Control-Allow-Headers', 'Content-Type')
})
fastify.options('*', async (_req, reply) => { reply.code(204).send() })

// ── Static: Web UI ────────────────────────
fastify.get('/', async (_req, reply) => {
  const html = readFileSync(join(__dirname, '../public/index.html'), 'utf-8')
  reply.type('text/html').send(html)
})

// ── Health ────────────────────────────────
fastify.get('/api/health', async () => ({ ok: true, ts: new Date().toISOString() }))

// ── Chat API ──────────────────────────────
fastify.post<{
  Body: { message: string; sessionId?: string }
}>('/api/chat', async (req, reply) => {
  const { message, sessionId = randomUUID() } = req.body ?? {}
  if (!message?.trim()) return reply.code(400).send({ error: 'message required' })

  // Parse @mention (force model)
  const { model: forcedModel, cleanMessage } = parseMention(message)

  // Build context from memory (ถ้า DB พร้อม)
  let systemPrompt = `คุณคือ NEO — AI Brain ส่วนตัวของ Jack\nตอบภาษาไทย สั้น ตรง มี code พร้อม copy\n`
  try {
    systemPrompt = await buildContext(cleanMessage)
  } catch (e) {
    console.warn('buildContext failed (using default):', (e as Error).message)
  }

  // Route & Call AI
  const result = await routeAndCall({
    message: cleanMessage,
    systemPrompt,
    sessionId,
    forcedModel: forcedModel ?? undefined,
  })

  // Extract memories in background (ไม่ block response)
  extractMemoriesFromConversation(message, result.content, sessionId).catch(() => {})

  return {
    content: result.content,
    model: result.model,
    routedBy: result.routedBy,
    costUsd: result.costUsd,
    latencyMs: result.latencyMs,
    sessionId,
  }
})

// ── Memory count for UI sidebar ───────────
fastify.get('/api/stats', async () => {
  try {
    const [memRes, costRes] = await Promise.all([
      db.query('SELECT COUNT(*) FROM neo_memories'),
      db.query(
        `SELECT COALESCE(SUM(total_cost_usd),0) AS today_cost
         FROM neo_costs_daily WHERE date = CURRENT_DATE`
      ),
    ])
    return {
      memoryCount: parseInt(memRes.rows[0].count),
      todayCostUsd: parseFloat(costRes.rows[0].today_cost),
    }
  } catch {
    return { memoryCount: 0, todayCostUsd: 0 }
  }
})

// ── Main ──────────────────────────────────
async function main() {
  console.log('🧠 NEO starting...')

  try {
    await db.query('SELECT 1')
    console.log('✅ Database connected')
  } catch (e) {
    console.error('❌ Database connection failed:', e)
    process.exit(1)
  }

  startTelegramBot()

  const port = parseInt(process.env.PORT ?? '3000')
  await fastify.listen({ port, host: '0.0.0.0' })
  console.log(`🌐 Web UI: http://0.0.0.0:${port}`)
  console.log('🚀 NEO is running on z-node.cc')
}

main().catch(console.error)
