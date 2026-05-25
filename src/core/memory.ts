import { db } from '../db/client'

export interface Memory {
  id: string
  scope: 'jack' | 'project' | 'global'
  category: 'rule' | 'decision' | 'fact' | 'preference' | 'insight' | 'context'
  projectId?: string
  content: string
  importance: number
  source: string
  createdAt: Date
}

// ─── RECALL — semantic search ───
export async function recallMemories(
  query: string,
  options: {
    limit?: number
    scope?: 'jack' | 'project' | 'global'
    projectId?: string
    minImportance?: number
  } = {}
): Promise<Memory[]> {
  const { limit = 10, scope, projectId, minImportance = 1 } = options

  const embedding = await generateEmbedding(query)

  const result = await db.query(
    `SELECT * FROM search_memories($1, $2, $3, $4, $5)`,
    [
      JSON.stringify(embedding),
      limit,
      scope ?? null,
      projectId ?? null,
      minImportance,
    ]
  )

  if (result.rows.length > 0) {
    const ids = result.rows.map((r: any) => r.id)
    await db.query(
      `UPDATE neo_memories
       SET last_accessed = NOW(), access_count = access_count + 1
       WHERE id = ANY($1)`,
      [ids]
    )
  }

  return result.rows
}

// ─── SAVE — บันทึก memory ใหม่ ───
export async function saveMemory(memory: {
  scope: 'jack' | 'project' | 'global'
  category: 'rule' | 'decision' | 'fact' | 'preference' | 'insight' | 'context'
  projectId?: string
  content: string
  importance?: number
  source?: string
  sessionId?: string
  tags?: string[]
}): Promise<string> {
  const embedding = await generateEmbedding(memory.content)

  const result = await db.query(
    `INSERT INTO neo_memories
     (scope, category, project_id, content, embedding, importance, source, source_session_id, tags)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      memory.scope,
      memory.category,
      memory.projectId ?? null,
      memory.content,
      JSON.stringify(embedding),
      memory.importance ?? 5,
      memory.source ?? 'extracted',
      memory.sessionId ?? null,
      memory.tags ?? [],
    ]
  )

  return result.rows[0].id
}

// ─── EXTRACT — AI-powered memory extraction จาก conversation ───
export async function extractMemoriesFromConversation(
  userMessage: string,
  aiResponse: string,
  sessionId: string
): Promise<void> {
  // Explicit triggers — save immediately with high importance
  const rememberTriggers = ['จำไว้ด้วย', 'จำไว้นะ', 'remember this', 'note:', 'สำคัญ:']
  if (rememberTriggers.some(t => userMessage.toLowerCase().includes(t))) {
    const content = userMessage.replace(/จำไว้ด้วย|จำไว้นะ|remember this|note:|สำคัญ:/gi, '').trim()
    await saveMemory({ scope: 'jack', category: 'fact', content, importance: 9, source: 'manual', sessionId })
      .catch(console.error)
  }

  // Skip AI extraction for very short greetings
  if (userMessage.trim().length < 10) return

  try {
    const { callClaude } = await import('../ai/claude')

    const extractPrompt = `Analyze this conversation between Jack (Thai developer/entrepreneur) and NEO (his AI brain).
Extract 0-3 memories worth remembering about Jack, his projects, decisions, or preferences.

User: ${userMessage.slice(0, 600)}
NEO: ${aiResponse.slice(0, 400)}

Return ONLY a JSON array, no markdown, no explanation:
[{"scope":"jack"|"project"|"global","category":"fact"|"preference"|"decision"|"rule"|"insight","content":"specific memory in Thai or English (max 120 chars)","importance":1-10,"projectId":"joyride"|"boonma"|"sabaidee"|"pawfect"|"neo"|null}]

Rules:
- Only extract specific, actionable facts. Skip vague or obvious things.
- importance 8-10: critical rules, strong preferences, major decisions
- importance 5-7: useful project/tech context
- importance 1-4: minor facts (skip these)
- Return [] if nothing worth remembering (greeting, simple question, etc.)`

    const result = await callClaude(
      extractPrompt,
      'You extract structured memories from conversations. Return only valid JSON arrays, nothing else.',
      'claude-haiku-4-5-20251001'
    )

    const jsonMatch = result.content.match(/\[[\s\S]*?\]/)
    if (!jsonMatch) return

    const memories = JSON.parse(jsonMatch[0]) as Array<{
      scope: 'jack' | 'project' | 'global'
      category: 'rule' | 'decision' | 'fact' | 'preference' | 'insight' | 'context'
      content: string
      importance: number
      projectId?: string
    }>

    for (const mem of memories) {
      if (mem.content && mem.importance >= 5) {
        await saveMemory({ ...mem, source: 'ai-extracted', sessionId }).catch(console.error)
      }
    }
  } catch (err) {
    console.error('AI extraction error:', err)
  }
}

// ─── CONTEXT BUILDER — inject เข้า system prompt ───
export async function buildContext(userMessage: string): Promise<string> {
  const projectMentions = detectProjectMentions(userMessage)

  const [jackMemories, projectMemories, globalRules] = await Promise.all([
    recallMemories(userMessage, { scope: 'jack', limit: 8, minImportance: 5 }),
    projectMentions[0]
      ? recallMemories(userMessage, { scope: 'project', projectId: projectMentions[0], limit: 8 })
      : Promise.resolve([]),
    db.query(
      `SELECT content FROM neo_memories
       WHERE scope = 'global' AND category = 'rule' AND importance >= 8
       ORDER BY importance DESC LIMIT 5`
    ).then((r: any) => r.rows),
  ])

  const projectInfo = projectMentions.length > 0
    ? await db.query(
        `SELECT name, description, stack, golden_rules FROM neo_projects WHERE project_id = ANY($1)`,
        [projectMentions]
      ).then((r: any) => r.rows)
    : []

  let context = `คุณคือ NEO — AI Brain ส่วนตัวของ Jack\n`
  context += `ตอบภาษาไทย สั้น ตรง มี code พร้อม copy\n\n`

  if (globalRules.length > 0) {
    context += `## NEO Rules\n`
    globalRules.forEach((r: any) => { context += `- ${r.content}\n` })
    context += '\n'
  }

  if (jackMemories.length > 0) {
    context += `## Jack's Profile & Preferences\n`
    jackMemories.forEach(m => { context += `- ${m.content}\n` })
    context += '\n'
  }

  if (projectInfo.length > 0) {
    context += `## Project Context\n`
    projectInfo.forEach((p: any) => {
      context += `**${p.name}**: ${p.description}\n`
      context += `Stack: ${JSON.stringify(p.stack)}\n`
      if (p.golden_rules?.length > 0) {
        context += `Rules:\n`
        p.golden_rules.forEach((r: string) => { context += `  - ${r}\n` })
      }
      context += '\n'
    })
  }

  if (projectMemories.length > 0) {
    context += `## Project Memories\n`
    projectMemories.forEach(m => { context += `- [${m.category}] ${m.content}\n` })
    context += '\n'
  }

  return context
}

// ─── HELPERS ───
function detectProjectMentions(text: string): string[] {
  const projectKeywords: Record<string, string> = {
    'joyride': 'joyride',
    'joy ride': 'joyride',
    'boonma': 'boonma',
    'บุญมา': 'boonma',
    'sabaidee': 'sabaidee',
    'สบายดี': 'sabaidee',
    'phimai': 'sabaidee',
    'พิมาย': 'sabaidee',
    'pawfect': 'pawfect',
    'neo': 'neo',
  }

  const found: string[] = []
  const lowerText = text.toLowerCase()

  for (const [keyword, projectId] of Object.entries(projectKeywords)) {
    if (lowerText.includes(keyword) && !found.includes(projectId)) {
      found.push(projectId)
    }
  }

  return found
}

async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const OpenAI = (await import('openai')).default
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const res = await client.embeddings.create({
      model: 'text-embedding-3-small',
      input: text.slice(0, 8000),
    })
    return res.data[0].embedding
  } catch (err) {
    console.warn('Embedding failed, using zero vector:', (err as Error).message)
    return new Array(1536).fill(0)
  }
}
