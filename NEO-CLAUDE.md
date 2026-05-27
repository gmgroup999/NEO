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

---

## Session Log

### 2026-05-25 — Import Panel + Cross-Project Memory

#### สิ่งที่ทำไปแล้ว
- **Import Panel UI** (`public/index.html`)
  - เพิ่มปุ่ม "📚 Learn" ใน topbar toggle panel
  - Dropzone + file input รับ `.md / .txt / .markdown`
  - Progress bar + result display หลัง upload สำเร็จ
  - Validate file ด้วย extension (ไม่ใช่ MIME เพราะ Windows ส่ง `application/octet-stream` สำหรับ .md)

- **Persistent Import History** (`public/index.html` + `src/web/server.ts`)
  - `GET /api/import-md` — query `neo_memories` group by `source LIKE 'import:%'` คืน filename/projectId/memoryCount/importedAt
  - `loadImportedFiles()` เรียกตอนเปิด panel แสดงไฟล์ที่เคย import ทั้งหมด (ไม่ใช้ in-memory array อีกต่อไป)

- **Delete Imported Memories** (`public/index.html` + `src/web/server.ts`)
  - `DELETE /api/import-md` — ลบทุก memory ที่ `source = 'import:{filename}'`
  - UI: ปุ่ม 🗑 inline พร้อม confirm/cancel ก่อนลบจริง

- **FK Fix + Project Auto-Create** (`src/web/server.ts`)
  - `INSERT INTO neo_projects ... ON CONFLICT DO NOTHING` ก่อน saveMemory เสมอ
  - Normalize projectId เป็น lowercase ก่อน insert ทั้ง projects และ memories
  - `saved` counter นับเฉพาะ saveMemory ที่ไม่ throw

- **Cross-Project Memory Linking** (`src/core/memory.ts`)
  - `detectProjectMentions()` เปลี่ยนจาก hardcode 5 projects → query `neo_projects` จาก DB
  - `getProjectKeywords()` cache 1 นาที, fallback hardcoded ถ้า DB ล้ม
  - `export function invalidateProjectCache()` — เรียกหลัง import ทันที
  - คำถาม cross-project ("ทุกโปรเจ็ค", "ภาพรวม", "compare" ฯลฯ) → ดึงทุก project ไม่จำกัด top 4
  - Dynamic memPerProject: 1→10, 2-3→6, 4-6→4, 7+→3 เพื่อ balance context
  - Fallback semantic search ข้ามทุก scope เมื่อไม่เจอ project mention

- **Port Fix** (server `docker-compose.yml`)
  - เปลี่ยน `3000:3000` → `3200:3000` หลีก conflict กับ container อื่น

- **Conflicting Memory Fix** (DB manual)
  - ลบ 3 ai-extracted memories ที่บอก TanNote = "e-Tax Invoice" ออก
  - `DELETE FROM neo_memories WHERE source = 'ai-extracted' AND project_id IS NULL AND content ILIKE '%tannote%'`

#### ไฟล์ที่แก้ไข
| ไฟล์ | การเปลี่ยนแปลง |
|---|---|
| `src/web/server.ts` | เพิ่ม GET/DELETE /api/import-md, fix POST (FK, lowercase, counter, invalidateCache) |
| `src/core/memory.ts` | DB-backed detectProjectMentions, invalidateProjectCache, dynamic memPerProject, fallback search |
| `public/index.html` | Import panel UI, dropzone, history list, delete confirm/cancel, extension-based validation |
| `docker-compose.yml` (server) | ports 3000→3200 |

#### ปัญหาที่ยังไม่ได้แก้
- (ทุกอย่างแก้แล้ว ใน session 2026-05-26)

#### TODO ถัดไป
- (ไม่มี backlog ค้างอยู่)

#### Security Constraints (คงอยู่ทุก session)
- SSH key: `~/.ssh/neo_key` — deploy จาก Claude Code เท่านั้น ไม่ใช้ terminal ของ user
- API keys ห้าม paste ใน chat
- `.env` ห้าม commit ลง git

---

### 2026-05-25 (ต่อ) — Hallucination Fix + Memory Pipeline Debug

#### สิ่งที่ทำไปแล้ว

- **Conversation Continuity Fix** (`src/core/memory.ts`, `src/web/server.ts`)
  - `buildContext()` รับ `recentHistory` parameter (array of `{role, content}`)
  - concat message + 4 turns ย้อนหลัง ก่อนส่งให้ `detectProjectMentions()`
  - ผล: "ใครสร้าง" ต่อจาก "tannote คืออะไร" → detect tannote จาก history → inject memories ถูกต้อง
  - `server.ts` ส่ง `history.slice(-6)` ให้ `buildContext()`

- **Anti-Hallucination Instruction** (`src/core/memory.ts`)
  - เพิ่มใน system prompt: `⚠️ ห้าม hallucinate: ถ้าไม่มีข้อมูลใน memory ด้านล่าง ให้ตอบว่า "ไม่มีข้อมูลนี้ใน memory" — ห้ามเดาหรือสร้างข้อมูลขึ้นมาเอง`

- **Bug Fix: `getProjectKeywords()` crash** (`src/core/memory.ts`)
  - Query เดิม: `SELECT project_id, name, keywords FROM neo_projects` — column `keywords` ไม่มีใน DB
  - Error → fall to hardcoded fallback list ที่ไม่มี tannote → ไม่ inject memories
  - Fix: `SELECT project_id, name FROM neo_projects` (ไม่เลือก keywords)

- **Cross-Project Pattern เพิ่ม** (`src/core/memory.ts`)
  - เพิ่ม `โปรเจ็คอะไรบ้าง|มีโปรเจ็ค|project.*list|list.*project` ใน cross-project regex
  - "เรามีโปรเจ็คอะไรบ้าง" ตอนนี้คืน all active projects

