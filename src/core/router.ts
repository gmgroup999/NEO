import { callHermes } from '../ai/hermes'
import { callClaude, ConversationTurn } from '../ai/claude'
import { callOpenAI } from '../ai/openai'
import { callGemini } from '../ai/gemini'
import { callDeepSeek } from '../ai/deepseek'
import { logAICall } from '../db/client'

export type AIModel = 'hermes' | 'claude-haiku' | 'claude-sonnet' | 'claude-opus' | 'gpt-4o' | 'gemini' | 'deepseek'
export type TaskType = 'chat' | 'code' | 'translation' | 'analysis' | 'creative' | 'math' | 'vision' | 'bulk'

export interface RouteRequest {
  message: string
  systemPrompt: string
  sessionId: string
  forcedModel?: AIModel
  taskHint?: TaskType
  history?: ConversationTurn[]
  imageBase64?: string
  imageMime?: string
  onToken?: (token: string) => void
}

export interface RouteResponse {
  content: string
  model: AIModel
  routedBy: 'auto' | 'manual'
  tokens: { prompt: number; completion: number }
  costUsd: number
  latencyMs: number
}

// ─── TASK CLASSIFIER ───
function classifyTask(message: string): { type: TaskType; complexity: 'low' | 'medium' | 'high' } {
  const msg = message.toLowerCase()

  // Vision — GPT-4o เท่านั้น (ไม่รวม trigger สร้างภาพ ซึ่ง handle แยก)
  if (msg.includes('screenshot') || msg.includes('photo') || msg.includes('ดูรูป') ||
      (msg.includes('วิเคราะห์') && (msg.includes('ภาพ') || msg.includes('รูป')))) {
    return { type: 'vision', complexity: 'medium' }
  }

  // Bulk / ยาวมาก — Gemini (context window ใหญ่สุด)
  if (message.length > 5000) {
    return { type: 'bulk', complexity: 'high' }
  }

  // Code — Claude Sonnet (แม่นยำสุดสำหรับ code)
  if (
    msg.includes('โค้ด') || msg.includes('code') || msg.includes('debug') ||
    msg.includes('bug') || msg.includes('error') || msg.includes('typescript') ||
    msg.includes('javascript') || msg.includes('python') || msg.includes('sql') ||
    msg.includes('supabase') || msg.includes('react') || msg.includes('deploy') ||
    msg.includes('dockerfile') || msg.includes('function') || msg.includes('refactor') ||
    msg.includes('implement') || msg.includes('เขียนโค้ด') || msg.includes('แก้โค้ด')
  ) {
    return { type: 'code', complexity: 'high' }
  }

  // Math / คำนวณ — DeepSeek (reasoning + ถูกสุด)
  if (
    msg.includes('คำนวณ') || msg.includes('สมการ') || msg.includes('math') ||
    msg.includes('formula') || msg.includes('เปอร์เซ็นต์') || msg.includes('%') ||
    msg.includes('กำไร') || msg.includes('ขาดทุน') || msg.includes('ดอกเบี้ย') ||
    msg.includes('ต้นทุน') || msg.includes('roi') || msg.includes('calculate') ||
    /\d+\s*[+\-*/×÷]\s*\d+/.test(msg)
  ) {
    return { type: 'math', complexity: 'medium' }
  }

  // Analysis / วางแผน / เปรียบเทียบ — DeepSeek (reasoning ดี ราคาถูก)
  if (
    msg.includes('วางแผน') || msg.includes('strategy') || msg.includes('วิเคราะห์') ||
    msg.includes('analyse') || msg.includes('analyze') || msg.includes('เปรียบเทียบ') ||
    msg.includes('ข้อดี') || msg.includes('ข้อเสีย') || msg.includes('pros') ||
    msg.includes('cons') || msg.includes('ทำไม') || msg.includes('เหตุผล') ||
    msg.includes('recommend') || msg.includes('suggest') || msg.includes('แนะนำ') ||
    msg.includes('ควรจะ') || msg.includes('คิดว่า') || msg.includes('รีวิว')
  ) {
    return { type: 'analysis', complexity: 'high' }
  }

  // Creative / เขียน content — Claude Haiku (ภาษาสวย เร็ว)
  if (
    msg.includes('เขียน') || msg.includes('draft') || msg.includes('content') ||
    msg.includes('caption') || msg.includes('โฆษณา') || msg.includes('บทความ') ||
    msg.includes('สคริปต์') || msg.includes('script') || msg.includes('ประกาศ') ||
    msg.includes('email') || msg.includes('อีเมล')
  ) {
    return { type: 'creative', complexity: message.length > 300 ? 'high' : 'medium' }
  }

  // Translation — Claude Haiku (แม่นยำ ภาษาเป็นธรรมชาติ)
  if (msg.includes('แปล') || msg.includes('translate') || msg.includes('translation')) {
    return { type: 'translation', complexity: 'low' }
  }

  // Simple greeting / สั้นมาก — Hermes (ฟรี)
  if (message.trim().length < 30) {
    return { type: 'chat', complexity: 'low' }
  }

  return { type: 'chat', complexity: 'medium' }
}

