// src/bot/telegram.ts
// NEO Telegram Bot — Jack's primary interface

import { Telegraf, Context } from 'telegraf'
import { message } from 'telegraf/filters'
import { routeAndCall, parseMention, formatCostDisplay } from '../core/router'
import { buildContext, extractMemoriesFromConversation, saveMemory, recallMemories } from '../core/memory'
import { db } from '../db/client'
import { randomUUID } from 'crypto'

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!)

// Session store (in-memory สำหรับ MVP, ย้าย Redis ทีหลัง)
const sessions = new Map<string, { id: string; messages: any[] }>()

function getSession(chatId: string) {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, { id: randomUUID(), messages: [] })
  }
  return sessions.get(chatId)!
}

// ─────────────────────────────────────────
// COMMANDS
// ─────────────────────────────────────────

bot.command('start', async (ctx) => {
  await ctx.reply(
    `🧠 *NEO — AI Brain ของ Jack*\n\n` +
    `พร้อมแล้วครับ — คุยได้เลย\n\n` +
    `*Commands:*\n` +
    `/memory — ดู memory\n` +
    `/status — status + cost วันนี้\n` +
    `/projects — ดู projects\n\n` +
    `*Force AI:*\n` +
    `@hermes, @claude, @gpt, @gemini, @deepseek`,
    { parse_mode: 'Markdown' }
  )
})

bot.command('status', async (ctx) => {
  const result = await db.query(
    `SELECT model, call_count, total_cost_usd 
     FROM neo_costs_daily 
     WHERE date = CURRENT_DATE
     ORDER BY total_cost_usd DESC`
  )

  const totalCost = result.rows.reduce((sum: number, r: any) => sum + parseFloat(r.total_cost_usd), 0)
  const memCount = await db.query('SELECT COUNT(*) FROM neo_memories')

  let text = `📊 *NEO Status — วันนี้*\n\n`
  text += `🧠 Memories: ${memCount.rows[0].count} entries\n\n`

  if (result.rows.length === 0) {
    text += `💰 Cost: $0.00 (ยังไม่มี API calls)\n`
  } else {
    text += `*AI Calls:*\n`
    result.rows.forEach((r: any) => {
      text += `• ${r.model}: ${r.call_count} calls — $${parseFloat(r.total_cost_usd).toFixed(5)}\n`
    })
    text += `\n💰 *Total: $${totalCost.toFixed(5)}*`
  }

  await ctx.reply(text, { parse_mode: 'Markdown' })
})

bot.command('projects', async (ctx) => {
  const result = await db.query(
    `SELECT project_id, name, status, description FROM neo_projects ORDER BY status, name`
  )

  const statusEmoji: Record<string, string> = {
    active: '🟢', build: '🔨', plan: '📋', paused: '⏸️', done: '✅'
  }

  let text = `📂 *Projects ของ Jack*\n\n`
  result.rows.forEach((p: any) => {
    text += `${statusEmoji[p.status] ?? '⚪'} *${p.name}* (${p.project_id})\n`
    text += `   ${p.description?.slice(0, 60)}...\n\n`
  })

  await ctx.reply(text, { parse_mode: 'Markdown' })
})

bot.command('memory', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1)

  // /memory add <content>
  if (args[0] === 'add' && args.length > 1) {
    const content = args.slice(1).join(' ')
    await saveMemory({
      scope: 'jack',
      category: 'fact',
      content,
      importance: 7,
      source: 'manual',
    })
    await ctx.reply(`✅ บันทึก memory แล้วครับ:\n"${content}"`)
    return
  }

  // /memory <query>
  const query = args.join(' ') || 'jack preferences projects'
  const memories = await recallMemories(query, { limit: 8 })

  if (memories.length === 0) {
    await ctx.reply('ยังไม่มี memory ที่เกี่ยวข้องครับ')
    return
  }

  let text = `🧠 *Memories ที่เกี่ยวข้อง*\n\n`
  memories.forEach(m => {
    const scopeTag = m.scope === 'jack' ? '👤' : m.scope === 'project' ? '📂' : '🌐'
    text += `${scopeTag} [${m.category}] ${m.content}\n`
    if (m.projectId) text += `   └ ${m.projectId}\n`
    text += '\n'
  })

  await ctx.reply(text, { parse_mode: 'Markdown' })
})

// ─────────────────────────────────────────
// MAIN MESSAGE HANDLER
// ─────────────────────────────────────────
bot.on(message('text'), async (ctx) => {
  const chatId = ctx.chat.id.toString()
  const session = getSession(chatId)
  const userMessage = ctx.message.text

  // Show typing indicator
  await ctx.sendChatAction('typing')

  try {
    // Parse @mention (manual mode)
    const { model: forcedModel, cleanMessage } = parseMention(userMessage)
    const messageToProcess = cleanMessage || userMessage

    // Build context (inject memories)
    const systemPrompt = await buildContext(messageToProcess)

    // Route and call AI
    const response = await routeAndCall({
      message: messageToProcess,
      systemPrompt,
      sessionId: session.id,
      forcedModel: forcedModel ?? undefined,
    })

    // Format response
    const costDisplay = formatCostDisplay(response)
    const fullResponse = response.content + costDisplay

    // Send response
    await ctx.reply(fullResponse, { parse_mode: 'Markdown' }).catch(() => {
      // Fallback without markdown if parse fails
      return ctx.reply(response.content + '\n\n' + costDisplay)
    })

    // Save to session history
    session.messages.push(
      { role: 'user', content: userMessage, timestamp: new Date() },
      { role: 'assistant', content: response.content, model: response.model, timestamp: new Date() }
    )

    // Extract memories (background — ไม่ block)
    extractMemoriesFromConversation(userMessage, response.content, session.id)
      .catch(console.error)

  } catch (error) {
    console.error('NEO error:', error)
    await ctx.reply('❌ เกิดข้อผิดพลาดครับ กรุณาลองใหม่')
  }
})

// ─────────────────────────────────────────
// LAUNCH
// ─────────────────────────────────────────
export function startTelegramBot() {
  bot.launch()
  console.log('🤖 NEO Telegram Bot started')

  process.once('SIGINT', () => bot.stop('SIGINT'))
  process.once('SIGTERM', () => bot.stop('SIGTERM'))
}
