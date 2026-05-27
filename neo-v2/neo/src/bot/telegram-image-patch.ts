// เพิ่มใน src/bot/telegram.ts
// แทนที่ใน bot.on(message('text'), ...) section

// ─── PATCH: เพิ่ม image support ใน Telegram handler ───
// ใส่ก่อน "Route and call AI" block

import { isImageRequest, extractImagePrompt, generateImage } from '../ai/image'

// ใน bot.on(message('text'), async (ctx) => { ... })
// เพิ่ม block นี้ก่อน routeAndCall():

/*
  // Detect image request
  if (isImageRequest(userMessage)) {
    const prompt = extractImagePrompt(userMessage)
    await ctx.reply('🎨 กำลังสร้างภาพด้วย DALL-E 3 ครับ...')

    try {
      const result = await generateImage(prompt)

      // ส่งภาพกลับ Telegram
      await ctx.replyWithPhoto(result.url, {
        caption: `✅ สร้างเสร็จแล้วครับ\n💰 DALL-E 3 · $${result.costUsd.toFixed(3)}`,
      })

      // Log cost
      await logAICall({
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

    } catch (e) {
      await ctx.reply('❌ สร้างภาพไม่สำเร็จครับ ลองใหม่อีกครั้ง')
    }
    return  // หยุด ไม่ต้อง route ต่อ
  }
*/

// ─── Updated src/index.ts ───
// เปิดทั้ง Telegram + Web server พร้อมกัน

export const updatedIndex = `
import 'dotenv/config'
import { startTelegramBot } from './bot/telegram'
import { startWebServer } from './ai/image'  // web server
import { db } from './db/client'

async function main() {
  console.log('🧠 NEO starting...')

  await db.query('SELECT 1')
  console.log('✅ Database connected')

  // เปิดทั้งสอง interface พร้อมกัน
  startTelegramBot()   // Telegram bot
  startWebServer(3000) // Web UI บน neo.z-node.cc

  console.log('🚀 NEO is running')
  console.log('📱 Telegram: active')
  console.log('🌐 Web UI: neo.z-node.cc')
}

main().catch(console.error)
`