- **Conflicting Memories Cleanup** (DB manual)
  - ลบ 3 `ai-extracted` memories ที่ describe tannote ผิด (Notability-like, OCR, PDF annotation)
  - `DELETE FROM neo_memories WHERE source = 'ai-extracted' AND project_id IS NULL AND (content ILIKE '%tannote%' OR content ILIKE '%tannot%')`

- **docker-compose.yml** (`docker-compose.yml`)
  - เพิ่ม `supabase_default: external: true` ใน networks
  - เพิ่ม `supabase_default` ใน neo service networks → resolve `getaddrinfo EAI_AGAIN supabase-db`

#### ไฟล์ที่แก้ไข
| ไฟล์ | การเปลี่ยนแปลง |
|---|---|
| `src/core/memory.ts` | buildContext รับ recentHistory, anti-hallucinate instruction, fix keywords query, เพิ่ม cross-project regex |
| `src/web/server.ts` | ส่ง history.slice(-6) ให้ buildContext |
| `docker-compose.yml` | เพิ่ม supabase_default external network (ทั้ง local + server) |

#### ⚠️ Deploy Process ที่ถูกต้อง (สำคัญมาก)
Container ใช้ Dockerfile multi-stage build — `scp dist/*` ไปยัง host **ไม่มีผล** เพราะ container build dist ของตัวเองตอน `docker compose build`

**Deploy flow ที่ถูกต้อง:**
```bash
# 1. copy source ไปยัง server
scp -r src/* jack@z-node.cc:/home/jack/neo/src/
scp package.json tsconfig.json jack@z-node.cc:/home/jack/neo/

# 2. rebuild image + restart
ssh jack@z-node.cc "cd /home/jack/neo && docker compose build && docker compose up -d"
```

#### สิ่งที่แก้แล้วในทุก session
- ทุก backlog ถูกแก้ในวันที่ 2026-05-26 (ดู Session Log ล่าสุด)

#### Security Constraints (คงอยู่ทุก session)
- SSH key: `~/.ssh/neo_key` — deploy จาก Claude Code เท่านั้น
- API keys ห้าม paste ใน chat
- `.env` ห้าม commit ลง git

---

### 2026-05-26 — Bug Fixes + MCP Server

#### สิ่งที่ทำไปแล้ว

- **Fix 1: Auto-cleanup on import** (`src/web/server.ts`)
  - POST `/api/import-md` ตอนนี้ลบ `ai-extracted` memories ที่ `project_id IS NULL AND content ILIKE '%{keyword}%'` ก่อน save memories ใหม่อัตโนมัติ
  - ป้องกัน hallucinated memories สะสมเมื่อ import ข้อมูล project

- **Fix 2: Extract memory guard** (`src/core/memory.ts`)
  - `extractMemoriesFromConversation` ตรวจ `projectId` ที่ Claude extract ว่ามีใน `neo_projects` จริง
  - ถ้าไม่มี → set `projectId = null` แทนที่จะ hallucinate project ผิด

- **Fix 3: Memory Management UI** (`public/index.html` + `src/web/server.ts`)
  - ปุ่ม "🧠 Memories" ใน topbar เปิด Memory Management panel
  - Search + filter by scope/project
  - แก้ไขเนื้อหา memory inline (PUT `/api/memories/:id`)
  - ลบ individual memory (DELETE `/api/memories/:id`)
  - Pagination (25 ต่อหน้า)

- **Fix 4: Import Preview** (`public/index.html` + `src/web/server.ts`)
  - ปุ่ม "🔍 Preview Memories" เรียก POST `/api/import-md/preview` (extract แต่ไม่ save)
  - แสดง list memories พร้อม scope/category/importance
  - ปุ่ม "✅ บันทึก X memories" เพื่อ confirm save จริง

- **Fix 5: TTS Voice Selector** (`public/index.html`)
  - Dropdown ♀ Female (Google TTS proxy) / ♂ Male (Web Speech API pitch=0.7)
  - Hook เข้า `speak()` function โดยตรง

- **Fix 6: MCP Server** (`src/mcp/server.ts`)
  - สร้าง MCP server ใหม่สำหรับ VSCode/Cursor
  - 5 tools: `get_jack_context`, `recall_memory`, `get_project_rules`, `save_memory`, `route_task`
  - รันผ่าน stdio เมื่อ `NEO_MCP=1`

#### ไฟล์ที่แก้ไข
| ไฟล์ | การเปลี่ยนแปลง |
|---|---|
| `src/core/memory.ts` | Extract memory guard (validate projectId vs neo_projects) |
| `src/web/server.ts` | Auto-cleanup, preview endpoint, memory CRUD APIs |
| `src/mcp/server.ts` | **ใหม่** — MCP server 5 tools |
| `src/index.ts` | import + start MCP server เมื่อ NEO_MCP=1 |
| `public/index.html` | Memory panel, import preview, TTS voice selector |
| `NEO-CLAUDE.md` | Session log |

#### การใช้งาน MCP Server (VSCode/Cursor)
เพิ่มใน `.cursor/mcp.json` หรือ VSCode settings:
```json
{
  "mcpServers": {
    "neo": {
      "command": "node",
      "args": ["/home/jack/neo/dist/index.js"],
      "env": { "NEO_MCP": "1" }
    }
  }
}
```

#### Security Constraints (คงอยู่ทุก session)
- SSH key: `~/.ssh/neo_key` — deploy จาก Claude Code เท่านั้น
- API keys ห้าม paste ใน chat
- `.env` ห้าม commit ลง git

---

### 2026-05-26 (ต่อ) — Image Gen · Dynamic Cron · ElevenLabs TTS · Google Cloud TTS Thai

