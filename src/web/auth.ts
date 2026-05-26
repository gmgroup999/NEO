import { createHmac, timingSafeEqual } from 'crypto'
import type { FastifyRequest, FastifyReply } from 'fastify'

const SECRET  = process.env.NEO_SESSION_SECRET || 'neo-default-secret-change-me-in-production'
const PASSWORD = process.env.NEO_PASSWORD || ''
const SESSION_SECS = 7 * 24 * 60 * 60  // 7 วัน

// Public paths ที่ไม่ต้องผ่าน auth
const PUBLIC_PATHS = ['/login', '/login.html', '/api/auth/login', '/api/auth/logout']

export function checkPassword(input: string): boolean {
  if (!PASSWORD) {
    console.warn('[auth] NEO_PASSWORD not set — all logins rejected')
    return false
  }
  try {
    // timingSafeEqual ป้องกัน timing attack
    const a = Buffer.from(input.normalize())
    const b = Buffer.from(PASSWORD.normalize())
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch { return false }
}

export function createSessionToken(): string {
  const expiry = Date.now() + SESSION_SECS * 1000
  const payload = String(expiry)
  const sig = createHmac('sha256', SECRET).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function verifySessionToken(token: string): boolean {
  if (!token) return false
  const dot = token.lastIndexOf('.')
  if (dot === -1) return false
  const payload = token.slice(0, dot)
  const sig     = token.slice(dot + 1)
  const expected = createHmac('sha256', SECRET).update(payload).digest('base64url')
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false
  } catch { return false }
  const expiry = parseInt(payload)
  return !isNaN(expiry) && Date.now() < expiry
}

export function parseCookies(header: string = ''): Record<string, string> {
  const out: Record<string, string> = {}
  header.split(';').forEach(part => {
    const eq = part.indexOf('=')
    if (eq === -1) return
    const key = part.slice(0, eq).trim()
    const val = part.slice(eq + 1).trim()
    if (key) out[key] = decodeURIComponent(val)
  })
  return out
}

export function setSessionCookie(reply: FastifyReply, token: string) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  reply.header('Set-Cookie',
    `neo_session=${token}; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECS}; Path=/${secure}`)
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.header('Set-Cookie',
    'neo_session=; HttpOnly; SameSite=Strict; Max-Age=0; Path=/')
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const path = req.url.split('?')[0]

  // อนุญาต public paths โดยไม่ต้อง auth
  if (PUBLIC_PATHS.some(p => path === p || path.startsWith(p + '/'))) return

  const cookies = parseCookies(req.headers.cookie)
  if (verifySessionToken(cookies['neo_session'] || '')) return

  // ไม่มี session ที่ valid → reject
  if (path.startsWith('/api/')) {
    return reply.status(401).send({ error: 'unauthorized' })
  }
  return reply.redirect('/login')
}
