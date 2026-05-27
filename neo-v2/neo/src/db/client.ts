// src/db/client.ts
import { Pool } from 'pg'

export const db = new Pool({ connectionString: process.env.DATABASE_URL })

export async function logAICall(data: {
  sessionId: string
  model: string
  provider: string
  taskType: string
  routedBy: string
  promptTokens: number
  completionTokens: number
  costUsd: number
  latencyMs: number
}) {
  await db.query(
    `INSERT INTO neo_ai_calls 
     (session_id, model, provider, task_type, routed_by, prompt_tokens, completion_tokens, cost_usd, latency_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      data.sessionId, data.model, data.provider, data.taskType,
      data.routedBy, data.promptTokens, data.completionTokens,
      data.costUsd, data.latencyMs,
    ]
  )
}
