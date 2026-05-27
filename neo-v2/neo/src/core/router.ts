// src/core/router.ts
// NEO AI Router — ตาม Fleet ที่ตกลงกัน

import { callQwen }                          from '../ai/qwen'
import { callClaude, callOpenAI, callGeminiFlash, callDeepSeekV3, callDeepSeekR1 } from '../ai/clients'
import { logAICall }                         from '../db/client'

// ─────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────
export type AIModel =
  | 'qwen'
  | 'deepseek-v3'
  | 'deepseek-r1'
  | 'gemini-flash'
  | 'claude-sonnet'
  | 'claude-haiku'    // fallback only
  | 'claude-opus'     // manual only
  | 'gpt-4o'          // vision only

export type TaskType = 'chat' | 'code' | 'translation' | 'analysis' | 'creative' | 'math' | 'vision' | 'bulk'

export interface RouteRequest {
  message:      string
  systemPrompt: string
  sessionId:    string
  forcedModel?: AIModel
  hasImage?:    boolean   // มีภาพแนบมา → GPT-4o vision
}

export interface RouteResponse {
  content:    string
  model:      AIModel
  routedBy:   'auto' | 'manual'
  tokens:     { prompt: number; completion: number }
  costUsd:    number
  latencyMs:  number
}

// ─────────────────────────────────────────
// COST (USD per 1M tokens)
// ─────────────────────────────────────────
const COST_PER_1M: Record<AIModel, { input: number; output: number }> = {
  'qwen':          { input: 0,    output: 0 },
  'deepseek-v3':   { input: 0.27, output: 1.10 },
  'deepseek-r1':   { input: 0.55, output: 2.19 },
  'gemini-flash':  { input: 0.10, output: 0.40 },
  'claude-haiku':  { input: 0.80, output: 4.00 },
  'claude-sonnet': { input: 3.00, output: 15.00 },
  'claude-opus':   { input: 15.00,output: 75.00 },
  'gpt-4o':        { input: 5.00, output: 15.00 },
}

function estimateCost(model: AIModel, input: number, output: number): number {
  const r = COST_PER_1M[model]
  return (input * r.input + output * r.output) / 1_000_000
}

// ─────────────────────────────────────────
// TASK CLASSIFIER
// ─────────────────────────────────────────
function classifyTask(message: string): TaskType {
  const m = message.toLowerCase()

  if (m.includes('คำนวณ') || m.includes('สมการ') || m.includes('math') ||
      m.includes('formula') || m.includes('พิสูจน์') || m.includes('integrate') ||
      m.includes('derivative') || m.includes('โจทย์'))                    return 'math'

  if (m.includes('โค้ด') || m.includes('code') || m.includes('debug') ||
      m.includes('function') || m.includes('bug') || m.includes('error') ||
      m.includes('typescript') || m.includes('sql') || m.includes('api') ||
      m.includes('implement') || m.includes('refactor'))                   return 'code'

  if (m.includes('วางแผน') || m.includes('strategy') || m.includes('วิเคราะห์') ||
      m.includes('analyse') || m.includes('เปรียบเทียบ') || m.includes('ตัดสินใจ') ||
      m.includes('architecture') || m.includes('ออกแบบระบบ'))             return 'analysis'

  if (m.includes('เขียน') || m.includes('draft') || m.includes('content') ||
      m.includes('script') || m.includes('caption') || m.includes('โฆษณา') ||
      m.includes('บทความ') || m.includes('post'))                         return 'creative'

  if (m.includes('แปล') || m.includes('translate'))                       return 'translation'

  return 'chat'
}

// ─────────────────────────────────────────
// AUTO ROUTER
// ─────────────────────────────────────────
//
//  มีภาพแนบ?       → gpt-4o
//  ข้อความยาว >5k?  → gemini-flash   (context 1M)
//  math/logic?     → deepseek-r1     (reasoning)
//  code/creative?  → deepseek-v3     (ถูก + ดี)
//  strategy/debug? → claude-sonnet   (ดีสุด)
//  ทั่วไป?          → qwen            ($0)
//
function autoSelectModel(message: string, hasImage = false): AIModel {
  if (hasImage)              return 'gpt-4o'
  if (message.length > 5000) return 'gemini-flash'

  const task = classifyTask(message)

  if (task === 'math')                           return 'deepseek-r1'
  if (task === 'code')                           return 'deepseek-v3'
  if (task === 'creative')                       return 'deepseek-v3'
  if (task === 'analysis')                       return 'claude-sonnet'
  if (task === 'translation')                    return 'qwen'
  return 'qwen'
}

