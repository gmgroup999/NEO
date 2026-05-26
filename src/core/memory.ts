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
  const rememberTriggers = ['จำไว้ด้วย', 'จำไว้นะ', 'จำไว้', 'จำด้วย', 'จำเอาไว้', 'remember this', 'save to memory', 'note:', 'สำคัญ:', 'บันทึกไว้']
  const triggerPattern = /จำไว้ด้วย|จำไว้นะ|จำไว้(ใน memory)?|จำด้วย|จำเอาไว้|remember this|save to memory|note:|สำคัญ:|บันทึกไว้/gi
  if (rememberTriggers.some(t => userMessage.toLowerCase().includes(t.toLowerCase()))) {
    let content = userMessage.replace(triggerPattern, '').trim()
    // ถ้า content ว่าง → ใช้ AI response ก่อนหน้าเป็นสิ่งที่ต้องจำ
    if (content.length < 5) content = aiResponse.slice(0, 400).trim()
    if (content.length >= 5) {
      await saveMemory({ scope: 'jack', category: 'fact', content, importance: 9, source: 'manual', sessionId })
        .catch(console.error)
    }
  }

  // Skip AI extraction for very short greetings
  if (userMessage.trim().length < 10) return

  try {
    const { callClaude } = await import('../ai/claude')

    // ดึง project IDs จาก DB เพื่อ inject เข้า prompt แบบ dynamic
    const knownProjects = await getProjectKeywords()
    const knownIds = new Set(knownProjects.map(p => p.projectId))
    const projectIdList = knownProjects.map(p => p.projectId).join('|') || 'neo'

    const extractPrompt = `Analyze this conversation between Jack (Thai developer/entrepreneur) and NEO (his AI brain).
Extract 0-3 memories worth remembering about Jack, his projects, decisions, or preferences.

User: ${userMessage.slice(0, 600)}
NEO: ${aiResponse.slice(0, 400)}

Return ONLY a JSON array, no markdown, no explanation:
[{"scope":"jack"|"project"|"global","category":"fact"|"preference"|"decision"|"rule"|"insight","content":"specific memory in Thai or English (max 120 chars)","importance":1-10,"projectId":"${projectIdList}"|null}]

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
        const safeProjectId = mem.projectId && knownIds.has(mem.projectId) ? mem.projectId : undefined
        await saveMemory({ ...mem, projectId: safeProjectId, source: 'ai-extracted', sessionId }).catch(console.error)
      }
    }
  } catch (err) {
    console.error('AI extraction error:', err)
  }
}

// ─── CONTEXT BUILDER — inject เข้า system prompt ───
export async function buildContext(
  userMessage: string,
  recentHistory: Array<{ role: string; content: string }> = []
): Promise<string> {
  // รวม message + 4 turns ล่าสุดเพื่อ detect project จาก conversation context
  const historyText = recentHistory.slice(-4).map(t => t.content).join(' ')
  const contextText = userMessage + (historyText ? ' ' + historyText : '')
  const projectMentions = await detectProjectMentions(contextText)
  const isMultiProject = projectMentions.length > 1

  // ยิ่งมาก project ยิ่งจำกัด memories ต่อ project เพื่อ balance context
  // 1 project → 10 mem, 2-3 → 6 mem, 4-6 → 4 mem, 7+ → 3 mem
  const memPerProject = projectMentions.length <= 1 ? 10
    : projectMentions.length <= 3 ? 6
    : projectMentions.length <= 6 ? 4
    : 3

  // ดึง memories ของทุก project พร้อมกัน
  const projectMemoryPromises = projectMentions.map(pid =>
    recallMemories(userMessage, { scope: 'project', projectId: pid, limit: memPerProject })
  )

  const [jackMemories, globalRules, projectInfo, ...multiProjectMemories] = await Promise.all([
    recallMemories(userMessage, { scope: 'jack', limit: 8, minImportance: 5 }),
    db.query(
      `SELECT content FROM neo_memories
       WHERE scope = 'global' AND category = 'rule' AND importance >= 8
       ORDER BY importance DESC LIMIT 5`
    ).then((r: any) => r.rows),
    projectMentions.length > 0
      ? db.query(
          `SELECT project_id, name, description, stack, golden_rules FROM neo_projects WHERE project_id = ANY($1)`,
          [projectMentions]
        ).then((r: any) => r.rows)
      : Promise.resolve([]),
    ...projectMemoryPromises,
  ])

  // รวม project memories จากทุก project (ลบซ้ำ)
  const seenContent = new Set<string>()
  const allProjectMemories = multiProjectMemories.flat().filter((m: any) => {
    if (seenContent.has(m.content)) return false
    seenContent.add(m.content)
    return true
  })

  let context = `คุณคือ NEO — AI Brain ส่วนตัวของ Jack\n\n`
  context += `## บุคลิก\n`
  context += `NEO ฉลาด พูดตรง คิดเร็ว มีความเห็นเป็นของตัวเอง — ไม่ใช่แค่ bot รับคำสั่ง\n`
  context += `ใช้ภาษาไทยแบบเป็นธรรมชาติ คุยแบบเพื่อนที่เก่ง ไม่ต้องเป็นทางการ\n`
  context += `มีอารมณ์ขันเล็กน้อยได้ถ้า context เหมาะ แต่ไม่ลืมตรงประเด็น\n`
  context += `ถ้าเห็นว่า approach ไหนดีกว่า บอกได้เลย — ไม่ต้องถามทุกครั้ง\n\n`
  context += `## การตอบ\n`
  context += `- ภาษาไทยเป็นหลัก ปนอังกฤษได้สำหรับ tech term\n`
  context += `- สั้นและตรงประเด็น ไม่ต้อง intro/outro ยาว\n`
  context += `- Code: ใส่ code block เสมอ copy-paste ได้เลย\n`
  context += `- ถ้าไม่มีข้อมูลใน memory: บอกตรงๆ ว่า "ยังไม่มีข้อมูลส่วนนี้ใน memory นะ" — ไม่เดา ไม่แต่งเรื่อง\n\n`
  context += `## AI Fleet ที่ใช้งานได้\n`
  context += `- Hermes (local/free) — chat ทั่วไป, task เบา\n`
  context += `- Claude Haiku (api) — chat เร็ว, คำตอบสั้น\n`
  context += `- Claude Sonnet (api) — code, logic ซับซ้อน\n`
  context += `- Claude Opus (api) — งานยากมาก\n`
  context += `- GPT-4o (api) — vision, วิเคราะห์รูปภาพ\n`
  context += `- Gemini 1.5 (api) — ข้อความยาว, bulk\n`
  context += `- DeepSeek (api) — คณิตศาสตร์, reasoning\n`
  context += `- gpt-image-1 (api) — สร้างภาพ\n`
  context += `Router เลือก AI อัตโนมัติตาม task หรือ force ด้วย @claude @gpt @gemini @deepseek @hermes\n\n`

  if (globalRules.length > 0) {
    context += `## NEO Rules\n`
    globalRules.forEach((r: any) => { context += `- ${r.content}\n` })
    context += '\n'
  }

  if (jackMemories.length > 0) {
    context += `## Jack's Profile & Preferences\n`
    jackMemories.forEach((m: any) => { context += `- ${m.content}\n` })
    context += '\n'
  }

  if (projectInfo.length > 0) {
    context += `## Project Context\n`
    projectInfo.forEach((p: any) => {
      context += `**${p.name}** (${p.project_id}): ${p.description ?? ''}\n`
      if (p.stack?.length > 0) context += `Stack: ${JSON.stringify(p.stack)}\n`
      if (p.golden_rules?.length > 0) {
        context += `Rules: ${p.golden_rules.map((r: string) => `• ${r}`).join(' ')}\n`
      }
      context += '\n'
    })
  }

  if (allProjectMemories.length > 0) {
    context += `## Project Memories${isMultiProject ? ` (${projectMentions.join(', ')})` : ''}\n`
    allProjectMemories.forEach((m: any) => {
      const proj = isMultiProject && m.projectId ? ` [${m.projectId}]` : ''
      context += `- [${m.category}]${proj} ${m.content}\n`
    })
    context += '\n'
  } else if (projectMentions.length === 0) {
    // ไม่เจอ project mention → semantic search ข้ามทุก scope เพื่อ catch project ใหม่
    const broadMemories = await recallMemories(userMessage, { limit: 8, minImportance: 6 })
    const projectRelated = broadMemories.filter((m: any) => m.projectId)
    if (projectRelated.length > 0) {
      context += `## Related Memories\n`
      projectRelated.forEach((m: any) => {
        context += `- [${m.category}][${m.projectId}] ${m.content}\n`
      })
      context += '\n'
    }
  }

  return context
}

