import http from 'http'
import { execSync } from 'child_process'
import os from 'os'
import { db } from '../db/client'

export interface HealthReport {
  timestamp: string
  overall: 'healthy' | 'degraded' | 'critical'
  system: SystemHealth
  containers: ContainerInfo[]
  services: ServicesHealth
  issues: Issue[]
}

interface SystemHealth {
  cpu:  { usagePct: number }
  ram:  { totalGb: number; usedGb: number; usedPct: number }
  disk: { totalGb: number; usedGb: number; usedPct: number }
}

export interface ContainerInfo {
  name: string
  image: string
  state: 'running' | 'exited' | 'restarting' | 'paused' | 'dead' | 'other'
  status: string
  uptime: string
}

interface ServicesHealth {
  database: { ok: boolean; latencyMs?: number; error?: string }
  telegram: { ok: boolean; username?: string; error?: string }
  ollama:   { ok: boolean; models?: string[]; error?: string }
  deepseek: { ok: boolean; balance?: number; error?: string }
}

export interface Issue {
  severity: 'warning' | 'critical'
  component: string
  message: string
}

// ─── CPU — read /proc/stat twice ───
async function getCpuUsage(): Promise<number> {
  const readStat = () => {
    try {
      const line = require('fs').readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/)
      const vals = line.slice(1).map(Number)
      return { idle: vals[3], total: vals.reduce((a: number, b: number) => a + b, 0) }
    } catch { return { idle: 0, total: 1 } }
  }
  const before = readStat()
  await new Promise(r => setTimeout(r, 400))
  const after = readStat()
  const idleDiff  = after.idle  - before.idle
  const totalDiff = after.total - before.total
  return totalDiff === 0 ? 0 : Math.round((1 - idleDiff / totalDiff) * 100)
}

// ─── RAM ───
function getRamUsage(): SystemHealth['ram'] {
  const total = os.totalmem()
  const free  = os.freemem()
  const used  = total - free
  return {
    totalGb: Math.round(total / 1e9 * 10) / 10,
    usedGb:  Math.round(used  / 1e9 * 10) / 10,
    usedPct: Math.round(used / total * 100),
  }
}

// ─── Disk ───
function getDiskUsage(): SystemHealth['disk'] {
  try {
    const out   = execSync('df -B1 / 2>/dev/null | tail -1', { encoding: 'utf8', timeout: 3000 })
    const parts = out.trim().split(/\s+/)
    const total = parseInt(parts[1])
    const used  = parseInt(parts[2])
    return {
      totalGb: Math.round(total / 1e9),
      usedGb:  Math.round(used  / 1e9),
      usedPct: parseInt(parts[4]),
    }
  } catch { return { totalGb: 0, usedGb: 0, usedPct: 0 } }
}

// ─── Docker containers via Unix socket ───
function dockerGet(path: string): Promise<any> {
  return new Promise((resolve) => {
    try {
      const req = http.request(
        { socketPath: '/var/run/docker.sock', path, method: 'GET' },
        (res) => {
          let data = ''
          res.on('data', c => data += c)
          res.on('end', () => { try { resolve(JSON.parse(data)) } catch { resolve(null) } })
        }
      )
      req.on('error', () => resolve(null))
      req.setTimeout(3000, () => { req.destroy(); resolve(null) })
      req.end()
    } catch { resolve(null) }
  })
}

function uptimeStr(startedAt: string): string {
  if (!startedAt || startedAt.startsWith('0001')) return '—'
  const ms   = Date.now() - new Date(startedAt).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 60)  return `${mins}m`
  if (mins < 1440) return `${Math.floor(mins / 60)}h ${mins % 60}m`
  return `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`
}

async function getContainers(): Promise<ContainerInfo[]> {
  const raw = await dockerGet('/containers/json?all=1')
  if (!Array.isArray(raw)) return []
  return raw.map((c: any) => {
    const state = (['running','exited','restarting','paused','dead'].includes(c.State) ? c.State : 'other') as ContainerInfo['state']
    return {
      name:   (c.Names?.[0] ?? '').replace(/^\//, ''),
      image:  c.Image?.split(':')[0]?.split('/').pop() ?? c.Image,
      state,
      status: c.Status ?? '',
      uptime: state === 'running' ? uptimeStr(c.Created ? new Date(c.Created * 1000).toISOString() : '') : '—',
    }
  }).sort((a: ContainerInfo, b: ContainerInfo) => {
    const order = { running: 0, restarting: 1, paused: 2, exited: 3, dead: 4, other: 5 }
    return order[a.state] - order[b.state]
  })
}

// ─── Services ───
async function checkDatabase(): Promise<ServicesHealth['database']> {
  const t0 = Date.now()
  try {
    await db.query('SELECT 1')
    return { ok: true, latencyMs: Date.now() - t0 }
  } catch (e: any) {
    return { ok: false, error: e.message }
  }
}

async function checkTelegram(): Promise<ServicesHealth['telegram']> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return { ok: false, error: 'TELEGRAM_BOT_TOKEN not set' }
  try {
    const res  = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(5000) })
    const data = await res.json() as any
    return data.ok ? { ok: true, username: data.result?.username } : { ok: false, error: data.description }
  } catch (e: any) {
    return { ok: false, error: e.message }
  }
}

