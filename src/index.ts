import 'dotenv/config'
import { startTelegramBot } from './bot/telegram'
import { startWebServer } from './web/server'
import { db, initMessageTable } from './db/client'
import { seedJackProfile } from './core/seed'
import { startMcpServer } from './mcp/server'
import { startCronJobs } from './core/cron'

async function main() {
  console.log('🧠 NEO starting...')

  try {
    await db.query('SELECT 1')
    console.log('✅ Database connected')
  } catch (e) {
    console.error('❌ Database connection failed:', e)
    process.exit(1)
  }

  await initMessageTable()
  await seedJackProfile()

  startTelegramBot()
  startWebServer(Number(process.env.PORT) || 3000)
  startCronJobs()

  // MCP Server รันผ่าน stdio — เปิดเฉพาะเมื่อถูกเรียกจาก IDE (ไม่ใช่ normal startup)
  if (process.env.NEO_MCP === '1') {
    await startMcpServer()
  }

  console.log('🚀 NEO is running')
  console.log('📱 Telegram: active')
  console.log(`🌐 Web UI: http://localhost:${process.env.PORT ?? 3000}`)
  if (process.env.NEO_MCP === '1') console.log('🔌 MCP Server: stdio')
}

main().catch(console.error)
