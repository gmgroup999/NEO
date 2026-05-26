import { db } from '../db/client'

// ─── TELEGRAM NOTIFY ───
export async function tgNotify(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return

  let chatId = process.env.NEO_TELEGRAM_CHAT_ID
  if (!chatId) {
    const r = await db.query(
      `SELECT session_id FROM neo_messages
       WHERE source = 'telegram' AND role = 'user'
       ORDER BY created_at DESC LIMIT 1`
    ).catch(() => ({ rows: [] as any[] }))
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

// ─── LOG CRON RUN (legacy — cron-manager uses inline INSERT with job_id) ───
export async function logCron(
  jobName: string,
  status: 'success' | 'error' | 'skipped',
  message: string,
  details?: object
): Promise<void> {
  await db.query(
    `INSERT INTO neo_cron_logs (job_name, status, message, details)
     VALUES ($1, $2, $3, $4)`,
    [jobName, status, message, details ? JSON.stringify(details) : null]
  ).catch(console.error)
}
