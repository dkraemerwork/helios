-- 003_jobs_and_topology.sql
-- Job snapshot tracking for Blitz compute engine pipelines.

-- ── Job Snapshots ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS job_snapshots (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  cluster_id            TEXT    NOT NULL,
  job_id                TEXT    NOT NULL,
  job_name              TEXT    NOT NULL,
  status                TEXT    NOT NULL,
  timestamp             INTEGER NOT NULL,
  execution_start_time  INTEGER,
  completion_time       INTEGER,
  light_job             INTEGER NOT NULL DEFAULT 0,
  supports_cancel       INTEGER NOT NULL DEFAULT 1,
  supports_restart      INTEGER NOT NULL DEFAULT 1,
  metrics_json          TEXT    NOT NULL DEFAULT '{}',
  vertices_json         TEXT    NOT NULL DEFAULT '[]',
  edges_json            TEXT    NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_job_snapshots_cluster_job_ts
  ON job_snapshots (cluster_id, job_id, timestamp);