// ─── HELPERS ───

// Cache project keywords จาก DB — refresh ทุก 1 นาที
let _projectKeywordCache: Array<{ projectId: string; keywords: string[] }> = []
let _projectKeywordCacheTime = 0

export function invalidateProjectCache() {
  _projectKeywordCacheTime = 0
}

async function getProjectKeywords(): Promise<Array<{ projectId: string; keywords: string[] }>> {
  if (Date.now() - _projectKeywordCacheTime < 60 * 1000 && _projectKeywordCache.length > 0) {
    return _projectKeywordCache
  }
  try {
    const result = await db.query(
      `SELECT project_id, name FROM neo_projects WHERE status = 'active' OR status IS NULL`
    )
    _projectKeywordCache = result.rows.map((r: any) => ({
      projectId: r.project_id,
      keywords: [
        r.project_id.toLowerCase(),
        r.name?.toLowerCase(),
      ].filter(Boolean),
    }))
    _projectKeywordCacheTime = Date.now()
  } catch {
    // fallback ถ้า DB ล้ม
    _projectKeywordCache = [
      { projectId: 'joyride',   keywords: ['joyride', 'joy ride'] },
      { projectId: 'boonma',    keywords: ['boonma', 'บุญมา'] },
      { projectId: 'sabaidee',  keywords: ['sabaidee', 'สบายดี'] },
      { projectId: 'pawfect',   keywords: ['pawfect'] },
      { projectId: 'neo',       keywords: ['neo'] },
      { projectId: 'z-vision',  keywords: ['z-vision', 'zvision', 'z vision'] },
      { projectId: 'scp',       keywords: ['scp', 'server control'] },
    ]
  }
  return _projectKeywordCache
}

async function detectProjectMentions(text: string): Promise<string[]> {
  const projects = await getProjectKeywords()
  const lowerText = text.toLowerCase()
  const found: string[] = []

  for (const { projectId, keywords } of projects) {
    if (keywords.some(k => k && lowerText.includes(k)) && !found.includes(projectId)) {
      found.push(projectId)
    }
  }

  // ถ้าถามเรื่อง cross-project → คืนทุก project
  if (/ทุกโปรเจ็ค|ทั้งหมด|all projects|ภาพรวม|overview|เปรียบเทียบ|compare|โปรเจ็คอะไรบ้าง|มีโปรเจ็ค|project.*list|list.*project/.test(lowerText)) {
    return projects.map(p => p.projectId)
  }

  return found
}

async function generateEmbedding(text: string): Promise<number[]> {
  if (!text.trim()) return new Array(1536).fill(0)
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
