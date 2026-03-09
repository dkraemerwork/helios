-- 001_initial_schema.sql
-- Core tables for schema tracking, clusters, metrics, and system events.

-- ── Schema Migration Tracking ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL,
  checksum    TEXT    NOT NULL,
  applied_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_migrations_lock (
  lock_name   TEXT    PRIMARY KEY DEFAULT 'migration',
  owner_id    TEXT    NOT NULL,
  acquired_at INTEGER NOT NULL
);

-- ── Clusters ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS clusters (
  id            TEXT    PRIMARY KEY,
  display_name  TEXT    NOT NULL,
  config_json   TEXT    NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- ── Metric Samples (raw telemetry from cluster members) ─────────────────────

CREATE TABLE IF NOT EXISTS metric_samples (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  cluster_id              TEXT    NOT NULL,
  member_addr             TEXT    NOT NULL,
  timestamp               INTEGER NOT NULL,
  el_mean_ms              REAL,
  el_p50_ms               REAL,
  el_p99_ms               REAL,
  el_max_ms               REAL,
  heap_used               INTEGER,
  heap_total              INTEGER,
  rss                     INTEGER,
  cpu_percent             REAL,
  bytes_read              INTEGER,
  bytes_written           INTEGER,
  migration_completed     INTEGER,
  op_completed            INTEGER,
  inv_timeout_failures    INTEGER,
  inv_member_left_failures INTEGER,
  blitz_jobs_submitted    INTEGER,
  blitz_jobs_succeeded    INTEGER,
  blitz_jobs_failed       INTEGER
);

CREATE INDEX IF NOT EXISTS idx_metric_samples_cluster_member_ts
  ON metric_samples (cluster_id, member_addr, timestamp);

CREATE INDEX IF NOT EXISTS idx_metric_samples_ts
  ON metric_samples (timestamp);

-- ── Metric Aggregates (downsampled buckets) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS metric_aggregates (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  cluster_id                  TEXT    NOT NULL,
  member_addr                 TEXT    NOT NULL,
  resolution                  TEXT    NOT NULL,
  bucket_start                INTEGER NOT NULL,
  sample_count                INTEGER NOT NULL DEFAULT 0,
  cpu_percent_avg             REAL,
  cpu_percent_max             REAL,
  heap_used_avg               REAL,
  heap_used_max               REAL,
  el_p99_avg                  REAL,
  el_p99_max                  REAL,
  bytes_read_delta            INTEGER,
  bytes_written_delta         INTEGER,
  op_completed_delta          INTEGER,
  migration_completed_delta   INTEGER,
  inv_timeout_failures_delta  INTEGER,
  blitz_jobs_failed_delta     INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_metric_aggregates_unique
  ON metric_aggregates (cluster_id, member_addr, resolution, bucket_start);

CREATE INDEX IF NOT EXISTS idx_metric_aggregates_resolution_ts
  ON metric_aggregates (resolution, bucket_start);

-- ── System Events ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS system_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  cluster_id    TEXT    NOT NULL,
  member_addr   TEXT    NOT NULL,
  timestamp     INTEGER NOT NULL,
  event_type    TEXT    NOT NULL,
  message       TEXT    NOT NULL,
  details_json  TEXT
);

CREATE INDEX IF NOT EXISTS idx_system_events_cluster_ts
  ON system_events (cluster_id, timestamp);

CREATE INDEX IF NOT EXISTS idx_system_events_type
  ON system_events (event_type);

CREATE UNIQUE INDEX IF NOT EXISTS idx_system_events_dedup
  ON system_events (cluster_id, member_addr, timestamp, event_type, message);