async function checkOllama(): Promise<ServicesHealth['ollama']> {
  try {
    const res  = await fetch(`${process.env.OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(5000) })
    const data = await res.json() as any
    return { ok: true, models: data.models?.map((m: any) => m.name) ?? [] }
  } catch (e: any) {
    return { ok: false, error: e.message }
  }
}

async function checkDeepSeek(): Promise<ServicesHealth['deepseek']> {
  const key = process.env.DEEPSEEK_API_KEY
  if (!key) return { ok: false, error: 'DEEPSEEK_API_KEY not set' }
  try {
    const res  = await fetch('https://api.deepseek.com/user/balance', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000),
    })
    const data = await res.json() as any
    const bal  = data.balance_infos?.[0]
    return { ok: true, balance: bal ? parseFloat(bal.total_balance) : undefined }
  } catch (e: any) {
    return { ok: false, error: e.message }
  }
}

// ─── Issue detection ───
function detectIssues(
  sys: SystemHealth,
  containers: ContainerInfo[],
  svcs: ServicesHealth
): Issue[] {
  const issues: Issue[] = []

  if (sys.cpu.usagePct > 90)   issues.push({ severity: 'critical', component: 'CPU',  message: `CPU usage สูงมาก ${sys.cpu.usagePct}%` })
  else if (sys.cpu.usagePct > 70) issues.push({ severity: 'warning', component: 'CPU', message: `CPU usage สูง ${sys.cpu.usagePct}%` })

  if (sys.ram.usedPct > 90)  issues.push({ severity: 'critical', component: 'RAM',  message: `RAM เต็มมาก ${sys.ram.usedPct}% (${sys.ram.usedGb}/${sys.ram.totalGb}GB)` })
  else if (sys.ram.usedPct > 80) issues.push({ severity: 'warning', component: 'RAM', message: `RAM สูง ${sys.ram.usedPct}%` })

  if (sys.disk.usedPct > 90)  issues.push({ severity: 'critical', component: 'Disk', message: `Disk เต็มมาก ${sys.disk.usedPct}% (${sys.disk.usedGb}/${sys.disk.totalGb}GB)` })
  else if (sys.disk.usedPct > 80) issues.push({ severity: 'warning', component: 'Disk', message: `Disk สูง ${sys.disk.usedPct}%` })

  containers.filter(c => c.state === 'exited' || c.state === 'dead').forEach(c =>
    issues.push({ severity: 'critical', component: `Container: ${c.name}`, message: `Container หยุดทำงาน (${c.status})` })
  )
  containers.filter(c => c.state === 'restarting').forEach(c =>
    issues.push({ severity: 'warning', component: `Container: ${c.name}`, message: `Container กำลัง restart loop` })
  )

  if (!svcs.database.ok) issues.push({ severity: 'critical', component: 'Database', message: svcs.database.error ?? 'DB ไม่ตอบสนอง' })
  else if ((svcs.database.latencyMs ?? 0) > 500) issues.push({ severity: 'warning', component: 'Database', message: `DB latency สูง ${svcs.database.latencyMs}ms` })

  if (!svcs.telegram.ok) issues.push({ severity: 'warning', component: 'Telegram', message: svcs.telegram.error ?? 'Bot ไม่ตอบสนอง' })
  if (!svcs.ollama.ok)   issues.push({ severity: 'warning', component: 'Ollama',   message: svcs.ollama.error   ?? 'Ollama ไม่ตอบสนอง' })
  if (!svcs.deepseek.ok) issues.push({ severity: 'warning', component: 'DeepSeek', message: svcs.deepseek.error ?? 'API ไม่ตอบสนอง' })
  if (svcs.deepseek.ok && svcs.deepseek.balance !== undefined && svcs.deepseek.balance < 1)
    issues.push({ severity: 'warning', component: 'DeepSeek', message: `Balance ต่ำ $${svcs.deepseek.balance?.toFixed(2)}` })

  return issues
}

// ─── MAIN ───
export async function collectHealth(): Promise<HealthReport> {
  const [cpuUsage, containers, database, telegram, ollama, deepseek] = await Promise.all([
    getCpuUsage(),
    getContainers(),
    checkDatabase(),
    checkTelegram(),
    checkOllama(),
    checkDeepSeek(),
  ])

  const system: SystemHealth = {
    cpu:  { usagePct: cpuUsage },
    ram:  getRamUsage(),
    disk: getDiskUsage(),
  }
  const services: ServicesHealth = { database, telegram, ollama, deepseek }
  const issues = detectIssues(system, containers, services)

  const hasCritical = issues.some(i => i.severity === 'critical')
  const hasWarning  = issues.some(i => i.severity === 'warning')
  const overall = hasCritical ? 'critical' : hasWarning ? 'degraded' : 'healthy'

  return { timestamp: new Date().toISOString(), overall, system, containers, services, issues }
}
