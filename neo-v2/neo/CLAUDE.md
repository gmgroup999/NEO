# NEO — Cursor Context File
**Version:** 1.0.0
**Owner:** Jack
**Server:** z-node.cc (Hetzner · Coolify)
**Domain:** neo.z-node.cc

---

## What is NEO

NEO = Jack's Personal AI Brain
- รวม AI หลายค่าย (Hermes, Claude, GPT, Gemini, DeepSeek) ไว้ในที่เดียว
- จำ context ของ Jack และทุก project แบบ long-term (Deep Memory)
- Auto-route task ไปยัง AI ที่เหมาะสมที่สุด (ราคา + คุณภาพ)
- Interface หลัก: Telegram Bot + VSCode MCP Server

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 + TypeScript |
| Framework | Fastify |
| Database | PostgreSQL + pgvector (Supabase self-hosted) |
| Local AI | Ollama + Hermes 4 (z-node.cc) |
| Bot | Telegraf (Telegram) |
| MCP | @modelcontextprotocol/sdk |
| Container | Docker + Coolify |
| Queue | BullMQ + Redis |

---

## Project Structure

```
neo/
├── src/
│   ├── bot/
│   │   └── telegram.ts       # Telegram bot handler
│   ├── mcp/
│   │   └── server.ts         # MCP server for VSCode/Cursor
│   ├── core/
│   │   ├── handler.ts        # Message orchestrator
│   │   ├── router.ts         # AI Router (auto + manual)
│   │   ├── memory.ts         # Memory CRUD + semantic search
│   │   ├── context.ts        # System prompt builder
│   │   └── extractor.ts      # Auto-extract memory from conversations
│   ├── ai/
│   │   ├── hermes.ts         # Ollama client (local)
│   │   ├── claude.ts         # Anthropic API client
│   │   ├── openai.ts         # OpenAI API client
│   │   ├── gemini.ts         # Google Gemini client
│   │   └── deepseek.ts       # DeepSeek API client
│   └── db/
│       └── client.ts         # PostgreSQL client
├── supabase/migrations/
│   └── 001_neo_schema.sql
├── docker-compose.yml
├── .env.example
├── package.json
├── tsconfig.json
└── CLAUDE.md                 # This file
```

---

## Golden Rules (NEVER BREAK)

1. **ห้าม** save memory โดยไม่มี scope ('jack' | 'project' | 'global')
2. **ทุก** AI call ต้องผ่าน `src/core/router.ts` เท่านั้น — ห้าม call AI โดยตรง
3. **Memory Extractor** ต้องทำงาน background — ห้าม block response
4. **ห้าม** แก้ DB schema โดยไม่มี migration file ใน `supabase/migrations/`
5. **Hermes ก่อนเสมอ** — ถ้า Hermes ทำได้ ไม่ส่ง Claude/GPT
6. **ทุก** response ต้องแสดง model ที่ใช้ + estimated cost

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
OLLAMA_MODEL=hermes4

# Database
DATABASE_URL=postgresql://...

# Redis
REDIS_URL=redis://localhost:6379

# Server
PORT=3000
NEO_DOMAIN=neo.z-node.cc
```

---

## AI Router Rules

```
Task Type              → Model
─────────────────────────────────────────
chat / FAQ / ทั่วไป    → Hermes (local, $0)
translation            → Hermes (local, $0)
content gen (bulk)     → Hermes (local, $0)
code review / debug    → Claude Sonnet
strategy / planning    → Claude Sonnet
long doc analysis      → Gemini 1.5
math / logic           → DeepSeek
image / vision         → GPT-4o
premium / final output → Claude Opus (manual only)
─────────────────────────────────────────
@hermes / @claude / @gpt / @gemini / @deepseek → force route
```

---

## Memory Schema (Quick Ref)

```sql
neo_memories (
  scope    TEXT  -- 'jack' | 'project' | 'global'
  category TEXT  -- 'rule' | 'decision' | 'fact' | 'preference' | 'insight'
  project_id TEXT  -- null ถ้า scope = 'jack'
  content  TEXT
  embedding VECTOR(1536)
  importance INTEGER  -- 1-10
)
```

---

## Jack's Profile (Seed Data)

- **ภาษา:** ตอบภาษาไทย สั้น ตรง copy-ready code
- **Mindset:** MVP-first, AI-augmented not AI-replaced
- **Infrastructure:** Hetzner + Coolify, self-host everything
- **Stack preference:** Vite/Next.js + TypeScript + Supabase + Tailwind
- **AI philosophy:** Workflow before AI, Rules before AI, Hermes before Claude

### Active Projects
| Project | Type | Stack | Status |
|---|---|---|---|
| JoyRide | LINE ride-hailing SaaS | Vite+React+Supabase | active |
| boonma paper | Funeral paper business | FB/Shopee/Lazada/TikTok | active |
| sabaidee.cc | District guide (Phimai) | Leaflet+Supabase+Trilingual | build |
| Pawfect Passport | Pet health PWA | Next.js+Supabase+LINE LIFF | plan |
| NEO | AI OS / Personal brain | Node.js+PostgreSQL+Telegram | build |

---

## Telegram Commands

```
/memory         — ดู memory ที่ save ไว้
/memory add     — เพิ่ม memory ด้วยตนเอง
/status         — NEO status + cost วันนี้
/route <task>   — ดูว่า task จะไป AI ไหน
/projects       — list ทุก project
@claude <msg>   — force Claude
@hermes <msg>   — force Hermes
@gpt <msg>      — force GPT-4o
@gemini <msg>   — force Gemini
@deepseek <msg> — force DeepSeek
```

---

## MCP Endpoint (VSCode/Cursor)

```
URL: neo.z-node.cc/mcp
Tools exposed:
  - get_jack_context    → ดึง Jack profile + active projects
  - recall_memory       → semantic search memory
  - get_project_rules   → ดึง golden rules ของ project
  - save_memory         → save memory ใหม่
  - route_task          → ถาม NEO ว่าควรใช้ AI ไหน
```

---

## Build Order

```
Phase 0 (Week 1): Foundation
→ Telegram bot + Hermes + Claude connect
→ Basic AI Router
→ ตอบได้ + route ได้

Phase 1 (Week 2): Memory
→ PostgreSQL + pgvector
→ Memory save/recall
→ Seed Jack profile + projects

Phase 2 (Week 3): Context
→ Auto-inject memory ทุก AI call
→ Memory Extractor background job
→ Cost tracking

Phase 3 (Week 4): VSCode
→ MCP Server
→ Deploy neo.z-node.cc
→ Jack ใช้งานจริง
```
