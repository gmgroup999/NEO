-- Dynamic cron jobs table
CREATE TABLE IF NOT EXISTS neo_cron_jobs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT        NOT NULL,
  description   TEXT,
  schedule      TEXT        NOT NULL,
  action_type   TEXT        NOT NULL,
  action_config JSONB       NOT NULL DEFAULT '{}',
  ai_model      TEXT        NOT NULL DEFAULT 'gemini',
  enabled       BOOLEAN     NOT NULL DEFAULT true,
  last_run_at   TIMESTAMPTZ,
  last_status   TEXT,
  last_message  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cron_jobs_enabled  ON neo_cron_jobs (enabled);
CREATE INDEX IF NOT EXISTS idx_cron_jobs_type     ON neo_cron_jobs (action_type);

-- Link logs to jobs
ALTER TABLE neo_cron_logs ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES neo_cron_jobs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_cron_logs_job_id ON neo_cron_logs (job_id);

-- Seed existing 3 hardcoded jobs into DB
INSERT INTO neo_cron_jobs (name, description, schedule, action_type, action_config, ai_model) VALUES
  (
    'Daily Cost Report',
    'สรุปค่าใช้จ่าย AI ประจำวัน ส่ง Telegram 06:00',
    '0 6 * * *',
    'daily_report',
    '{"reportType":"cost"}',
    'deepseek'
  ),
  (
    'Weekly Memory Cleanup',
    'ลบ memories เก่าที่ความสำคัญต่ำกว่า 4 และอายุเกิน 7 วัน',
    '0 2 * * 1',
    'memory_cleanup',
    '{"minImportance":3,"olderThanDays":7}',
    'none'
  ),
  (
    'Monthly Spend Alert',
    'แจ้งเตือนค่าใช้จ่ายรายเดือนเทียบกับ budget',
    '0 8 1 * *',
    'spend_alert',
    '{}',
    'deepseek'
  )
ON CONFLICT DO NOTHING;
