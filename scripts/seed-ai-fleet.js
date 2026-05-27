require('dotenv/config')
const { db } = require('./dist/db/client')

const content = `NEO AI Fleet — โมเดลและราคาที่ใช้จริงในระบบ

| Model | Provider | ประเภท | ราคา input | ราคา output | ใช้เมื่อ |
|---|---|---|---|---|---|
| Qwen 2.5 3B (Hermes) | Ollama local | local | $0 | $0 | ทุก task ทั่วไป (default) |
| Claude Sonnet 4.6 | Anthropic | api | $3/1M | $15/1M | code, strategy, planning |
| Claude Haiku 4.5 | Anthropic | api | $0.80/1M | $4/1M | structured tasks, extraction |
| GPT-4o | OpenAI | api | $2.50/1M | $10/1M | vision, multimodal |
| GPT Image-1 | OpenAI | image | $0.042/image | - | สร้างภาพ (OpenAI provider) |
| Gemini 2.5 Flash Image | Google | image | $0.02/image | - | สร้างภาพ (default) |
| Gemini 1.5 Flash | Google | api | $0.075/1M | $0.30/1M | long doc, multimodal |
| DeepSeek V3 | DeepSeek | api | $0.27/1M | $1.10/1M | math, logic, cron jobs |
| Google Cloud TTS | Google | tts | $4/1M chars | - | Thai voice (Neural2, Wavenet) |
| ElevenLabs TTS | ElevenLabs | tts | $0.18/1K chars | - | English voice (multilingual) |

Auto-route rules:
- Hermes ก่อนเสมอ — local, free, เร็ว
- @claude / @gpt / @gemini / @deepseek = force route ไปโมเดลนั้น
- image request → Gemini Imagen (default) หรือ GPT Image-1 (เลือกผ่าน UI)
- cost tracking: ทุก AI call บันทึกลง neo_ai_calls, สรุปรายวันใน neo_costs_daily`

async function main() {
  // Remove old fleet memory if exists
  await db.query(`DELETE FROM neo_memories WHERE source = 'system-seed' AND tags @> ARRAY['ai-fleet']`)

  await db.query(
    `INSERT INTO neo_memories (scope, category, content, source, importance, tags)
     VALUES ('global', 'fact', $1, 'system-seed', 10, $2)`,
    [content, ['ai-fleet', 'pricing', 'models', 'neo-system']]
  )
  console.log('✅ AI Fleet memory saved')
  process.exit(0)
}

main().catch(e => { console.error(e.message); process.exit(1) })