#### สิ่งที่ทำไปแล้ว

**1. Dual Image Provider: Gemini Imagen + OpenAI gpt-image-1** (`src/ai/image.ts`)
- `generateImageGemini()` — `gemini-2.0-flash-preview-image-generation` (default)
- `generateImageOpenAI()` — `gpt-image-1` (secondary)
- `export type ImageProvider = 'gemini' | 'openai'`
- Split-button UI ใน chat bar: main click = insert text, arrow = dropdown เลือก provider
- `setImageProvider()` เปลี่ยนสี + label ตาม provider ที่เลือก
- `let imageProvider` global JS ส่งไปใน POST `/api/chat` ทุก request

**2. Dynamic Cron Job System** (`src/core/cron-manager.ts` + `supabase/migrations/004_cron_jobs.sql`)
- ย้ายจาก hardcoded jobs ใน `cron.ts` → DB-driven (`neo_cron_jobs` table)
- `startDynamicCron()` — load enabled jobs จาก DB, schedule ทุกตัว
- `scheduleJob(job)` — สร้าง main task + optional `reportSchedule` task (สำหรับ youtube_summary)
- `executeJobWithLogging()` — set `last_status='running'` → execute → update DB + log
- `reloadJob(jobId)` — cancel + reschedule single job หลัง CRUD
- `runJobNow(jobId)` — trigger ทันที
- `parseJobFromNL(input)` — DeepSeek แปลง natural language → JSON config
- Action types: `youtube_summary`, `web_scrape`, `custom_prompt`, `spend_alert`, `memory_cleanup`, `daily_report`
- YouTube data: RSS feed (`youtube.com/feeds/videos.xml?channel_id=...`) ไม่ใช้ API key
- Cron tab "⏰ Crons" ใน topbar — full CRUD: add/edit/delete/toggle/run now
- Modal: NL textarea + "🤖 ให้ NEO แปล" → `parseCronNL()` → fill form อัตโนมัติ
- Seeded 3 jobs เดิมเข้า DB: Daily Cost Report, Weekly Memory Cleanup, Monthly Spend Alert

**3. ElevenLabs TTS — Full Replacement** (`src/ai/tts.ts`)
- `generateSpeech(text, voiceId, model='eleven_multilingual_v2')` → Buffer
- `listVoices()` — ดึงจาก API, fallback hardcoded 12 voices เมื่อขาด permission
- Default voice: Rachel (`21m00Tcm4TlvDq8ikWAM`)
- Voice Picker Panel: floating div, search, scroll list, preview button
- Voice selection → `localStorage` (`neoTtsVoiceId`, `neoTtsVoiceName`)
- `speakElevenLabs()` chunk text ที่ 800 chars → ส่ง sequential
- ลบ Google Translate TTS, Web Speech API, old male/female select ออกหมด

**4. Google Cloud TTS — Thai Voices** (`src/ai/gtts.ts`)
- `generateSpeechGoogle(text, voiceName, languageCode)` → Buffer
- Thai voices: Neural2-C, Wavenet A/B/C/D, Standard A/B/C/D (9 เสียง)
- Voice ID prefix `google:` → route ไป Google TTS, อื่น → ElevenLabs
- Voice picker แสดงสองกลุ่ม: 🇹🇭 Google Thai Voices (บน) / ⚡ ElevenLabs (ล่าง)
- ใช้ `GOOGLE_TTS_KEY` (Cloud Platform key แยกต่างหาก) ไม่ใช้ `GOOGLE_API_KEY` (AI Studio)

**5. Memory Trigger Fix** (`src/core/memory.ts`)
- เพิ่ม triggers: `จำไว้`, `จำด้วย`, `จำเอาไว้`, `จำไว้ใน memory`, `save to memory`, `บันทึกไว้`
- ถ้า content หลังตัด trigger ว่าง → ใช้ AI response ก่อนหน้าเป็นสิ่งที่ต้องจำ
- ก่อนหน้านี้ "จำไว้ใน memory" ไม่ trigger เลย NEO แค่ hallucinate ว่า save แล้ว

#### ไฟล์ที่แก้ไข / สร้างใหม่
| ไฟล์ | การเปลี่ยนแปลง |
|---|---|
| `src/ai/image.ts` | Rewrite — dual provider Gemini + OpenAI |
| `src/ai/youtube.ts` | **ใหม่** — RSS fetcher + Gemini summarizer |
| `src/ai/tts.ts` | **ใหม่** — ElevenLabs client + fallback voices list |
| `src/ai/gtts.ts` | **ใหม่** — Google Cloud TTS client, 9 Thai voices |
| `src/core/cron-manager.ts` | **ใหม่** — Dynamic scheduler, all action handlers |
| `src/core/cron.ts` | Simplified — เหลือแค่ `tgNotify()` + `logCron()` |
| `src/core/memory.ts` | เพิ่ม remember triggers + empty-content fallback |
| `src/web/server.ts` | Image provider routing, TTS endpoints, Cron CRUD APIs |
| `src/index.ts` | `startDynamicCron()` แทน `startCronJobs()` |
| `public/index.html` | Split image button, Cron tab+panel+modal, Voice picker panel |
| `docker-compose.yml` | เพิ่ม `ELEVENLABS_API_KEY`, `GOOGLE_TTS_KEY` |
| `supabase/migrations/004_cron_jobs.sql` | **ใหม่** — `neo_cron_jobs` table + seeded 3 jobs |

#### Environment Variables ใหม่ที่ต้องมีใน `.env`
```env
ELEVENLABS_API_KEY=sk_...    # ElevenLabs — ต้องเปิด: voices_read, speech_generation
GOOGLE_TTS_KEY=AIza...       # Google Cloud key — restrict to Cloud Text-to-Speech API
```

