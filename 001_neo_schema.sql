-- NEO Database Schema
-- Migration: 001_neo_schema.sql
-- Run on: PostgreSQL (self-hosted Hetzner)

-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────
-- JACK PROFILE
-- ─────────────────────────────────────────
CREATE TABLE neo_profile (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  -- 'identity' | 'preference' | 'style' | 'rule' | 'fact'
  confidence INTEGER DEFAULT 10, -- 1-10
  source TEXT DEFAULT 'manual', -- 'manual' | 'extracted' | 'seed'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- PROJECTS REGISTRY
-- ─────────────────────────────────────────
CREATE TABLE neo_projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id TEXT UNIQUE NOT NULL, -- 'joyride' | 'boonma' | 'sabaidee' etc.
  name TEXT NOT NULL,
  description TEXT,
  type TEXT, -- 'saas' | 'ecommerce' | 'platform' | 'ai' | 'content'
  status TEXT DEFAULT 'active', -- 'active' | 'build' | 'plan' | 'paused' | 'done'
  stack JSONB DEFAULT '[]', -- ["Vite", "React", "Supabase", ...]
  urls JSONB DEFAULT '{}', -- {"prod": "...", "staging": "...", "repo": "..."}
  golden_rules JSONB DEFAULT '[]', -- ["ห้ามใช้ Firebase", ...]
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- MEMORY BANK (หัวใจของ NEO)
-- ─────────────────────────────────────────
CREATE TABLE neo_memories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scope TEXT NOT NULL CHECK (scope IN ('jack', 'project', 'global')),
  category TEXT NOT NULL CHECK (category IN ('rule', 'decision', 'fact', 'preference', 'insight', 'context')),
  project_id TEXT REFERENCES neo_projects(project_id) ON DELETE SET NULL,
  -- null ถ้า scope = 'jack' หรือ 'global'
  content TEXT NOT NULL,
  embedding VECTOR(1536), -- pgvector สำหรับ semantic search
  importance INTEGER DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
  -- 1=trivial, 5=normal, 10=critical (golden rule)
  source TEXT DEFAULT 'extracted', -- 'manual' | 'extracted' | 'seed'
  source_session_id UUID, -- มาจาก session ไหน
  tags TEXT[] DEFAULT '{}',
  last_accessed TIMESTAMPTZ,
  access_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index สำหรับ vector search
CREATE INDEX neo_memories_embedding_idx
  ON neo_memories USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Index สำหรับ filter
CREATE INDEX neo_memories_scope_idx ON neo_memories(scope);
CREATE INDEX neo_memories_project_idx ON neo_memories(project_id);
CREATE INDEX neo_memories_importance_idx ON neo_memories(importance DESC);

-- ─────────────────────────────────────────
-- CONVERSATION SESSIONS
-- ─────────────────────────────────────────
CREATE TABLE neo_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel TEXT NOT NULL DEFAULT 'telegram', -- 'telegram' | 'vscode' | 'api'
  messages JSONB NOT NULL DEFAULT '[]',
  -- [{ role: 'user'|'assistant', content, model, timestamp }]
  summary TEXT, -- auto-generated summary ของ session
  projects_mentioned TEXT[] DEFAULT '{}',
  memories_used UUID[] DEFAULT '{}', -- memory IDs ที่ใช้ใน session นี้
  memories_created UUID[] DEFAULT '{}', -- memory IDs ที่สร้างใน session นี้
  total_cost DECIMAL(10, 6) DEFAULT 0, -- USD
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- AI CALL LOG
-- ─────────────────────────────────────────
CREATE TABLE neo_ai_calls (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID REFERENCES neo_sessions(id) ON DELETE SET NULL,
  model TEXT NOT NULL, -- 'hermes' | 'claude-sonnet' | 'gpt-4o' | 'gemini' | 'deepseek'
  provider TEXT NOT NULL, -- 'local' | 'anthropic' | 'openai' | 'google' | 'deepseek'
  task_type TEXT, -- 'chat' | 'code' | 'translation' | 'analysis' | 'creative'
  routed_by TEXT DEFAULT 'auto', -- 'auto' | 'manual' (@mention)
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  cost_usd DECIMAL(10, 6) DEFAULT 0,
  latency_ms INTEGER,
  success BOOLEAN DEFAULT TRUE,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- COST TRACKING
-- ─────────────────────────────────────────
CREATE TABLE neo_costs_daily (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  model TEXT NOT NULL,
  call_count INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  total_cost_usd DECIMAL(10, 4) DEFAULT 0,
  UNIQUE(date, model)
);

-- ─────────────────────────────────────────
-- SEED DATA — Jack's Profile
-- ─────────────────────────────────────────
INSERT INTO neo_profile (key, value, category, source) VALUES
  ('name', 'Jack', 'identity', 'seed'),
  ('language', 'ภาษาไทย — สั้น ตรง copy-ready', 'style', 'seed'),
  ('mindset', 'MVP-first, AI-augmented not AI-replaced', 'identity', 'seed'),
  ('infrastructure', 'Hetzner + Coolify, self-host everything', 'fact', 'seed'),
  ('server', 'z-node.cc', 'fact', 'seed'),
  ('stack_preference', 'Vite/Next.js + TypeScript + Supabase + Tailwind', 'preference', 'seed'),
  ('ai_philosophy', 'Workflow before AI, Rules before AI, Hermes before Claude', 'rule', 'seed'),
  ('business_model', 'One-person business, multiple revenue streams', 'identity', 'seed'),
  ('ide', 'VSCode + Cursor', 'fact', 'seed'),
  ('timezone', 'Asia/Bangkok', 'fact', 'seed');

-- ─────────────────────────────────────────
-- SEED DATA — Projects
-- ─────────────────────────────────────────
INSERT INTO neo_projects (project_id, name, description, type, status, stack, golden_rules) VALUES
(
  'joyride',
  'JoyRide',
  'LINE ride-hailing SaaS, multi-tenant, Korat node as proof-of-concept',
  'saas',
  'active',
  '["Vite", "React", "TypeScript", "Supabase", "Tailwind", "LINE LIFF"]',
  '["ห้าม rename/delete/drop schema", "ทุก table ต้องมี node_id สำหรับ multi-tenant RLS", "Realtime-first", "ห้ามใช้ Firebase — Supabase only", "EasySlip API auto-verify slip"]'
),
(
  'boonma',
  'บุญมากระดาษปริ้นหรีด',
  'Specialty funeral wreath printing paper, sells via FB/Shopee/Lazada/TikTok/9boonma9.com',
  'ecommerce',
  'active',
  '["Facebook", "Shopee", "Lazada", "TikTok", "LINE OA", "n8n"]',
  '["Auto-verify slip via OCR", "PromptPay QR auto-generate", "LINE OA + Messenger integration"]'
),
(
  'sabaidee',
  'sabaidee.cc',
  'Multi-tenant local district guide, Phimai first, trilingual TH/EN/ZH',
  'platform',
  'build',
  '["Vite", "React", "TypeScript", "Tailwind", "Supabase", "Leaflet.js", "CARTO"]',
  '["Trilingual support TH/EN/ZH required", "Mobile-first design", "Leaflet.markercluster for UX"]'
),
(
  'pawfect',
  'Pawfect Passport',
  'Digital pet health passport PWA, LINE LIFF auth',
  'saas',
  'plan',
  '["Next.js", "Supabase", "LINE LIFF", "Gemma 3", "Gemini Flash"]',
  '["Hermes for recurring features", "Claude Sonnet for premium PDF", "LINE LIFF auth only"]'
),
(
  'neo',
  'NEO',
  'Personal AI Brain — AI OS สำหรับ Jack, รวมทุก AI ไว้ในที่เดียว',
  'ai',
  'build',
  '["Node.js", "TypeScript", "PostgreSQL", "pgvector", "Ollama", "Telegram"]',
  '["Hermes ก่อนเสมอ", "ทุก AI call ผ่าน router", "Memory extractor ทำงาน background เท่านั้น"]'
);

-- ─────────────────────────────────────────
-- SEED DATA — Core Memories
-- ─────────────────────────────────────────
INSERT INTO neo_memories (scope, category, project_id, content, importance, source) VALUES
  ('jack', 'rule', NULL, 'Jack ชอบ response ภาษาไทย สั้น ตรง มี code พร้อม copy ไม่อธิบายยาว', 9, 'seed'),
  ('jack', 'preference', NULL, 'Jack ทำงานหลาย project พร้อมกัน ให้ระบุ project ก่อนเสมอเมื่อตอบ', 8, 'seed'),
  ('jack', 'rule', NULL, 'Self-host บน Hetzner เสมอ ไม่ใช้ managed service ที่แพงเกินไป', 9, 'seed'),
  ('jack', 'fact', NULL, 'Jack ใช้ Coolify เป็น PaaS layer บน Hetzner server z-node.cc', 10, 'seed'),
  ('jack', 'preference', NULL, 'Jack คิดเป็น ecosystem — ทุก product ต้อง scale, clone, automate ได้ตั้งแต่วันแรก', 9, 'seed'),
  ('jack', 'rule', NULL, 'Workflow before AI — ถ้า rule/logic ทำได้ ไม่ใช้ AI', 10, 'seed'),
  ('jack', 'preference', NULL, 'Jack แยก AI model ตาม complexity เพื่อ minimize token cost', 8, 'seed'),
  ('project', 'rule', 'joyride', 'JoyRide: ห้าม rename/delete/drop schema เด็ดขาด', 10, 'seed'),
  ('project', 'rule', 'joyride', 'JoyRide: ทุก table ต้องมี node_id — multi-tenant RLS', 10, 'seed'),
  ('project', 'fact', 'joyride', 'JoyRide Supabase ID: eogppdvqxszgvflkxpim', 10, 'seed'),
  ('project', 'fact', 'joyride', 'JoyRide admin: admin@korat01.com (superadmin)', 9, 'seed'),
  ('project', 'rule', 'boonma', 'boonma: EasySlip API verify slip อัตโนมัติ ไม่ให้ manual verify', 8, 'seed'),
  ('project', 'fact', 'sabaidee', 'sabaidee.cc เริ่มที่ Phimai district ก่อน แล้วขยาย', 8, 'seed'),
  ('global', 'rule', NULL, 'NEO: Hermes ก่อนเสมอ ถ้าทำได้ ไม่ใช้ Claude/GPT เพื่อประหยัด cost', 10, 'seed'),
  ('global', 'rule', NULL, 'NEO: ทุก AI call ต้องแสดง model + cost ให้ Jack เห็น', 9, 'seed');

-- ─────────────────────────────────────────
-- HELPER FUNCTIONS
-- ─────────────────────────────────────────

-- Semantic memory search
CREATE OR REPLACE FUNCTION search_memories(
  query_embedding VECTOR(1536),
  match_count INTEGER DEFAULT 10,
  filter_scope TEXT DEFAULT NULL,
  filter_project TEXT DEFAULT NULL,
  min_importance INTEGER DEFAULT 1
)
RETURNS TABLE (
  id UUID,
  scope TEXT,
  category TEXT,
  project_id TEXT,
  content TEXT,
  importance INTEGER,
  similarity FLOAT
)
LANGUAGE SQL
AS $$
  SELECT
    m.id,
    m.scope,
    m.category,
    m.project_id,
    m.content,
    m.importance,
    1 - (m.embedding <=> query_embedding) AS similarity
  FROM neo_memories m
  WHERE
    (filter_scope IS NULL OR m.scope = filter_scope)
    AND (filter_project IS NULL OR m.project_id = filter_project)
    AND m.importance >= min_importance
    AND m.embedding IS NOT NULL
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Update cost daily summary
CREATE OR REPLACE FUNCTION update_daily_cost()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO neo_costs_daily (date, model, call_count, total_tokens, total_cost_usd)
  VALUES (
    CURRENT_DATE,
    NEW.model,
    1,
    NEW.prompt_tokens + NEW.completion_tokens,
    NEW.cost_usd
  )
  ON CONFLICT (date, model) DO UPDATE SET
    call_count = neo_costs_daily.call_count + 1,
    total_tokens = neo_costs_daily.total_tokens + EXCLUDED.total_tokens,
    total_cost_usd = neo_costs_daily.total_cost_usd + EXCLUDED.total_cost_usd;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_update_daily_cost
  AFTER INSERT ON neo_ai_calls
  FOR EACH ROW EXECUTE FUNCTION update_daily_cost();
