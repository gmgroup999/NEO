import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js'
import { recallMemories, saveMemory, buildContext } from '../core/memory'
import { db } from '../db/client'

const server = new Server(
  { name: 'neo', version: '0.1.0' },
  { capabilities: { tools: {} } }
)

// ─── List Tools ───
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'get_jack_context',
      description: 'ดึง Jack profile, active projects และ NEO rules สำหรับใช้เป็น system context ใน Cursor/VSCode',
      inputSchema: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'งานที่กำลังทำ (ใช้ build context ที่เหมาะสม)' },
        },
      },
    },
    {
      name: 'recall_memory',
      description: 'ค้นหา memories ของ NEO ด้วย semantic search',
      inputSchema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'คำค้นหา' },
          projectId: { type: 'string', description: 'กรองเฉพาะ project นี้ (optional)' },
          limit: { type: 'number', description: 'จำนวน memories สูงสุด (default 8)' },
        },
      },
    },
    {
      name: 'get_project_rules',
      description: 'ดึง golden rules และ stack ของ project ที่ระบุ',
      inputSchema: {
        type: 'object',
        required: ['projectId'],
        properties: {
          projectId: { type: 'string', description: 'project ID เช่น joyride, neo, boonma' },
        },
      },
    },
    {
      name: 'save_memory',
      description: 'บันทึก memory ใหม่เข้า NEO (เรียกหลังค้นพบข้อมูลสำคัญ)',
      inputSchema: {
        type: 'object',
        required: ['content', 'scope'],
        properties: {
          content: { type: 'string', description: 'เนื้อหา memory (max 200 chars)' },
          scope: { type: 'string', enum: ['jack', 'project', 'global'], description: 'scope ของ memory' },
          category: { type: 'string', enum: ['fact', 'decision', 'rule', 'preference', 'insight', 'context'] },
          projectId: { type: 'string', description: 'project ที่เกี่ยวข้อง (optional)' },
          importance: { type: 'number', description: '1-10 (default 7)' },
        },
      },
    },
    {
      name: 'route_task',
      description: 'ถาม NEO ว่า task นี้ควรใช้ AI ไหน (Hermes/Claude/GPT/Gemini/DeepSeek)',
      inputSchema: {
        type: 'object',
        required: ['task'],
        properties: {
          task: { type: 'string', description: 'คำอธิบาย task' },
        },
      },
    },
  ],
}))

// ─── Call Tool ───
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params

  try {
    switch (name) {

      case 'get_jack_context': {
        const task = (args.task as string) || 'general'
        const context = await buildContext(task)
        return { content: [{ type: 'text', text: context }] }
      }

      case 'recall_memory': {
        const query = args.query as string
        if (!query) throw new McpError(ErrorCode.InvalidParams, 'query required')

        const memories = await recallMemories(query, {
          projectId: args.projectId as string | undefined,
          limit: Math.min(Number(args.limit) || 8, 20),
        })

        const text = memories.length > 0
          ? memories.map(m =>
              `[${m.scope}/${m.category}${m.projectId ? `/${m.projectId}` : ''}] (★${m.importance}) ${m.content}`
            ).join('\n')
          : 'ไม่พบ memories ที่เกี่ยวข้อง'

        return { content: [{ type: 'text', text }] }
      }

      case 'get_project_rules': {
        const projectId = args.projectId as string
        if (!projectId) throw new McpError(ErrorCode.InvalidParams, 'projectId required')

        const [project, memories] = await Promise.all([
          db.query(
            `SELECT project_id, name, description, stack, golden_rules FROM neo_projects WHERE project_id = $1`,
            [projectId.toLowerCase()]
          ),
          recallMemories(projectId, {
            scope: 'project',
            projectId: projectId.toLowerCase(),
            minImportance: 7,
            limit: 10,
          }),
        ])

        if (!project.rows.length) return { content: [{ type: 'text', text: `ไม่พบ project "${projectId}"` }] }

        const p = project.rows[0]
        let text = `## ${p.name} (${p.project_id})\n`
        if (p.description) text += `${p.description}\n\n`
        if (p.stack?.length) text += `**Stack:** ${JSON.stringify(p.stack)}\n\n`
        if (p.golden_rules?.length) {
          text += `**Golden Rules:**\n`
          p.golden_rules.forEach((r: string) => { text += `- ${r}\n` })
          text += '\n'
        }
        if (memories.length > 0) {
          text += `**Key Memories:**\n`
          memories.forEach(m => { text += `- [${m.category}] ${m.content}\n` })
        }

        return { content: [{ type: 'text', text }] }
      }

      case 'save_memory': {
        const content = (args.content as string)?.trim()
        if (!content) throw new McpError(ErrorCode.InvalidParams, 'content required')

        const validScopes = ['jack', 'project', 'global']
        const scope = validScopes.includes(args.scope as string)
          ? (args.scope as 'jack' | 'project' | 'global')
          : 'jack'

        const validCats = ['fact', 'decision', 'rule', 'preference', 'insight', 'context']
        const category = validCats.includes(args.category as string)
          ? (args.category as any)
          : 'fact'

        const id = await saveMemory({
          content: content.slice(0, 200),
          scope,
          category,
          projectId: args.projectId as string | undefined,
          importance: Math.min(Math.max(Number(args.importance) || 7, 1), 10),
          source: 'mcp',
        })

        return { content: [{ type: 'text', text: `✅ บันทึก memory แล้ว (id: ${id})` }] }
      }

      case 'route_task': {
        const task = (args.task as string)?.toLowerCase() || ''
        let model = 'Hermes (local, $0)'
        let reason = 'task ทั่วไปที่ Hermes จัดการได้'

        if (/code|debug|review|refactor|typescript|python|sql|api/.test(task)) {
          model = 'Claude Sonnet'; reason = 'code review / debug ต้องการ reasoning สูง'
        } else if (/image|รูป|vision|ภาพ|screenshot/.test(task)) {
          model = 'GPT-4o'; reason = 'vision / image analysis'
        } else if (/math|คณิต|คำนวณ|logic|เหตุผล|reasoning/.test(task)) {
          model = 'DeepSeek'; reason = 'math / logic reasoning'
        } else if (/long|เอกสาร|วิเคราะห์|analyze|bulk|ยาว/.test(task)) {
          model = 'Gemini 1.5'; reason = 'ข้อความยาว / bulk analysis'
        } else if (/strategy|plan|วางแผน|ตัดสินใจ|decision/.test(task)) {
          model = 'Claude Sonnet'; reason = 'strategy / planning'
        }

        return {
          content: [{ type: 'text', text: `**Recommended:** ${model}\n**Reason:** ${reason}\n\nForce route: @${model.split(' ')[0].toLowerCase()} <message>` }],
        }
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`)
    }
  } catch (err) {
    if (err instanceof McpError) throw err
    throw new McpError(ErrorCode.InternalError, (err as Error).message)
  }
})

export async function startMcpServer() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.log('🔌 NEO MCP Server started (stdio)')
}