#### Deploy Notes
```bash
# Migration (ทำครั้งเดียว)
cat supabase/migrations/004_cron_jobs.sql | docker exec -i supabase-db psql -U postgres -d neo_db

# Standard deploy
scp -i ~/.ssh/neo_key src/path/file.ts jack@195.201.81.33:/home/jack/neo/src/path/file.ts
ssh -i ~/.ssh/neo_key jack@195.201.81.33 "cd /home/jack/neo && docker compose build --no-cache && docker compose up -d"
```

#### ปัญหาที่ยังไม่ได้แก้
- **ElevenLabs community voices**: ต้องเปิด `add_voice_from_voice_library` permission บน API key จึงจะ add เสียงจาก Voice Library ผ่าน API ได้ (ตอนนี้ต้อง add ผ่านเว็บ elevenlabs.io เอง)
- **ElevenLabs Voice Design**: ต้อง paid plan จึงจะสร้าง custom Thai voice ผ่าน API ได้ (ทำผ่าน web UI ได้ถ้า plan รองรับ)
- **Google TTS Thai Neural2 female**: ยังไม่มี `th-TH-Neural2` เสียงหญิง — ใช้ Wavenet-A หรือ Wavenet-D แทน

#### TODO ถัดไป
- ทดสอบ YouTube summary cron job กับ YouTube channel จริง
- เพิ่ม cron action type: `rss_digest` (ข่าว RSS ทั่วไป)
- Web UI แสดง cron logs แบบ real-time (SSE)
- เปรียบเทียบ cost: Google Cloud TTS vs ElevenLabs per character

#### Security Constraints (คงอยู่ทุก session)
- SSH key: `~/.ssh/neo_key` — deploy จาก Claude Code เท่านั้น
- API keys ห้าม paste ใน chat (แม้จะลืม ระบบจะ mask ให้)
- `.env` ห้าม commit ลง git

---

### 2026-05-26 (ต่อ) — Streaming Chat · Web Search · Feedback · Memory Synthesis · Deploy

#### สิ่งที่ทำไปแล้ว

**1. NEO Personality ปรับให้พริ้ว** (`src/core/memory.ts`)
- `buildContext()` system prompt ใหม่ — มีบุคลิก มีอารมณ์ขัน มีความเห็น
- ไม่แข็งๆ เหมือน bot รับคำสั่ง

**2. Tavily Web Search** (`src/ai/search.ts` ใหม่)
- `webSearch(query, maxResults)` — POST `https://api.tavily.com/search`
- `shouldSearch(msg)` — ตรวจ TAVILY_API_KEY + triggers (`@search`, `ค้นหา`, `ข่าวล่าสุด`, `ราคาตอนนี้`, วันนี้+ข่าว/ราคา)
- `formatSearchContext(results)` — inject ผลการค้นหาเป็น markdown ใน system prompt
- ทั้ง Browser และ Telegram ใช้ logic เดียวกัน (inject ก่อน buildContext)

**3. 👍/👎 Feedback → Memory** (`src/web/server.ts`, `public/index.html`)
- ทุก AI response มีปุ่ม 👍/👎
- 👍 → saveMemory `preference` importance 6
- 👎 → saveMemory `insight` importance 9
- `POST /api/feedback` endpoint
- `_feedbackStore` Map เก็บ userMessage + aiResponse ต่อ msgId

**4. Memory Synthesis Nightly Cron** (`src/core/cron-manager.ts`, `src/index.ts`)
- `runMemorySynthesis()` — อ่าน memories 7 วันที่ผ่านมา → Claude Haiku synthesize → save `insight` memories ใหม่
- Seeded cron: `Memory Synthesis Nightly` ทุกวัน `23:30` (`source='synthesis'`)
- Dynamic project IDs ใน extraction prompt (ดึงจาก DB ผ่าน `getProjectKeywords()`)

**5. Bug Fixes**
- Telegram image gen: แปลง `data:image/png;base64,...` → `Buffer` ก่อน `replyWithPhoto`
- Telegram conversation history: ส่ง `session.messages.slice(-20)` ให้ `routeAndCall`
- Hardcoded model IDs: อัปเดต `claude-haiku-4-5-20251001`, `claude-sonnet-4-6`, `claude-opus-4-7`
- Telegram image label: ใช้ `result.model` + `result.provider` แทน hardcoded 'DALL-E 3'
- Image provider/size keywords ใน Telegram: `@openai`/`@gpt` → OpenAI, `landscape`/`portrait` → size

**6. Streaming Chat** (`src/ai/claude.ts`, `openai.ts`, `gemini.ts`, `hermes.ts`, `deepseek.ts`, `src/core/router.ts`, `src/web/server.ts`, `public/index.html`)
- ทุก AI client รับ `onToken?: (token: string) => void` parameter
  - Claude: `messages.create({ stream: true })` + async iterator event types
  - OpenAI/DeepSeek: `create({ stream: true, stream_options: { include_usage: true } })`
  - Gemini: `chat.sendMessageStream()` + async iterator
  - Hermes: `fetch` + NDJSON reader
- `RouteRequest.onToken` ส่ง through ถึง AI client
- `POST /api/chat/stream` — SSE endpoint (token → done/image/error)
- Browser UI: streaming bubble + blinking cursor `.stream-cursor`, metadata แสดงหลัง done
- Image gen ผ่าน stream endpoint ด้วย (type: 'image' event)

**7. Cron SSE Real-time** (`src/core/cron-manager.ts`, `src/web/events.ts`, `public/index.html`)
- `executeJobWithLogging()` emit `cron_start` / `cron_done` / `cron_error` via SSE
- `NeoEvent` type เพิ่ม: `cron_start`, `cron_done`, `cron_error`, `cost_alert`, `deploy_requested`
- `channel` type เพิ่ม: `'system'`; `data` ขยายเป็น `Record<string, any>`
- Live log panel ใน Cron panel แสดง real-time events