// ─── AUTO ROUTER ───
// Priority: ความเชี่ยวชาญ > ราคา > ความเร็ว
// Default: DeepSeek — ถูก + reasoning ดี เหมาะงานทั่วไปของ Jack
function autoSelectModel(message: string): AIModel {
  const { type, complexity } = classifyTask(message)

  if (type === 'vision')     return 'gpt-4o'       // เดียวที่ดู image ได้
  if (type === 'bulk')       return 'gemini'        // context ยาวสุด
  if (type === 'code')       return 'claude-sonnet' // แม่นยำ code สุด
  if (type === 'math')       return 'deepseek'      // reasoning + ถูกสุด
  if (type === 'analysis')   return 'deepseek'      // reasoning ดี ราคาถูก
  if (type === 'translation') return 'claude-haiku' // ภาษาเป็นธรรมชาติ
  if (type === 'creative' && complexity === 'high') return 'claude-sonnet'
  if (type === 'creative')   return 'claude-haiku'  // เร็ว สวย
  return 'deepseek' // DEFAULT — ถูก + ฉลาด (Hermes ใช้ @hermes เท่านั้น)
}

// ─── FUZZY HELPERS ───
function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0)
  )
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
  return dp[a.length][b.length]
}

// ─── PARSE @MENTION (with fuzzy matching for typos) ───
export function parseMention(message: string): { model: AIModel | null; cleanMessage: string } {
  const mentionMap: Record<string, AIModel> = {
    '@hermes': 'hermes',
    '@qwen': 'hermes',
    '@claude': 'claude-sonnet',
    '@opus': 'claude-opus',
    '@haiku': 'claude-haiku',
    '@gpt': 'gpt-4o',
    '@gemini': 'gemini',
    '@deepseek': 'deepseek',
  }

  const firstWord = message.split(/\s/)[0].toLowerCase()

  // Exact match
  if (mentionMap[firstWord]) {
    return { model: mentionMap[firstWord], cleanMessage: message.slice(firstWord.length).trim() }
  }

  // Fuzzy match — only if starts with @ and within 2 edits of a known mention
  if (firstWord.startsWith('@')) {
    let best: { model: AIModel; mention: string; dist: number } | null = null
    for (const [mention, model] of Object.entries(mentionMap)) {
      const dist = levenshtein(firstWord, mention)
      if (dist <= 2 && (!best || dist < best.dist)) {
        best = { model, mention, dist }
      }
    }
    if (best) {
      return { model: best.model, cleanMessage: message.slice(firstWord.length).trim() }
    }
  }

  return { model: null, cleanMessage: message }
}

