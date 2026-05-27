import 'dotenv/config'
import { startTelegramBot } from './bot/telegram'
import { startWebServer } from './web/server'
import { db, initMessageTable } from './db/client'
import { seedJackProfile } from './core/seed'
import { startMcpServer } from './mcp/server'
import { startDynamicCron } from './core/cron-manager'

// ─── Startup env validation — fail-hard ก่อนเริ่ม ───
function validateEnv() {
  const errors: string[] = []

  if (!process.env.NEO_SESSION_SECRET) {
    errors.push('NEO_SESSION_SECRET is not set — sessions will be insecure. Set a strong random string in .env')
  } else if (process.env.NEO_SESSION_SECRET.length < 32) {
    errors.push('NEO_SESSION_SECRET is too short (min 32 chars) — use: openssl rand -hex 32')
  }

  if (!process.env.NEO_PASSWORD) {
    errors.push('NEO_PASSWORD is not set — Web UI will reject all logins')
  }

  if (errors.length > 0) {
    console.error('\n❌ FATAL: NEO cannot start due to missing/invalid environment variables:\n')
    errors.forEach(e => console.error(`  • ${e}`))
    console.error('\nFix .env then restart NEO.\n')
    process.exit(1)
  }
}

async function main() {
  validateEnv()
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
  // Migration: add claude_md_path column if not exists
  await db.query('ALTER TABLE neo_projects ADD COLUMN IF NOT EXISTS claude_md_path TEXT').catch(console.error)

  await startDynamicCron()

  // Seed memory synthesis cron job (once, idempotent)
  await db.query(`
    INSERT INTO neo_cron_jobs (name, description, schedule, action_type, action_config, ai_model, enabled)
    SELECT $1, $2, $3, $4, $5::jsonb, $6, $7
    WHERE NOT EXISTS (SELECT 1 FROM neo_cron_jobs WHERE name = $1)
  `, [
    'Memory Synthesis Nightly',
    'สังเคราะห์ insights จาก memories 7 วัน → สร้าง pattern-level memories ทุกคืน 23:30',
    '30 23 * * *',
    'memory_synthesis',
    '{}',
    'claude-haiku',
    true,
  ]).catch(console.error)

  // Seed project sync cron job (once, idempotent)
  await db.query(`
    INSERT INTO neo_cron_jobs (name, description, schedule, action_type, action_config, ai_model, enabled)
    SELECT $1, $2, $3, $4, $5::jsonb, $6, $7
    WHERE NOT EXISTS (SELECT 1 FROM neo_cron_jobs WHERE name = $1)
  `, [
    'Project Sync Daily',
    'โหลด CLAUDE.md จากทุกโปรเจ็คบน server — บันทึกลง memory ทุกวันตี 2',
    '0 2 * * *',
    'project_sync',
    '{}',
    'none',
    true,
  ]).catch(console.error)

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
