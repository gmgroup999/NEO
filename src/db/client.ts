import { Pool } from 'pg'

export const db = new Pool({ connectionString: process.env.DATABASE_URL })

export async function initMessageTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS neo_messages (
      id          UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
      session_id  TEXT          NOT NULL,
      source      TEXT          NOT NULL DEFAULT 'web',
      role        TEXT          NOT NULL,
      content     TEXT          NOT NULL,
      model       TEXT,
      cost_usd    NUMERIC(10,6) DEFAULT 0,
      created_at  TIMESTAMPTZ   DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS neo_messages_created ON neo_messages (created_at DESC);
    CREATE INDEX IF NOT EXISTS neo_messages_session ON neo_messages (session_id);
    CREATE INDEX IF NOT EXISTS neo_messages_source  ON neo_messages (source);
  `)
}

export async function saveMessage(msg: {
  sessionId: string
  source: 'web' | 'telegram'
  role: 'user' | 'assistant'
  content: string
  model?: string
  costUsd?: number
}) {
  await db.query(
    `INSERT INTO neo_messages (session_id, source, role, content, model, cost_usd)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [msg.sessionId, msg.source, msg.role, msg.content, msg.model ?? null, msg.costUsd ?? 0]
  ).catch(console.error)
}

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