// ─── COST ESTIMATOR (USD per 1M tokens) ───
const COST_PER_1M: Record<AIModel, { input: number; output: number }> = {
  'hermes':        { input: 0,     output: 0 },
  'claude-haiku':  { input: 0.25,  output: 1.25 },
  'claude-sonnet': { input: 3,     output: 15 },
  'claude-opus':   { input: 15,    output: 75 },
  'gpt-4o':        { input: 5,     output: 15 },
  'gemini':        { input: 1.25,  output: 5 },
  'deepseek':      { input: 0.14,  output: 0.28 },
}

function estimateCost(model: AIModel, promptTokens: number, completionTokens: number): number {
  const rates = COST_PER_1M[model]
  return (promptTokens * rates.input + completionTokens * rates.output) / 1_000_000
}

// ─── MAIN ROUTER ───
export async function routeAndCall(req: RouteRequest): Promise<RouteResponse> {
  const start = Date.now()
  // ถ้ามีรูปภาพ → บังคับใช้ GPT-4o เสมอ
  const model = req.imageBase64 ? 'gpt-4o' : (req.forcedModel ?? autoSelectModel(req.message))
  const routedBy = req.forcedModel ? 'manual' : 'auto'

  let result: { content: string; promptTokens: number; completionTokens: number }

  const onToken = req.onToken
  switch (model) {
    case 'hermes':
      result = await callHermes(req.message, req.systemPrompt, req.history, onToken)
      break
    case 'claude-haiku':
      result = await callClaude(req.message, req.systemPrompt, 'claude-haiku-4-5-20251001', req.history, onToken)
      break
    case 'claude-sonnet':
      result = await callClaude(req.message, req.systemPrompt, 'claude-sonnet-4-6', req.history, onToken)
      break
    case 'claude-opus':
      result = await callClaude(req.message, req.systemPrompt, 'claude-opus-4-7', req.history, onToken)
      break
    case 'gpt-4o':
      result = await callOpenAI(req.message, req.systemPrompt, req.imageBase64, req.imageMime, req.history, onToken)
      break
    case 'gemini':
      result = await callGemini(req.message, req.systemPrompt, req.history, onToken)
      break
    case 'deepseek':
      result = await callDeepSeek(req.message, req.systemPrompt, req.history, onToken)
      break
    default:
      result = await callHermes(req.message, req.systemPrompt, req.history, onToken)
  }

  const latencyMs = Date.now() - start
  const costUsd = estimateCost(model, result.promptTokens, result.completionTokens)

  logAICall({
    sessionId: req.sessionId,
    model,
    provider: model === 'hermes' ? 'local'
      : model.startsWith('claude') ? 'anthropic'
      : model === 'gpt-4o' ? 'openai'
      : model === 'gemini' ? 'google'
      : 'deepseek',
    taskType: classifyTask(req.message).type,
    routedBy,
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
    costUsd,
    latencyMs,
  }).catch(console.error)

  return {
    content: result.content,
    model,
    routedBy,
    tokens: { prompt: result.promptTokens, completion: result.completionTokens },
    costUsd,
    latencyMs,
  }
}

export function formatCostDisplay(res: RouteResponse): string {
  const modelEmoji: Record<AIModel, string> = {
    'hermes': '🟢',
    'claude-haiku': '🟣',
    'claude-sonnet': '🟣',
    'claude-opus': '🟣',
    'gpt-4o': '🔵',
    'gemini': '🔷',
    'deepseek': '🔴',
  }

  const costDisplay = res.costUsd === 0 ? '$0.00 (local)' : `$${res.costUsd.toFixed(5)}`
  const emoji = modelEmoji[res.model]
  const modeTag = res.routedBy === 'manual' ? '· manual' : ''

  const displayName: Record<AIModel, string> = {
    'hermes': 'qwen2.5:3b',
    'claude-haiku': 'claude-haiku',
    'claude-sonnet': 'claude-sonnet',
    'claude-opus': 'claude-opus',
    'gpt-4o': 'gpt-4o',
    'gemini': 'gemini',
    'deepseek': 'deepseek',
  }
  return `\n─────────────────\n${emoji} ${displayName[res.model]} ${modeTag}\n💰 ${costDisplay} · ⚡ ${res.latencyMs}ms`
}
