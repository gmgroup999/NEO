CREATE TABLE IF NOT EXISTS neo_cron_logs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name    TEXT        NOT NULL,
  status      TEXT        NOT NULL CHECK (status IN ('success', 'error', 'skipped')),
  message     TEXT,
  details     JSONB,
  ran_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cron_logs_ran_at  ON neo_cron_logs (ran_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_logs_job     ON neo_cron_logs (job_name);
