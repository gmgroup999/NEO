// src/ai/clients.ts — External AI clients (lazy init)

// ── Claude (Anthropic) ───────────────────────────────────────────
import Anthropic from '@anthropic-ai/sdk'
let _anthropic: Anthropic | null = null
const getAnthropic = () => _anthropic ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export async function callClaude(
  message: string,
  systemPrompt: string,
  model = 'claude-sonnet-4-6'
): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
  const res = await getAnthropic().messages.create({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: message }],
  })
  return {
    content:          res.content[0].type === 'text' ? res.content[0].text : '',
    promptTokens:     res.usage.input_tokens,
    completionTokens: res.usage.output_tokens,
  }
}

// ── OpenAI (GPT-4o — vision + image gen) ────────────────────────
import OpenAI from 'openai'
let _openai: OpenAI | null = null
const getOpenAI = () => _openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

export async function callOpenAI(
  message: string,
  systemPrompt: string
): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
  const res = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: message },
    ],
  })
  return {
    content:          res.choices[0].message.content ?? '',
    promptTokens:     res.usage?.prompt_tokens     ?? 0,
    completionTokens: res.usage?.completion_tokens ?? 0,
  }
}

// ── Gemini Flash (Google — doc ยาว + multimodal) ─────────────────
import { GoogleGenerativeAI } from '@google/generative-ai'
let _genAI: GoogleGenerativeAI | null = null
const getGenAI = () => _genAI ??= new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!)

export async function callGeminiFlash(
  message: string,
  systemPrompt: string
): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
  const model  = getGenAI().getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: systemPrompt,
  })
  const result = await model.generateContent(message)
  const usage  = result.response.usageMetadata
  return {
    content:          result.response.text(),
    promptTokens:     usage?.promptTokenCount     ?? 0,
    completionTokens: usage?.candidatesTokenCount ?? 0,
  }
}

// backward compat alias
export const callGemini = callGeminiFlash

// ── DeepSeek V3 (content, code, creative) ───────────────────────
let _deepseek: OpenAI | null = null
const getDeepSeek = () => _deepseek ??= new OpenAI({
  apiKey:  process.env.DEEPSEEK_API_KEY!,
  baseURL: 'https://api.deepseek.com',
})

export async function callDeepSeekV3(
  message: string,
  systemPrompt: string
): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
  const res = await getDeepSeek().chat.completions.create({
    model: 'deepseek-chat',   // DeepSeek V3
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: message },
    ],
  })
  return {
    content:          res.choices[0].message.content ?? '',
    promptTokens:     res.usage?.prompt_tokens     ?? 0,
    completionTokens: res.usage?.completion_tokens ?? 0,
  }
}

// ── DeepSeek R1 (math, logic, reasoning) ────────────────────────
export async function callDeepSeekR1(
  message: string,
  systemPrompt: string
): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
  const res = await getDeepSeek().chat.completions.create({
    model: 'deepseek-reasoner',   // DeepSeek R1
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: message },
    ],
  })
  return {
    content:          res.choices[0].message.content ?? '',
    promptTokens:     res.usage?.prompt_tokens     ?? 0,
    completionTokens: res.usage?.completion_tokens ?? 0,
  }
}

// backward compat alias (เดิม callDeepSeek → V3)
export const callDeepSeek = callDeepSeekV3