**8. Telegram /search Command** (`src/bot/telegram.ts`)
- `/search <query>` — force web search + return top 4 results formatted
- อัปเดต `/start` help text

**9. Memory Export** (`src/web/server.ts`, `public/index.html`)
- `GET /api/memories/export?format=json|csv` — download all memories
- ปุ่ม ⬇ JSON + ⬇ CSV ใน Memory panel footer

**10. Cost Alert Real-time** (`src/web/server.ts`, `public/index.html`)
- `checkCostAlert()` — query ค่าใช้จ่ายวันนี้ หลังทุก stream call
- ถ้าถึง threshold (`DAILY_COST_ALERT_USD`, default $1.00) → emit SSE `cost_alert`
- `_alertedDays` Map ป้องกัน alert ซ้ำในวันเดียวกัน
- Browser แสดง toast notification สีแดง

**11. Deploy Button** (`src/web/server.ts`, `public/index.html`)
- ปุ่ม 🚀 Deploy ใน topbar
- `POST /api/deploy` → notify Telegram พร้อม deploy command ที่ต้องรันบน host
- Auto-create `neo_deploy_log` table ถ้ายังไม่มี
- Toast notification สีเขียวหลัง request สำเร็จ

#### ไฟล์ที่แก้ไข / สร้างใหม่
| ไฟล์ | การเปลี่ยนแปลง |
|---|---|
| `src/ai/claude.ts` | onToken streaming (create stream: true) |
| `src/ai/openai.ts` | onToken streaming (stream_options include_usage) |
| `src/ai/gemini.ts` | onToken streaming (sendMessageStream) |
| `src/ai/hermes.ts` | onToken streaming (NDJSON reader) |
| `src/ai/deepseek.ts` | onToken streaming (stream_options) |
| `src/ai/search.ts` | **ใหม่** — Tavily web search client |
| `src/core/router.ts` | RouteRequest.onToken, pass-through to all clients, updated model IDs |
| `src/core/memory.ts` | NEO personality system prompt, dynamic project IDs in extraction |
| `src/core/cron-manager.ts` | Memory synthesis, emitNeoEvent on start/done/error |
| `src/web/events.ts` | NeoEvent type extended (cron/cost/deploy) |
| `src/web/server.ts` | /api/chat/stream, /api/memories/export, /api/deploy, cost alert |
| `src/bot/telegram.ts` | /search command, image bug fixes, updated /start |
| `public/index.html` | Streaming UI, feedback, export buttons, cost alert toast, deploy button |
| `docker-compose.yml` | TAVILY_API_KEY, DAILY_COST_ALERT_USD |

#### Environment Variables ใหม่
```env
TAVILY_API_KEY=tvly-...          # Tavily web search
DAILY_COST_ALERT_USD=1.0         # Alert threshold (default $1.00)
```

#### Deploy ครั้งนี้ (git-based)
```bash
# ปัจจุบันใช้ git pull แล้ว docker compose build
# VPS path: ~/neo (ไม่ใช่ ~/NEO-OS)
ssh -i ~/.ssh/neo_key jack@195.201.81.33 "cd ~/neo && git pull origin master && docker compose build --no-cache neo && docker compose up -d neo"
```

#### Security Constraints (คงอยู่ทุก session)
- SSH key: `~/.ssh/neo_key` — deploy จาก Claude Code เท่านั้น
- API keys ห้าม paste ใน chat
- `.env` ห้าม commit ลง git

---

### 2026-05-26 (ต่อ) — Image Fixes · History Panel · Project Sync Cron

#### สิ่งที่ทำไปแล้ว

**1. Fix Gemini Image Generation** (`src/ai/image.ts`)
- `imagen-4.0-generate-001` via predict endpoint → "not found for API version v1beta" (ยังคง error)
- เปลี่ยนเป็น `gemini-2.5-flash-image` ผ่าน `generateContent` + `responseModalities: ['IMAGE', 'TEXT']`
- Extract `inlineData` จาก `response.candidates[0].content.parts`
- ใช้ Google Generative AI SDK แทน raw fetch

**2. Image UI Enhancements** (`public/index.html`, `src/ai/image.ts`, `src/web/server.ts`)
- **Download button** — ปุ่ม ⬇ โชว์เมื่อ hover บนภาพ (ซ่อน by default)
  - ใช้ `_imgStore = new Map()` เก็บ URL ด้วย key แยก (หลีกเลี่ยง inline base64 ใน onclick attr)
  - download ได้เป็น `.png` / `.webp` / `.jpg` ตาม mimeType จริง
- **Resolution picker** — เพิ่ม RESOLUTION section ใน image provider menu
  - Square 1024×1024 / Landscape 1536×1024 / Portrait 1024×1536
  - ใช้ได้กับ GPT Image-1 (Gemini ไม่รองรับ size control ผ่าน generateContent)
  - `let imageSize` global → ส่งไปใน POST `/api/chat` → `generateImageOpenAI(prompt, size)`
- **ลบ watermark** — ลบ `<div class="img-overlay">` และ `.img-overlay` CSS ออก

**3. Chat History Panel Fixes** (`public/index.html`)
- **ข้อความเต็ม** — ลบ `.slice(0, 400)` ออก, CSS `-webkit-line-clamp: 3` handle visual truncation แทน
  - คลิกที่ข้อความเพื่อขยายดูทั้งหมด (ใช้ `.expanded` class toggle เดิม)
