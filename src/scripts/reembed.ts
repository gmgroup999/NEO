import 'dotenv/config'
import { Pool } from 'pg'
import OpenAI from 'openai'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

async function generateEmbedding(text: string): Promise<number[]> {
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.slice(0, 8000),
  })
  return res.data[0].embedding
}

async function reembedAll() {
  const { rows } = await pool.query(
    `SELECT id, content FROM neo_memories ORDER BY created_at`
  )
  const total = rows.length
  console.log(`🔄 Re-embedding ${total} memories with OpenAI text-embedding-3-small...`)

  let updated = 0
  let failed = 0

  for (const row of rows) {
    try {
      const embedding = await generateEmbedding(row.content)
      await pool.query(
        `UPDATE neo_memories SET embedding = $1 WHERE id = $2`,
        [JSON.stringify(embedding), row.id]
      )
      updated++
      if (updated % 20 === 0 || updated === total) {
        console.log(`  ${updated}/${total} done`)
      }
      await new Promise(r => setTimeout(r, 50))
    } catch (err) {
      console.error(`  ❌ Failed id=${row.id}:`, (err as Error).message)
      failed++
    }
  }

  console.log(`\n✅ Re-embedded ${updated}/${total} memories (${failed} failed)`)
  await pool.end()
}

reembedAll().catch(err => {
  console.error('Fatal:', err)
  pool.end()
  process.exit(1)
})
