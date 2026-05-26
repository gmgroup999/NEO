import { Telegraf } from 'telegraf'
import { message } from 'telegraf/filters'
import { routeAndCall, parseMention, formatCostDisplay } from '../core/router'
import { buildContext, extractMemoriesFromConversation, saveMemory, recallMemories } from '../core/memory'
import { shouldSearch, webSearch, formatSearchContext } from '../ai/search'
import { db, logAICall, saveMessage } from '../db/client'
import { isImageRequest, extractImagePrompt, generateImage } from '../ai/image'
import { emitNeoEvent } from '../web/events'
import { randomUUID } from 'crypto'

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!)

// ─── Chat ID Whitelist ───
const _allowedIds: Set<bigint> = new Set(
  (process.env.NEO_TELEGRAM_CHAT_ID ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => BigInt(s))
)

function isAllowed(ctx: any): boolean {
  if (_allowedIds.size === 0) return true  // ไม่ set = dev mode อนุญาตทุกคน
  const id = ctx.chat?.id ?? ctx.from?.id
  return id != null && _allowedIds.has(BigInt(id))
}

bot.use(async (ctx, next) => {
  if (isAllowed(ctx)) return next()
  console.warn(`[telegram] blocked unauthorized id: ${ctx.chat?.id ?? ctx.from?.id}`)
  await (ctx as any).reply?.('⛔ Unauthorized').catch(() => {})
})

const sessions  = new Map<string, { id: string; messages: any[] }>()
const voiceMode = new Map<string, { enabled: boolean; voiceId: string; voiceName: string }>()

function getVoice(chatId: string) {
  if (!voiceMode.has(chatId)) {
    voiceMode.set(chatId, { enabled: false, voiceId: 'google:th-TH-Neural2-C', voiceName: 'Thai Neural2-C' })
  }
  return voiceMode.get(chatId)!
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`{1,3}[\s\S]*?`{1,3}/g, '')
    .replace(/#+\s/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function generateTelegramAudio(text: string, voiceId: string): Promise<Buffer> {
  const clean = stripMarkdown(text).slice(0, 800)
  if (voiceId.startsWith('google:')) {
    const { generateSpeechGoogle, GOOGLE_THAI_VOICES } = await import('../ai/gtts')
    const voice = GOOGLE_THAI_VOICES.find(v => v.id === voiceId) ?? GOOGLE_THAI_VOICES[0]
    return generateSpeechGoogle(clean, voice.voiceName, voice.languageCode)
  }
  const { generateSpeech } = await import('../ai/tts')
  return generateSpeech(clean, voiceId)
}

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
    `/projects — ดู projects\n` +
    `/voice — toggle เสียงพูด (Thai/EN)\n` +
    `/search <คำค้น> — ค้นหา web\n\n` +
    `*Force AI:*\n` +
    `@hermes, @claude, @gpt, @gemini, @deepseek\n\n` +
    `*Image:*\n` +
    `พิมพ์ "สร้างภาพ..." เพื่อสร้างภาพ`,
    { parse_mode: 'Markdown' }
  )
})