- **Auto-refresh** — หลังส่งข้อความทุกครั้ง ถ้า `historyOpen === true` → `loadHistory(true)` หลัง 500ms
- **ปุ่ม ↺ Refresh** — เพิ่มในแถว topbar ของ history panel สำหรับ manual refresh

**4. Project Sync Cron Job — Auto-discover CLAUDE.md** (`src/core/cron-manager.ts`, `docker-compose.yml`, `src/index.ts`)
- **Volume mount เปลี่ยน**: จาก hardcode ทีละไฟล์ → mount `/opt:/mnt/opt:ro` และ `/home/jack:/mnt/home:ro`
- **Auto-scan**: recursive scan หา `CLAUDE.md` / `NEO-CLAUDE.md` ใน `/mnt/opt` และ `/mnt/home` (maxDepth 5)
  - ข้าม: `.git`, `node_modules`, `.next`, `dist`, `build`, `__pycache__`, `.venv`
- **Auto-match project**: ดึง directory segments → match กับ `neo_projects.project_id` → fallback ชื่อ folder
- **Auto-create project**: `INSERT INTO neo_projects ... ON CONFLICT DO NOTHING` สำหรับโปรเจ็คใหม่
- **Skip unchanged**: เปรียบเทียบ content หลัง strip `[Synced: ...]` prefix ก่อน → sync เฉพาะเมื่อเปลี่ยนจริง
- **Seed at startup**: `src/index.ts` INSERT cron job `WHERE NOT EXISTS` หลัง `startDynamicCron()`
- **Cron schedule**: `0 2 * * *` (ตี 2, Asia/Bangkok)
- **ผลทดสอบ**: พบ 5 ไฟล์ → server-control-panel (25KB), joyride (40KB), tannote (32KB), znode (34KB), neo (5KB)
- **โปรเจ็คใหม่**: ถ้ามี CLAUDE.md ใน `/opt` หรือ `/home/jack` → ถูก sync อัตโนมัติตี 2 โดยไม่ต้อง rebuild

#### ไฟล์ที่แก้ไข
| ไฟล์ | การเปลี่ยนแปลง |
|---|---|
| `src/ai/image.ts` | Fix Gemini → `gemini-2.5-flash-image` + generateContent; เพิ่ม `size` param ให้ OpenAI |
| `src/web/server.ts` | รับ `imageSize` จาก request body → ส่งต่อ `generateImage()` |
| `src/core/cron-manager.ts` | เพิ่ม `runProjectSync()` — auto-scan + auto-match + auto-create; เพิ่ม dispatch case |
| `src/index.ts` | Seed `Project Sync Daily` cron job ตอน startup (idempotent) |
| `docker-compose.yml` | เปลี่ยน volume mount: ไฟล์ hardcode 5 ไฟล์ → `/opt:ro` และ `/home/jack:ro` |
| `public/index.html` | Download button, resolution picker, ลบ watermark, history auto-refresh + ↺ button, ข้อความเต็ม |

#### TODO ถัดไป
- Web UI แสดง cron logs real-time (SSE)

#### Security Constraints (คงอยู่ทุก session)
- SSH key: `~/.ssh/neo_key` — deploy จาก Claude Code เท่านั้น
- API keys ห้าม paste ใน chat
- `.env` ห้าม commit ลง git

---

### 2026-05-26 (ต่อ) — RSS Digest · claude_md_path · Sidebar Dynamic · Cleanup

#### สิ่งที่ทำไปแล้ว

**1. RSS Digest action type** (`src/core/cron-manager.ts`)
- เพิ่ม action type `rss_digest` ใน cron system
- RSS XML parser เขียนเอง (ไม่ใช้ external lib) — `extractTag()` รองรับ CDATA + HTML entity
- `parseRss()` แยก `<item>` → title, link, pubDate, description
- Filter ตาม `sinceHours` (default 24h), จำกัด `maxItemsPerFeed` ต่อ feed
- สรุปด้วย DeepSeek → ส่ง Telegram
- Config: `{ "feeds": [{"url": "...", "name": "..."}], "maxItemsPerFeed": 5, "sinceHours": 24 }`
- สร้างผ่าน Cron panel ใน UI ได้เลย หรือพิมพ์ภาษาธรรมชาติให้ NEO แปล

**2. `claude_md_path` field ใน `neo_projects`** (`src/index.ts`, `src/core/cron-manager.ts`, `src/web/server.ts`)
- Migration: `ALTER TABLE neo_projects ADD COLUMN IF NOT EXISTS claude_md_path TEXT` รันตอน startup อัตโนมัติ
- `runProjectSync()` อัปเดต: explicit path มาก่อน → auto-scan เฉพาะโปรเจ็คที่ไม่มี explicit path
- `GET /api/projects` — คืน project list รวม `claude_md_path`
- `PUT /api/projects/:projectId` — update `claude_md_path`
- `scp` (Server Control Panel) ตั้ง `claude_md_path = /mnt/opt/apps/server-control-panel/CLAUDE.md` เป็น example

**3. Sidebar Projects — Dynamic (จาก DB)** (`public/index.html`)
- เปลี่ยนจาก hardcode HTML → load จาก `/api/projects` ทุกครั้งที่ page load
- แสดงสี dot ตาม status: active=ฟ้า, build=เขียว, plan=ม่วง
- โปรเจ็คที่มี `claude_md_path` ชัดเจน → แสดง 📌 ต่อท้าย status
- **คลิกที่ชื่อโปรเจ็ค** → prompt ให้ใส่ `claude_md_path` (เว้นว่าง = auto-detect)

**4. Cleanup ข้อมูล DB**
- ลบ `founderos` — test import เก่า (ไม่ใช่โปรเจ็คจริง)
- ลบ `server-control-panel` — duplicate ของ `scp` ที่ถูก auto-create ด้วยชื่อ ugly
- แก้ description ของ `tannote`, `znode`, `scp` ให้ถูกต้อง
- ผลลัพธ์: เหลือ 8 โปรเจ็คจริง: joyride, boonma, sabaidee, pawfect, neo, scp, tannote, znode