// ─────────────────────────────────────────
// PARSE @MENTION (Manual Mode)
// ─────────────────────────────────────────
export function parseMention(message: string): { model: AIModel | null; cleanMessage: string } {
  const map: Record<string, AIModel> = {
    '@qwen':    'qwen',
    '@hermes':  'qwen',          // backward compat
    '@deepseek':'deepseek-v3',
    '@v3':      'deepseek-v3',
    '@r1':      'deepseek-r1',
    '@gemini':  'gemini-flash',
    '@claude':  'claude-sonnet',
    '@haiku':   'claude-haiku',
    '@opus':    'claude-opus',
    '@gpt':     'gpt-4o',
  }

  for (const [mention, model] of Object.entries(map)) {
    if (message.toLowerCase().startsWith(mention)) {
      return { model, cleanMessage: message.slice(mention.length).trim() }
    }
  }
  return { model: null, cleanMessage: message }
}

// ─────────────────────────────────────────
// CALL MODEL
// ─────────────────────────────────────────
async function callModel(
  m: AIModel,
  message: string,
  systemPrompt: string
): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
  switch (m) {
    case 'qwen':          return callQwen(message, systemPrompt)
    case 'deepseek-v3':   return callDeepSeekV3(message, systemPrompt)
    case 'deepseek-r1':   return callDeepSeekR1(message, systemPrompt)
    case 'gemini-flash':  return callGeminiFlash(message, systemPrompt)
    case 'claude-haiku':  return callClaude(message, systemPrompt, 'claude-haiku-4-5-20251001')
    case 'claude-sonnet': return callClaude(message, systemPrompt, 'claude-sonnet-4-6')
    case 'claude-opus':   return callClaude(message, systemPrompt, 'claude-opus-4-7')
    case 'gpt-4o':        return callOpenAI(message, systemPrompt)
  }
}

// Fallback chain ถ้า primary fail
const FALLBACK: Partial<Record<AIModel, AIModel>> = {
  'qwen':         'deepseek-v3',
  'deepseek-v3':  'claude-sonnet',
  'deepseek-r1':  'claude-sonnet',
  'gemini-flash': 'claude-sonnet',
  'claude-haiku': 'claude-sonnet',
}

// ─────────────────────────────────────────
// MAIN ROUTER
// ─────────────────────────────────────────
export async function routeAndCall(req: RouteRequest): Promise<RouteResponse> {
  const start = Date.now()

  const model    = req.forcedModel ?? autoSelectModel(req.message, req.hasImage)
  const routedBy = req.forcedModel ? 'manual' : 'auto'

  let result:      { content: string; promptTokens: number; completionTokens: number }
  let actualModel  = model

  try {
    result = await callModel(model, req.message, req.systemPrompt)
  } catch (err) {
    const fallback = FALLBACK[model]
    if (fallback) {
      console.warn(`[router] ${model} failed → fallback ${fallback}: ${(err as Error).message}`)
      result      = await callModel(fallback, req.message, req.systemPrompt)
      actualModel = fallback
    } else {
      throw err
    }
  }

  const latencyMs = Date.now() - start
  const costUsd   = estimateCost(actualModel, result.promptTokens, result.completionTokens)

  // Log (background)
  const providerMap: Record<AIModel, string> = {
    'qwen':          'local',
    'deepseek-v3':   'deepseek',
    'deepseek-r1':   'deepseek',
    'gemini-flash':  'google',
    'claude-haiku':  'anthropic',
    'claude-sonnet': 'anthropic',
    'claude-opus':   'anthropic',
    'gpt-4o':        'openai',
  }

  logAICall({
    sessionId:        req.sessionId,
    model:            actualModel,
    provider:         providerMap[actualModel],
    taskType:         classifyTask(req.message),
    routedBy:         actualModel !== model ? 'auto' : routedBy,
    promptTokens:     result.promptTokens,
    completionTokens: result.completionTokens,
    costUsd,
    latencyMs,
  }).catch(console.error)

  return {
    content:   result.content,
    model:     actualModel,
    routedBy:  actualModel !== model ? 'auto' : routedBy,
    tokens:    { prompt: result.promptTokens, completion: result.completionTokens },
    costUsd,
    latencyMs,
  }
}

// ─────────────────────────────────────────
// FORMAT COST (Telegram display)
// ─────────────────────────────────────────
export function formatCostDisplay(res: RouteResponse): string {
  const emoji: Record<AIModel, string> = {
    'qwen':          '🟢',
    'deepseek-v3':   '🔴',
    'deepseek-r1':   '🔴',
    'gemini-flash':  '🔷',
    'claude-haiku':  '🟣',
    'claude-sonnet': '🟣',
    'claude-opus':   '🟣',
    'gpt-4o':        '🔵',
  }
  const cost = res.costUsd === 0 ? '$0.00 (local)' : `$${res.costUsd.toFixed(5)}`
  const tag  = res.routedBy === 'manual' ? ' · manual' : ''
  return `\n─────────────────\n${emoji[res.model]} ${res.model}${tag}\n💰 ${cost} · ⚡ ${res.latencyMs}ms`
}
