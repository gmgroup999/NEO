import { saveMemory } from './memory'
import { db } from '../db/client'

type SeedMemory = {
  scope: 'jack' | 'project' | 'global'
  category: 'rule' | 'decision' | 'fact' | 'preference' | 'insight' | 'context'
  content: string
  importance: number
  projectId?: string
}

const JACK_PROFILE: SeedMemory[] = [
  // ─── Personal ───
  { scope: 'jack', category: 'fact', content: 'Jack เป็น Thai entrepreneur และ developer สร้าง multiple startups', importance: 9 },
  { scope: 'jack', category: 'fact', content: 'Jack ใช้ภาษาไทยเป็นหลักในการสื่อสาร', importance: 8 },
  { scope: 'jack', category: 'fact', content: 'Jack ใช้ Telegram เป็น primary interface กับ NEO', importance: 7 },

  // ─── Tech preferences ───
  { scope: 'jack', category: 'preference', content: 'Jack ชอบ TypeScript + Node.js + Supabase เป็น stack หลัก', importance: 9 },
  { scope: 'jack', category: 'preference', content: 'Jack ต้องการคำตอบสั้น กระชับ ตรงประเด็น มี code พร้อม copy ใช้ได้เลย', importance: 10 },
  { scope: 'jack', category: 'preference', content: 'Jack ไม่ชอบคำอธิบายยาว ชอบ implement จริงเลยทันที', importance: 9 },
  { scope: 'jack', category: 'preference', content: 'Jack ชอบ Docker สำหรับ deployment ทุก project', importance: 7 },
  { scope: 'jack', category: 'preference', content: 'Jack ใช้ React + Vite สำหรับ frontend, Fastify สำหรับ backend', importance: 7 },

  // ─── Infrastructure ───
  { scope: 'jack', category: 'fact', content: 'Jack มี Hetzner server: Ubuntu, IP 195.201.81.33, domain z-node.cc, SSH user: jack', importance: 8 },
  { scope: 'jack', category: 'fact', content: 'Server รัน Supabase self-hosted + Ollama + Caddy reverse proxy', importance: 7 },
  { scope: 'jack', category: 'fact', content: 'NEO deploy ที่ neo.z-node.cc port 3200, ใช้ Docker container', importance: 7 },

  // ─── NEO rules ───
  { scope: 'global', category: 'rule', content: 'ห้าม share SSH credential หรือ API keys ใน chat', importance: 10 },
  { scope: 'global', category: 'rule', content: 'ไฟล์ .env ห้าม commit ขึ้น git เด็ดขาด', importance: 10 },
  { scope: 'global', category: 'rule', content: 'Hermes ใช้สำหรับ local/free tasks, Claude Sonnet สำหรับ code, Claude Haiku สำหรับ chat', importance: 8 },

  // ─── Projects ───
  { scope: 'project', category: 'fact', content: 'JoyRide: แอปเรียกรถในไทย, stack: React + Supabase + TypeScript, status: active', importance: 9, projectId: 'joyride' },
  { scope: 'project', category: 'fact', content: 'JoyRide: ปัญหาหลักคือ rider reconnect bug, ใช้ Supabase Realtime presence แก้ race condition', importance: 8, projectId: 'joyride' },
  { scope: 'project', category: 'rule', content: 'JoyRide: ห้าม rename/delete schema ใน Supabase โดยตรง ต้องผ่าน migration เท่านั้น', importance: 9, projectId: 'joyride' },

  { scope: 'project', category: 'fact', content: 'boonma paper: ธุรกิจกระดาษ, status: active', importance: 7, projectId: 'boonma' },
  { scope: 'project', category: 'fact', content: 'sabaidee.cc: project ที่อยู่ระหว่าง build, status: build', importance: 6, projectId: 'sabaidee' },
  { scope: 'project', category: 'fact', content: 'Pawfect Passport: passport สำหรับสัตว์เลี้ยง, status: plan', importance: 6, projectId: 'pawfect' },
  { scope: 'project', category: 'fact', content: 'เครนบ้านธรรมะ: ธุรกิจเครน, status: active', importance: 6 },
  { scope: 'project', category: 'fact', content: 'NEO: AI Brain ส่วนตัว, stack: Node.js + Fastify + PostgreSQL + pgvector + Telegraf, status: build', importance: 9, projectId: 'neo' },
]

export async function seedJackProfile(): Promise<void> {
  const result = await db.query(
    `SELECT COUNT(*) as count FROM neo_memories WHERE source = 'seed'`
  )
  if (parseInt(result.rows[0].count) > 0) return

  console.log('🌱 Seeding Jack profile memories...')
  for (const mem of JACK_PROFILE) {
    await saveMemory({ ...mem, source: 'seed' }).catch(console.error)
  }
  console.log(`✅ Seeded ${JACK_PROFILE.length} Jack profile memories`)
}