**5. ซ่อนปุ่ม Learn** (`public/index.html`)
- ลบปุ่ม `📚 Learn` ออกจาก topbar เพราะมีระบบ auto project sync แทนแล้ว
- Panel ยังอยู่ในโค้ด เพียงแต่ไม่มีปุ่มเปิด

#### ไฟล์ที่แก้ไข
| ไฟล์ | การเปลี่ยนแปลง |
|---|---|
| `src/core/cron-manager.ts` | เพิ่ม `rss_digest` handler + RSS parser; อัปเดต `runProjectSync` ให้ใช้ `claude_md_path` ก่อน auto-scan |
| `src/web/server.ts` | เพิ่ม `GET /api/projects` และ `PUT /api/projects/:id` |
| `src/index.ts` | Migration: ADD COLUMN `claude_md_path` ตอน startup |
| `public/index.html` | Sidebar โหลด projects จาก API แบบ dynamic; คลิกตั้ง `claude_md_path`; ลบปุ่ม Learn |

#### ปัญหาที่ยังไม่ได้แก้
- ไม่มี

#### TODO ถัดไป
- Web UI แสดง cron logs real-time (SSE)

#### Security Constraints (คงอยู่ทุก session)
- SSH key: `~/.ssh/neo_key` — deploy จาก Claude Code เท่านั้น
- API keys ห้าม paste ใน chat
- `.env` ห้าม commit ลง git

---

### 2026-05-26 (ต่อ) — Web UI Panel Fix · Deploy Path Fix · Chat UI Markdown

#### สิ่งที่ทำไปแล้ว

**1. Fix Web UI Panels: System / Crons / Deploy** (`public/index.html`, `src/web/server.ts`)

ปัญหา: กดปุ่ม System, Crons, Deploy แล้วไม่มีอะไรเกิดขึ้น (หน้าจอดำ/ว่าง)

Root cause:
- `crons-panel` ใช้ `style.display = 'flex'/'none'` ขณะที่ `system-panel` ใช้ `classList.add('open')` — inconsistent
- Panel background `#080810` เกือบเหมือนกับ page background `#04040a` มองไม่เห็นเมื่อ panel เปิด
- ไม่มี animation / backdrop ทำให้ไม่รู้ว่า panel เปิดอยู่
- Stray CSS `}` (บรรทัด 1295) หลัง `.voice-row.voice-selected` ทำให้ CSS parse ผิด
- Deploy command ใช้ `cd ~/NEO-OS` ซึ่งไม่มีบน VPS จริง (path จริงคือ `~/neo`)

การแก้:
- ลบ stray CSS `}` ที่ล้นออกมา
- เปลี่ยน panel CSS: `display:none/flex` → `transform: translateX(100%)` slide-in animation 0.25s
- เพิ่ม `z-index: 200`, `border-left`, `box-shadow` ให้ panel ดูชัดเจน
- เพิ่ม `#panel-backdrop` (z-index: 199) — กด backdrop = ปิด panel ทั้งหมด
- `toggleCrons()` เปลี่ยนเป็น `classList.add/remove('open')` ให้ตรงกับ `toggleSystem()`
- เพิ่ม `closeAllPanels()`, `closeAllPanelsExcept(keep)` — System/Crons ปิดกัน
- Escape key ปิด panel ทั้งหมด
- `requestDeploy()`: toast จาก bottom-right → center-screen modal (8 วินาที) + error handling
- `server.ts`: แก้ `cd ~/NEO-OS` → `cd ~/neo`

**2. Markdown Rendering ใน Chat UI** (`public/index.html`, commit `9af9455`)
- Link `[text](url)` → `<a href target=_blank>`
- Table `| col |` → `<table>`
- Code block → `<pre><code>`, Inline code → `<code>`, Bold → `<strong>`
- ปกป้อง XSS ด้วย `escapeHtml()` ก่อน render

**3. Complete AI Fleet ใน System Prompt** (`src/core/memory.ts`, commit `87df668`)
- System prompt แสดงโมเดลทุกตัวที่พร้อมใช้ (Hermes, Claude Sonnet/Opus/Haiku, GPT-4.1, Gemini, DeepSeek, gpt-image-1, Gemini Flash Image)

**4. Fuzzy @mention + Tone-insensitive Image Trigger** (commit `e015ea1`)
- `@neo` match แม้ botUsername ผิด case
- `@claude3.5`, `@claude-4` → map ไป claude
- Image trigger รองรับ `วาด`, `สร้างภาพ`, `generate image`, `draw`, `create image`, `paint` (สระเต็มและไม่เต็ม)

**5. Content Moderation Error Handling** (`src/bot/telegram.ts`, commits `ce0ca7b` / `52e66f4`)
- จับ HTTP 400 + `content_policy_violation` จาก OpenAI → reply ข้อความชัดเจน
- `logAICall` non-blocking สำหรับ image requests (ไม่ throw 500 อีกต่อไป)

#### ไฟล์ที่แก้ไข
| ไฟล์ | การเปลี่ยนแปลง |
|---|---|
| `public/index.html` | CSS slide-in panel animation, backdrop, Escape key, requestDeploy center modal, markdown rendering |
| `src/web/server.ts` | deploy command path `~/NEO-OS` → `~/neo` |
| `src/core/memory.ts` | Complete AI fleet ใน system prompt |
| `src/core/router.ts` | Fuzzy @mention matching |
| `src/bot/telegram.ts` | Tone-insensitive image trigger, content moderation error, non-blocking logAICall |

