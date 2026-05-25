import 'dotenv/config'
import { startTelegramBot } from './bot/telegram'
import { startWebServer } from './web/server'
import { db } from './db/client'
import { seedJackProfile } from './core/seed'

async function main() {
  console.log('🧠 NEO starting...')

  try {
    await db.query('SELECT 1')
    console.log('✅ Database connected')
  } catch (e) {
    console.error('❌ Database connection failed:', e)
    process.exit(1)
  }

  await seedJackProfile()

  startTelegramBot()
  startWebServer(Number(process.env.PORT) || 3000)

  console.log('🚀 NEO is running')
  console.log('📱 Telegram: active')
  console.log(`🌐 Web UI: http://localhost:${process.env.PORT ?? 3000}`)
}

main().catch(console.error)