bot.command('voice', async (ctx) => {
  const chatId = ctx.chat.id.toString()
  const v = getVoice(chatId)
  const arg = ctx.message.text.split(' ')[1]?.toLowerCase()

  if (arg === 'thai' || arg === 'th') {
    v.voiceId   = 'google:th-TH-Neural2-C'
    v.voiceName = '🇹🇭 Thai Neural2-C'
    v.enabled   = true
  } else if (arg === 'en' || arg === 'english') {
    v.voiceId   = '21m00Tcm4TlvDq8ikWAM'  // Rachel
    v.voiceName = '⚡ Rachel (ElevenLabs)'
    v.enabled   = true
  } else if (arg === 'off') {
    v.enabled = false
  } else {
    v.enabled = !v.enabled
  }

  const status = v.enabled ? `🔊 เปิดแล้ว — เสียง: ${v.voiceName}` : '🔇 ปิดแล้ว'
  await ctx.reply(
    `${status}\n\n` +
    `เปลี่ยนเสียง:\n` +
    `/voice thai — 🇹🇭 Google Thai Neural2-C\n` +
    `/voice en — ⚡ ElevenLabs Rachel\n` +
    `/voice off — ปิดเสียง`
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

bot.command('search', async (ctx) => {
  const query = ctx.message.text.split(' ').slice(1).join(' ').trim()
  if (!query) {
    await ctx.reply('ใช้: /search <คำค้น>\n\nตัวอย่าง: /search ราคา bitcoin วันนี้')
    return
  }
  await ctx.sendChatAction('typing')
  try {
    const results = await webSearch(query, 5)
    if (results.length === 0) {
      await ctx.reply('ไม่พบผลการค้นหาครับ')
      return
    }
    let text = `🔍 *ผลการค้นหา: ${query.slice(0, 60)}*\n\n`
    results.slice(0, 4).forEach((r, i) => {
      text += `*${i + 1}. ${r.title.slice(0, 80)}*\n`
      text += `${r.content.slice(0, 200).replace(/\n/g, ' ')}...\n`
      text += `🔗 ${r.url}\n\n`
    })
    await ctx.reply(text, { parse_mode: 'Markdown', link_preview_options: { is_disabled: true } })
      .catch(() => ctx.reply(text.replace(/[*_`]/g, ''), { link_preview_options: { is_disabled: true } }))
  } catch (err: any) {
    await ctx.reply(`❌ ค้นหาไม่สำเร็จ: ${err.message}`)
  }
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
      const lower = userMessage.toLowerCase()

      // Provider: @openai / @gpt / gpt-image ใช้ OpenAI, อื่นๆ = Gemini (default)
      const provider: 'openai' | 'gemini' =
        lower.includes('@openai') || lower.includes('@gpt') || lower.includes('gpt-image') ? 'openai' : 'gemini'

      // Size: landscape/กว้าง → 1536x1024, portrait/สูง → 1024x1536, อื่นๆ = square
      const size =
        /landscape|กว้าง|horizontal/.test(lower) ? '1536x1024' :
        /portrait|สูง|vertical/.test(lower)      ? '1024x1536' : '1024x1024'

      const providerLabel = provider === 'openai' ? 'GPT Image-1' : 'Gemini'
      const prompt = extractImagePrompt(userMessage)
        .replace(/@openai|@gpt|gpt-image|landscape|portrait|กว้าง|สูง|horizontal|vertical/gi, '').trim()

      await ctx.reply(`🎨 กำลังสร้างภาพด้วย ${providerLabel}...`)

      try {
        const result = await generateImage(prompt, provider, size)

        // Telegram ไม่รับ data URL — แปลง base64 เป็น Buffer ก่อนส่ง
        const photoSource = result.url.startsWith('data:')
          ? { source: Buffer.from(result.url.split(',')[1], 'base64'), filename: 'neo-image.png' }
          : result.url
        await ctx.replyWithPhoto(photoSource, {
          caption: `✅ สร้างเสร็จแล้วครับ\n💰 ${result.model} · $${result.costUsd.toFixed(3)}`,
        })

        logAICall({
          sessionId: session.id,
          model: result.model,
          provider: result.provider === 'openai' ? 'openai' : 'google',
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

    const [systemPromptBase, searchResults] = await Promise.all([
      buildContext(messageToProcess),
      shouldSearch(messageToProcess) ? webSearch(messageToProcess) : Promise.resolve([]),
    ])
    const systemPrompt = formatSearchContext(searchResults) + systemPromptBase

    const response = await routeAndCall({
      message: messageToProcess,
      systemPrompt,
      sessionId: session.id,
      forcedModel: forcedModel ?? undefined,
      history: session.messages.slice(-20).map((m: any) => ({ role: m.role, content: m.content })),
    })

    const costDisplay = formatCostDisplay(response)
    const fullResponse = response.content + costDisplay

    await ctx.reply(fullResponse, { parse_mode: 'Markdown' }).catch(() => {
      return ctx.reply(response.content + '\n\n' + costDisplay)
    })

    // Voice message ถ้า voice mode เปิด
    const voice = getVoice(chatId)
    if (voice.enabled) {
      ctx.sendChatAction('record_voice').catch(() => {})
      generateTelegramAudio(response.content, voice.voiceId)
        .then(audio => ctx.replyWithVoice({ source: audio, filename: 'neo.mp3' }))
        .catch(err => console.error('[TTS Telegram]', err.message))
    }

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

    saveMessage({ sessionId: session.id, source: 'telegram', role: 'user', content: userMessage })
    saveMessage({ sessionId: session.id, source: 'telegram', role: 'assistant', content: response.content, model: response.model, costUsd: response.costUsd })

    extractMemoriesFromConversation(userMessage, response.content, session.id)
      .catch(console.error)

  } catch (error) {
    console.error('NEO error:', error)
    await ctx.reply('❌ เกิดข้อผิดพลาดครับ กรุณาลองใหม่')
  }
})

// ─── Helper: download Telegram file → Buffer ───
async function downloadTelegramFile(fileId: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const file = await bot.telegram.getFile(fileId)
  const url  = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`
  const res  = await fetch(url, { signal: AbortSignal.timeout(60000) })
  if (!res.ok) throw new Error(`Download failed: ${res.status}`)
  const buffer   = Buffer.from(await res.arrayBuffer())
  const ext      = file.file_path?.split('.').pop()?.toLowerCase() ?? ''
  const mimeMap: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/avi', webm: 'video/webm',
  }
  return { buffer, mimeType: mimeMap[ext] ?? 'application/octet-stream' }
}

// ─── Photo Handler ───
bot.on(message('photo'), async (ctx) => {
  const chatId  = ctx.chat.id.toString()
  const session = getSession(chatId)
  const caption = ctx.message.caption ?? 'อธิบายภาพนี้ให้ละเอียด สรุปประเด็นสำคัญเป็นภาษาไทย'

  await ctx.sendChatAction('typing')
  try {
    const photos  = ctx.message.photo
    const largest = photos[photos.length - 1]
    const { buffer } = await downloadTelegramFile(largest.file_id)

    const { analyzeFrame } = await import('../ai/video')
    const result = await analyzeFrame(buffer.toString('base64'), caption)

    const voice = getVoice(chatId)
    await ctx.reply(`🖼 ${result.content}\n\n_Gemini · $${result.costUsd.toFixed(5)}_`, { parse_mode: 'Markdown' })
      .catch(() => ctx.reply(`🖼 ${result.content}`))

    if (voice.enabled) {
      generateTelegramAudio(result.content, voice.voiceId)
        .then(audio => ctx.replyWithVoice({ source: audio, filename: 'neo.mp3' }))
        .catch(err => console.error('[TTS photo]', err.message))
    }

    logAICall({ sessionId: session.id, model: result.model, provider: 'google', taskType: 'vision', routedBy: 'auto', promptTokens: 0, completionTokens: 0, costUsd: result.costUsd, latencyMs: 0 }).catch(console.error)
    extractMemoriesFromConversation(caption, result.content, session.id).catch(console.error)
  } catch (err: any) {
    await ctx.reply(`❌ วิเคราะห์ภาพไม่สำเร็จ: ${err.message}`)
  }
})

// ─── Video Handler ───
bot.on(message('video'), async (ctx) => {
  const chatId  = ctx.chat.id.toString()
  const session = getSession(chatId)
  const caption = ctx.message.caption ?? 'วิเคราะห์วิดีโอนี้ สรุปเนื้อหาและประเด็นสำคัญเป็นภาษาไทย'
  const fileSize = ctx.message.video.file_size ?? 0

  if (fileSize > 20 * 1024 * 1024) {
    await ctx.reply('⚠️ วิดีโอใหญ่เกิน 20MB ครับ — Telegram Bot API รองรับสูงสุด 20MB')
    return
  }

  await ctx.reply('🎬 กำลังดาวน์โหลดและวิเคราะห์วิดีโอ รอสักครู่ครับ...')
  await ctx.sendChatAction('typing')

  try {
    const { buffer, mimeType } = await downloadTelegramFile(ctx.message.video.file_id)
    const { analyzeVideo } = await import('../ai/video')
    const result = await analyzeVideo(buffer, mimeType, caption)

    const voice = getVoice(chatId)
    await ctx.reply(`🎬 ${result.content}\n\n_Gemini · $${result.costUsd.toFixed(5)}_`, { parse_mode: 'Markdown' })
      .catch(() => ctx.reply(`🎬 ${result.content}`))

    if (voice.enabled) {
      generateTelegramAudio(result.content, voice.voiceId)
        .then(audio => ctx.replyWithVoice({ source: audio, filename: 'neo.mp3' }))
        .catch(err => console.error('[TTS video]', err.message))
    }

    logAICall({ sessionId: session.id, model: result.model, provider: 'google', taskType: 'video', routedBy: 'auto', promptTokens: 0, completionTokens: 0, costUsd: result.costUsd, latencyMs: 0 }).catch(console.error)
    extractMemoriesFromConversation(caption, result.content, session.id).catch(console.error)
  } catch (err: any) {
    await ctx.reply(`❌ วิเคราะห์วิดีโอไม่สำเร็จ: ${err.message}`)
  }
})

// ─── Document Handler (video files sent as document) ───
bot.on(message('document'), async (ctx) => {
  const doc      = ctx.message.document
  const mimeType = doc.mime_type ?? ''
  if (!mimeType.startsWith('video/')) return  // ignore non-video docs

  const chatId  = ctx.chat.id.toString()
  const session = getSession(chatId)
  const caption = ctx.message.caption ?? 'วิเคราะห์วิดีโอนี้ สรุปเนื้อหาและประเด็นสำคัญเป็นภาษาไทย'

  if ((doc.file_size ?? 0) > 20 * 1024 * 1024) {
    await ctx.reply('⚠️ วิดีโอใหญ่เกิน 20MB ครับ')
    return
  }

  await ctx.reply('🎬 กำลังวิเคราะห์วิดีโอ รอสักครู่ครับ...')
  await ctx.sendChatAction('typing')

  try {
    const { buffer } = await downloadTelegramFile(doc.file_id)
    const { analyzeVideo } = await import('../ai/video')
    const result = await analyzeVideo(buffer, mimeType, caption)

    await ctx.reply(`🎬 ${result.content}\n\n_Gemini · $${result.costUsd.toFixed(5)}_`, { parse_mode: 'Markdown' })
      .catch(() => ctx.reply(`🎬 ${result.content}`))

    const voice = getVoice(chatId)
    if (voice.enabled) {
      generateTelegramAudio(result.content, voice.voiceId)
        .then(audio => ctx.replyWithVoice({ source: audio, filename: 'neo.mp3' }))
        .catch(console.error)
    }

    logAICall({ sessionId: session.id, model: result.model, provider: 'google', taskType: 'video', routedBy: 'auto', promptTokens: 0, completionTokens: 0, costUsd: result.costUsd, latencyMs: 0 }).catch(console.error)
  } catch (err: any) {
    await ctx.reply(`❌ วิเคราะห์ไม่สำเร็จ: ${err.message}`)
  }
})

// ─── LAUNCH ───
export function startTelegramBot() {
  bot.launch()
  console.log('🤖 NEO Telegram Bot started')

  process.once('SIGINT', () => bot.stop('SIGINT'))
  process.once('SIGTERM', () => bot.stop('SIGTERM'))
}