#### Commits
| Commit | เนื้อหา |
|---|---|
| `1b9ac74` | fix: System/Crons/Deploy panels + deploy path |
| `9af9455` | feat: markdown rendering ใน chat UI |
| `87df668` | feat: complete AI fleet ใน system prompt |
| `e015ea1` | feat: fuzzy @mention + tone-insensitive image trigger |
| `ce0ca7b` | feat: content moderation error message |
| `52e66f4` | fix: logAICall non-blocking for image requests |

#### ⚠️ งานที่ค้างอยู่ / TODO ถัดไป

**CRITICAL — ต้องทำบน VPS (ไม่ใช่ code):**
- **ตั้ง `NEO_TELEGRAM_CHAT_ID` ใน VPS `.env`** — whitelist code deploy แล้วแต่ยัง "dev mode" (ยอมรับทุกคน)
  - Jack ต้อง message `@userinfobot` บน Telegram เพื่อรับ numeric ID
  - แล้วรัน: `ssh -i ~/.ssh/neo_key jack@195.201.81.33 "echo 'NEO_TELEGRAM_CHAT_ID=YOUR_ID' >> ~/neo/.env && cd ~/neo && docker compose up -d neo"`
  - ไม่ต้อง rebuild — แค่ restart container

**Feature Backlog:**
- ทดสอบ YouTube summary cron กับ channel จริง
- Cron logs real-time panel ทดสอบ end-to-end

---

### 2026-05-27 — Security Hardening

#### สิ่งที่ทำไปแล้ว

**1. SSRF Protection** (`src/core/cron-manager.ts`)
- เพิ่ม `isSafeUrl()` ก่อน fetch ใน `runWebScrape()`
- Block: private IPv4 (10.x, 172.16-31.x, 192.168.x), loopback (127.x, localhost), link-local (169.254.x — AWS metadata), CGNAT (100.64/10), IPv6 private (::1, fe80:, fc00:, fd*)
- Block protocols ที่ไม่ใช่ http/https
- URLs ที่ถูก block → warn log + skip (ถ้าทุก URL blocked → throw error)

**2. Session Secret Fail-Hard** (`src/index.ts`, `src/web/auth.ts`)
- `validateEnv()` รันก่อน `main()` — ตรวจ `NEO_SESSION_SECRET` (ต้องมี + ยาว ≥ 32 chars) และ `NEO_PASSWORD`
- ถ้าไม่ครบ → พิมพ์ error ชัดเจน + `process.exit(1)`
- `auth.ts`: ลบ `|| 'neo-default-secret-change-me-in-production'` fallback ออก

**3. Rate Limiting** (`src/web/server.ts`)
- `checkRateLimit(ip)` — in-memory rate limiter, sliding window 1 นาที
- Default: 30 req/min/IP (ปรับได้ด้วย env var `RATE_LIMIT_PER_MIN`)
- ครอบ `/api/chat/stream` เท่านั้น (endpoint ที่แพงที่สุด)
- 429 response มี `Retry-After` header
- Cleanup stale entries ทุก 5 นาที (ไม่ให้ Map โตเรื่อยๆ)

**4. Security Headers** (`src/web/server.ts`)
- `onSend` hook ครอบทุก response:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `X-XSS-Protection: 1; mode=block`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
  - `Content-Security-Policy`: default-src 'self', script/style 'unsafe-inline' (SPA), img data: blob: https:, media blob:, frame-ancestors 'none'

**5. .env.example อัปเดต** (`neo-v2/neo/.env.example`)
- เพิ่ม `NEO_TELEGRAM_CHAT_ID`, `RATE_LIMIT_PER_MIN`
- เพิ่ม comment ว่า Auth vars จะทำให้ crash ถ้าไม่ set

#### ไฟล์ที่แก้ไข
| ไฟล์ | การเปลี่ยนแปลง |
|---|---|
| `src/core/cron-manager.ts` | เพิ่ม `isSafeUrl()` SSRF guard ก่อน fetch ใน `runWebScrape` |
| `src/index.ts` | เพิ่ม `validateEnv()` fail-hard check ก่อน startup |
| `src/web/auth.ts` | ลบ insecure default secret fallback |
| `src/web/server.ts` | เพิ่ม security headers hook + rate limiter สำหรับ /api/chat/stream |
| `neo-v2/neo/.env.example` | เพิ่ม env vars ใหม่ + docs |

#### Environment Variables ที่เพิ่ม
```env
NEO_TELEGRAM_CHAT_ID=123456789   # Numeric ID จาก @userinfobot
RATE_LIMIT_PER_MIN=30             # Rate limit สำหรับ /api/chat/stream (default 30)
```

#### ⚠️ VPS Action Required หลัง deploy
```bash
# ตรวจสอบ NEO_SESSION_SECRET มีใน .env ก่อน deploy
# ถ้าไม่มี → NEO จะ crash ทันที!
ssh -i ~/.ssh/neo_key jack@195.201.81.33 "grep NEO_SESSION_SECRET ~/neo/.env"

# ถ้าไม่มี → เพิ่มก่อน
ssh -i ~/.ssh/neo_key jack@195.201.81.33 \
  "echo \"NEO_SESSION_SECRET=$(openssl rand -hex 32)\" >> ~/neo/.env"
```

#### Security Constraints (คงอยู่ทุก session)
- SSH key: `~/.ssh/neo_key` — deploy จาก Claude Code เท่านั้น
- API keys ห้าม paste ใน chat
- `.env` ห้าม commit ลง git

#### Security Constraints (คงอยู่ทุก session)
- SSH key: `~/.ssh/neo_key` — deploy จาก Claude Code เท่านั้น
- API keys ห้าม paste ใน chat
- `.env` ห้าม commit ลง git
