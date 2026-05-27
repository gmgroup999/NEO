# NEO — Context File
**Version:** 2.0.0
**Owner:** Jack
**Server:** z-node.cc (Hetzner · Coolify)
**Domain:** neo.z-node.cc

---

## What is NEO

NEO = Jack's Personal AI Brain
- รวม AI หลายค่าย (Qwen, DeepSeek, Gemini, Claude, GPT) ไว้ในที่เดียว
- จำ context ของ Jack และทุก project แบบ long-term (Deep Memory)
- Auto-route task ไปยัง AI ที่เหมาะสมที่สุด (ราคา + คุณภาพ)
- Interface หลัก: Telegram Bot + Web UI (neo.z-node.cc)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 + TypeScript |
| Framework | Fastify |
| Database | PostgreSQL + pgvector (Supabase self-hosted) |
| Local AI | Ollama + **Qwen 2.5** (z-node.cc) |
| Bot | Telegraf (Telegram) |
| Container | Docker + Coolify |

---

## Project Structure (Actual)

```
neo/
├── src/
│   ├── index.ts              # Entry point — Fastify server + Telegram
│   ├── ai/
│   │   ├── qwen.ts           # Ollama / Qwen 2.5 (local, $0)
│   │   ├── clients.ts        # Claude, OpenAI, Gemini Flash, DeepSeek V3+R1
│   │   └── image.ts          # DALL-E 3 + Gemini Imagen
│   ├── bot/
│   │   └── telegram.ts       # Telegram bot handler
│   ├── core/
│   │   ├── router.ts         # AI Router (auto + manual + fallback)
│   │   └── memory.ts         # Memory CRUD + semantic search + context builder
│   └── db/
│       └── client.ts         # PostgreSQL client
├── public/
│   └── index.html            # Web UI (เชื่อมกับ /api/chat จริง)
├── supabase/migrations/
│   └── 001_neo_schema.sql
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── package.json
├── tsconfig.json
└── CLAUDE.md
```

---

## Golden Rules (NEVER BREAK)

1. **ห้าม** save memory โดยไม่มี scope (`'jack'` | `'project'` | `'global'`)
2. **ทุก** AI call ต้องผ่าน `src/core/router.ts` เท่านั้น — ห้าม call AI โดยตรง
3. **Memory Extractor** ต้องทำงาน background — ห้าม block response
4. **ห้าม** แก้ DB schema โดยไม่มี migration file ใน `supabase/migrations/`
5. **Qwen ก่อนเสมอ** — ถ้า Qwen ทำได้ ไม่ส่ง API ภายนอก
6. **ทุก** response ต้องแสดง model ที่ใช้ + estimated cost

---

## AI Fleet & Routing

```
Task                        → Model              ราคา/1M
──────────────────────────────────────────────────────────
แชท, Thai, FAQ, แปล         → Qwen 2.5 (local)   $0
Code, Creative, Content     → DeepSeek V3         $0.27/$1.10
Math, Logic, Reasoning      → DeepSeek R1         $0.55/$2.19
Doc ยาว >5000 chars          → Gemini Flash        $0.10/$0.40
Code ซับซ้อน, Strategy       → Claude Sonnet 4.6   $3/$15
วิเคราะห์ภาพ (vision)        → GPT-4o              $5/$15
สร้างภาพ (default)           → Gemini Imagen       $0.03/ภาพ
สร้างภาพ (@dalle)             → DALL-E 3            $0.04/ภาพ
งานสำคัญมาก                  → Claude Opus 4.7     $15/$75 (manual)
──────────────────────────────────────────────────────────
```

**Fallback chain:**
```
Qwen fail → DeepSeek V3 → Claude Sonnet → error
```

---

## Environment Variables

```env
# Telegram
TELEGRAM_BOT_TOKEN=

# AI APIs
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GOOGLE_API_KEY=
DEEPSEEK_API_KEY=

# Ollama (local)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5

# Database
DATABASE_URL=postgresql://...

# Redis
REDIS_URL=redis://localhost:6379

# Server
PORT=3000
NEO_DOMAIN=neo.z-node.cc
```

---

## API Endpoints

```
GET  /              → Web UI (public/index.html)
POST /api/chat      → Chat endpoint (router → AI)
GET  /api/stats     → Memory count + today cost
GET  /api/health    → Health check
```

**POST /api/chat body:**
```json
{
  "message": "...",
  "sessionId": "uuid"
}
```

---

## Telegram Commands

```
/start          — เริ่มต้น
/memory         — ดู memory ที่ save ไว้
/memory add     — เพิ่ม memory ด้วยตนเอง
/status         — NEO status + cost วันนี้
/route <task>   — ดูว่า task จะไป AI ไหน
/projects       — list ทุก project

Force route:
@qwen    / @hermes  — Qwen 2.5 (local)
@v3      / @deepseek — DeepSeek V3
@r1                  — DeepSeek R1 (reasoning)
@claude              — Claude Sonnet
@gemini              — Gemini Flash
@gpt                 — GPT-4o (vision)
@opus                — Claude Opus (premium)
```

---

## Jack's Profile

- **ภาษา:** ตอบภาษาไทย สั้น ตรง copy-ready code
- **Mindset:** MVP-first, AI-augmented not AI-replaced
- **Infrastructure:** Hetzner + Coolify, self-host everything
- **Stack:** Vite/Next.js + TypeScript + Supabase + Tailwind
- **AI philosophy:** Workflow before AI, Rules before AI, Qwen before Claude

### Active Projects
| Project | Type | Stack | Status |
|---|---|---|---|
| JoyRide | LINE ride-hailing SaaS | Vite+React+Supabase | active |
| boonma paper | Funeral paper business | FB/Shopee/Lazada/TikTok | active |
| sabaidee.cc | District guide (Phimai) | Leaflet+Supabase+Trilingual | build |
| Pawfect Passport | Pet health PWA | Next.js+Supabase+LINE LIFF | plan |
| NEO | AI OS / Personal brain | Node.js+PostgreSQL+Telegram | build |

---

## Memory Schema

```sql
neo_memories (
  scope      TEXT  -- 'jack' | 'project' | 'global'
  category   TEXT  -- 'rule' | 'decision' | 'fact' | 'preference' | 'insight'
  project_id TEXT  -- null ถ้า scope = 'jack'
  content    TEXT
  embedding  VECTOR(1536)
  importance INTEGER  -- 1-10
)
```

---

## Deploy

**Stack:** Docker + Coolify บน Hetzner (z-node.cc)

```bash
# Local dev
cd neo-v2/neo
cp .env.example .env   # ใส่ค่าจริง
npm install
npm run dev

# Production (Coolify auto-deploy จาก GitHub)
git push origin master  # → Coolify triggers rebuild
```

**Coolify config:**
- Repository: `github.com/gmgroup999/NEO`
- Branch: `master`
- Build path: `neo-v2/neo`
- Dockerfile: `neo-v2/neo/Dockerfile`
