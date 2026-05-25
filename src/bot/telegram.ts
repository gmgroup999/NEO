import { Telegraf } from 'telegraf'
import { message } from 'telegraf/filters'
import { routeAndCall, parseMention, formatCostDisplay } from '../core/router'
import { buildContext, extractMemoriesFromConversation, saveMemory, recallMemories } from '../core/memory'
import { db, logAICall } from '../db/client'
import { isImageRequest, extractImagePrompt, generateImage } from '../ai/image'
import { emitNeoEvent } from '../web/events'
import { randomUUID } from 'crypto'

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!)

const sessions = new Map<string, { id: string; messages: any[] }>()

function getSession(chatId: string) {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, { id: randomUUID(), messages: [] })
  }
  return sessions.get(chatId)!
}

// ─── COMMANDS ───
bot.command('start', async (ctx) => {
  await ctx.reply(
    `🧠 *NEO — AI Brain ของ Jack*\n\n` +
    `พร้อมแล้วครับ — คุยได้เลย\n\n` +
    `*Commands:*\n` +
    `/memory — ดู memory\n` +
    `/status — status + cost วันนี้\n` +
    `/projects — ดู projects\n\n` +
    `*Force AI:*\n` +
    `@hermes, @claude, @gpt, @gemini, @deepseek\n\n` +
    `*Image:*\n` +
    `พิมพ์ "สร้างภาพ..." เพื่อให้ DALL-E 3 สร้างภาพ`,
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

  if (args[0] === 'add' && args.length > 1) {
    const content = args.slice(1).join(' ')
    await saveMemory({ scope: 'jack', category: 'fact', content, importance: 7, source: 'manual' })
    await ctx.reply(`✅ บันทึก memory แล้วครับ:\n"${content}"`)
    return
  }

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

// ─── MAIN MESSAGE HANDLER ───
bot.on(message('text'), async (ctx) => {
  const chatId = ctx.chat.id.toString()
  const session = getSession(chatId)
  const userMessage = ctx.message.text

  await ctx.sendChatAction('typing')

  try {
    // Image request detection
    if (isImageRequest(userMessage)) {
      const prompt = extractImagePrompt(userMessage)
      await ctx.reply('🎨 กำลังสร้างภาพด้วย DALL-E 3 ครับ...')

      try {
        const result = await generateImage(prompt)

        await ctx.replyWithPhoto(result.url, {
          caption: `✅ สร้างเสร็จแล้วครับ\n💰 DALL-E 3 · $${result.costUsd.toFixed(3)}`,
        })

        logAICall({
          sessionId: session.id,
          model: 'dall-e-3',
          provider: 'openai',
          taskType: 'image',
          routedBy: 'auto',
          promptTokens: 0,
          completionTokens: 0,
          costUsd: result.costUsd,
          latencyMs: 0,
        }).catch(console.error)
      } catch {
        await ctx.reply('❌ สร้างภาพไม่สำเร็จครับ ลองใหม่อีกครั้ง')
      }
      return
    }

    // Normal chat
    const { model: forcedModel, cleanMessage } = parseMention(userMessage)
    const messageToProcess = cleanMessage || userMessage
    const systemPrompt = await buildContext(messageToProcess)

    const response = await routeAndCall({
      message: messageToProcess,
      systemPrompt,
      sessionId: session.id,
      forcedModel: forcedModel ?? undefined,
    })

    const costDisplay = formatCostDisplay(response)
    const fullResponse = response.content + costDisplay

    await ctx.reply(fullResponse, { parse_mode: 'Markdown' }).catch(() => {
      return ctx.reply(response.content + '\n\n' + costDisplay)
    })

    session.messages.push(
      { role: 'user', content: userMessage, timestamp: new Date() },
      { role: 'assistant', content: response.content, model: response.model, timestamp: new Date() }
    )

    // Emit real-time event to Web UI
    emitNeoEvent({
      type: 'telegram_message',
      channel: 'telegram',
      data: {
        preview: userMessage.slice(0, 80),
        model: response.model,
        costUsd: response.costUsd,
        latencyMs: response.latencyMs,
      },
      timestamp: Date.now(),
    })

    extractMemoriesFromConversation(userMessage, response.content, session.id)
      .catch(console.error)

  } catch (error) {
    console.error('NEO error:', error)
    await ctx.reply('❌ เกิดข้อผิดพลาดครับ กรุณาลองใหม่')
  }
})

// ─── LAUNCH ───
export function startTelegramBot() {
  bot.launch()
  console.log('🤖 NEO Telegram Bot started')

  process.once('SIGINT', () => bot.stop('SIGINT'))
  process.once('SIGTERM', () => bot.stop('SIGTERM'))
}
