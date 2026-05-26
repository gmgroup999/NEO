import cron from 'node-cron'
import { db } from '../db/client'
import { callDeepSeek } from '../ai/deepseek'

const MONTHLY_BUDGET = parseFloat(process.env.NEO_MONTHLY_BUDGET || '10')

// ─── TELEGRAM NOTIFY ───
async function tgNotify(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return

  // ใช้ NEO_TELEGRAM_CHAT_ID ถ้ามี มิฉะนั้นดึงจาก last Telegram message ใน DB
  let chatId = process.env.NEO_TELEGRAM_CHAT_ID
  if (!chatId) {
    const r = await db.query(`
      SELECT session_id FROM neo_messages
      WHERE source = 'telegram' AND role = 'user'
      ORDER BY created_at DESC LIMIT 1
    `).catch(() => ({ rows: [] as any[] }))
    chatId = r.rows[0]?.session_id
  }
  if (!chatId) return

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    signal: AbortSignal.timeout(8000),
  }).catch(console.error)
}

// ─── LOG CRON RUN ───
async function logCron(
  jobName: string,
  status: 'success' | 'error' | 'skipped',
  message: string,
  details?: object
) {
  await db.query(
    `INSERT INTO neo_cron_logs (job_name, status, message, details)
     VALUES ($1, $2, $3, $4)`,
    [jobName, status, message, details ? JSON.stringify(details) : null]
  ).catch(console.error)
}

// ─── JOB 1: Daily Cost Report — ทุกวัน 06:00 ───
export async function runDailyCostReport() {
  console.log('[cron] running daily-cost-report')
  try {
    const rows = await db.query(`
      SELECT model, SUM(call_count)::int AS calls,
             COALESCE(SUM(total_cost_usd), 0) AS cost
      FROM neo_costs_daily
      WHERE date = CURRENT_DATE - 1
      GROUP BY model ORDER BY cost DESC
    `).then(r => r.rows)

    if (rows.length === 0) {
      await logCron('daily-cost-report', 'skipped', 'ไม่มี AI call เมื่อวาน', { total: 0 })
      return
    }

    const total = rows.reduce((s: number, r: any) => s + parseFloat(r.cost), 0)
    const dataStr = rows.map((r: any) =>
      `${r.model}: ${r.calls} calls, $${parseFloat(r.cost).toFixed(5)}`
    ).join('\n')

    const { content } = await callDeepSeek(
      `สรุปค่าใช้จ่าย AI เมื่อวานของ Jack:\n${dataStr}\nรวม: $${total.toFixed(5)}\n\nสรุป 2-3 บรรทัด ภาษาไทย กระชับ พร้อมคำแนะนำประหยัดถ้าจำเป็น`,
      'คุณคือ NEO AI Brain ส่วนตัวของ Jack สรุปรายงานค่าใช้จ่ายสั้นๆ ไม่ต้องทักทาย'
    )

    const msg = `📊 <b>Daily AI Cost Report</b>\n${new Date().toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' })}\n\n${content}\n\n💰 รวม: <b>$${total.toFixed(5)}</b>`
    await tgNotify(msg)
    await logCron('daily-cost-report', 'success', content, { total, rows })
  } catch (err: any) {
    console.error('[cron] daily-cost-report error:', err)
    await logCron('daily-cost-report', 'error', err.message ?? 'unknown error', {})
  }
}

// ─── JOB 2: Weekly Memory Cleanup — ทุกวันจันทร์ 02:00 ───
export async function runWeeklyMemoryCleanup() {
  console.log('[cron] running weekly-memory-cleanup')
  try {
    const result = await db.query(`
      DELETE FROM neo_memories
      WHERE importance <= 3
        AND source = 'ai-extracted'
        AND created_at < NOW() - INTERVAL '7 days'
      RETURNING id
    `)
    const deleted = result.rowCount ?? 0
    const msg = `🧹 Memory cleanup: ลบ ${deleted} memories (importance ≤3, อายุ >7 วัน)`

    if (deleted > 0) await tgNotify(msg)
    await logCron('weekly-memory-cleanup', 'success', msg, { deleted })
  } catch (err: any) {
    console.error('[cron] weekly-memory-cleanup error:', err)
    await logCron('weekly-memory-cleanup', 'error', err.message ?? 'unknown error', {})
  }
}

// ─── JOB 3: Monthly Spend Alert — ทุกวัน 08:00 ───
export async function runMonthlySpendAlert() {
  console.log('[cron] running monthly-spend-alert')
  try {
    const result = await db.query(`
      SELECT COALESCE(SUM(total_cost_usd), 0) AS total
      FROM neo_costs_daily
      WHERE date_trunc('month', date) = date_trunc('month', CURRENT_DATE)
    `)
    const spent = parseFloat(result.rows[0].total)
    const pct = (spent / MONTHLY_BUDGET) * 100

    let alertLevel: string | null = null
    if (pct >= 100) alertLevel = '🚨 OVER BUDGET'
    else if (pct >= 80) alertLevel = '⚠️ WARNING'
    else if (pct >= 50) alertLevel = 'ℹ️ HALFWAY'

    if (alertLevel) {
      const msg = `${alertLevel} <b>NEO Budget Alert</b>\nใช้ไป <b>$${spent.toFixed(4)}</b> / $${MONTHLY_BUDGET} (<b>${pct.toFixed(0)}%</b>)`
      await tgNotify(msg)
      await logCron('monthly-spend-alert', 'success', msg, { spent, budget: MONTHLY_BUDGET, pct })
    } else {
      await logCron('monthly-spend-alert', 'skipped',
        `${pct.toFixed(0)}% of budget — no alert needed`,
        { spent, budget: MONTHLY_BUDGET, pct }
      )
    }
  } catch (err: any) {
    console.error('[cron] monthly-spend-alert error:', err)
    await logCron('monthly-spend-alert', 'error', err.message ?? 'unknown error', {})
  }
}

// ─── START ALL JOBS ───
export function startCronJobs() {
  cron.schedule('0 6 * * *', runDailyCostReport,    { timezone: 'Asia/Bangkok' })
  cron.schedule('0 2 * * 1', runWeeklyMemoryCleanup, { timezone: 'Asia/Bangkok' })
  cron.schedule('0 8 * * *', runMonthlySpendAlert,   { timezone: 'Asia/Bangkok' })
  console.log('⏰ Cron jobs started (TZ: Asia/Bangkok)')
}
