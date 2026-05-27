// src/ai/image.ts
// DALL-E 3 Image Generation

import OpenAI from 'openai'
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export interface ImageResult {
  url: string
  revisedPrompt: string
  costUsd: number
}

// Detect image request จาก message
export function isImageRequest(message: string): boolean {
  const triggers = [
    'สร้างภาพ', 'วาดภาพ', 'สร้างรูป', 'ทำภาพ',
    'generate image', 'create image', 'draw',
    '@dalle', '@dall-e', 'dall-e',
    'ภาพของ', 'รูปของ',
  ]
  return triggers.some(t => message.toLowerCase().includes(t))
}

// Extract prompt จาก message
export function extractImagePrompt(message: string): string {
  const removals = [
    'สร้างภาพ', 'วาดภาพ', 'สร้างรูป', 'ทำภาพ',
    'generate image', 'create image', 'draw me', 'draw',
    '@dalle', '@dall-e', 'dall-e',
    'ภาพของ', 'รูปของ',
  ]
  let prompt = message
  removals.forEach(r => { prompt = prompt.replace(new RegExp(r, 'gi'), '') })
  return prompt.trim()
}

// Generate image with DALL-E 3
export async function generateImage(prompt: string): Promise<ImageResult> {
  const response = await openai.images.generate({
    model: 'dall-e-3',
    prompt,
    n: 1,
    size: '1024x1024',
    quality: 'standard',
    response_format: 'url',
  })

  return {
    url: response.data[0].url!,
    revisedPrompt: response.data[0].revised_prompt ?? prompt,
    costUsd: 0.04, // DALL-E 3 standard 1024x1024
  }
}


// ─────────────────────────────────────────
// src/web/server.ts
// Web UI Server — neo.z-node.cc
// ─────────────────────────────────────────

import Fastify from 'fastify'
import { join } from 'path'
import { routeAndCall, parseMention, formatCostDisplay } from '../core/router'
import { buildContext, extractMemoriesFromConversation } from '../core/memory'
import { generateImage, isImageRequest, extractImagePrompt } from '../ai/image'
import { logAICall } from '../db/client'
import { randomUUID } from 'crypto'

const app = Fastify({ logger: false })

// Serve static Web UI
app.get('/', async (req, reply) => {
  return reply.sendFile('index.html')
})

// ─── Chat API ───
app.post('/api/chat', async (req, reply) => {
  const { message, sessionId = randomUUID() } = req.body as {
    message: string
    sessionId?: string
  }

  // Detect image request
  if (isImageRequest(message)) {
    const prompt = extractImagePrompt(message)

    try {
      const result = await generateImage(prompt)

      // Log cost
      await logAICall({
        sessionId,
        model: 'dall-e-3',
        provider: 'openai',
        taskType: 'image',
        routedBy: 'auto',
        promptTokens: 0,
        completionTokens: 0,
        costUsd: result.costUsd,
        latencyMs: 0,
      })

      return {
        type: 'image',
        imageUrl: result.url,
        revisedPrompt: result.revisedPrompt,
        model: 'dall-e-3',
        costUsd: result.costUsd,
        sessionId,
      }
    } catch (e) {
      return reply.status(500).send({ error: 'Image generation failed' })
    }
  }

  // Normal chat
  const { model: forcedModel, cleanMessage } = parseMention(message)
  const systemPrompt = await buildContext(cleanMessage || message)

  const response = await routeAndCall({
    message: cleanMessage || message,
    systemPrompt,
    sessionId,
    forcedModel: forcedModel ?? undefined,
  })

  // Extract memories background
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
  const { recallMemories } = await import('../core/memory')
  return recallMemories(query, { limit: Number(limit) })
})

// ─── Status API ───
app.get('/api/status', async () => {
  const { db } = await import('../db/client')

  const [costs, memCount, projectCount] = await Promise.all([
    db.query(`
      SELECT model, call_count, total_cost_usd
      FROM neo_costs_daily WHERE date = CURRENT_DATE
      ORDER BY total_cost_usd DESC
    `),
    db.query('SELECT COUNT(*) as count FROM neo_memories'),
    db.query('SELECT COUNT(*) as count FROM neo_projects WHERE status = \'active\''),
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

export function startWebServer(port = 3000) {
  app.listen({ port, host: '0.0.0.0' }, (err) => {
    if (err) { console.error(err); process.exit(1) }
    console.log(`🌐 NEO Web UI: http://neo.z-node.cc (port ${port})`)
  })
}
