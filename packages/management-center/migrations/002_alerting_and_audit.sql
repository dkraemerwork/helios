-- 002_alerting_and_audit.sql
-- Audit logging, alert rules, alert history, and notification deliveries.

-- ── Audit Log ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id   TEXT,
  action_type     TEXT    NOT NULL,
  cluster_id      TEXT,
  target_type     TEXT,
  target_id       TEXT,
  request_id      TEXT,
  details_json    TEXT    NOT NULL DEFAULT '{}',
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor
  ON audit_log (actor_user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_audit_log_cluster
  ON audit_log (cluster_id, created_at);

CREATE INDEX IF NOT EXISTS idx_audit_log_action
  ON audit_log (action_type, created_at);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
  ON audit_log (created_at);

-- ── Alert Rules ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS alert_rules (
  id                   TEXT    PRIMARY KEY,
  cluster_id           TEXT    NOT NULL,
  name                 TEXT    NOT NULL,
  severity             TEXT    NOT NULL CHECK (severity IN ('warning', 'critical')),
  enabled              INTEGER NOT NULL DEFAULT 1,
  metric               TEXT    NOT NULL,
  operator             TEXT    NOT NULL CHECK (operator IN ('>', '>=', '<', '<=', '==')),
  threshold            REAL    NOT NULL,
  duration_sec         INTEGER NOT NULL,
  cooldown_sec         INTEGER NOT NULL,
  delta_mode           INTEGER NOT NULL DEFAULT 0,
  scope                TEXT    NOT NULL CHECK (scope IN ('any_member', 'all_members', 'cluster_aggregate')),
  staleness_window_ms  INTEGER NOT NULL DEFAULT 30000,
  runbook_url          TEXT,
  actions_json         TEXT    NOT NULL DEFAULT '[]',
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alert_rules_cluster
  ON alert_rules (cluster_id);

-- ── Alert History ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS alert_history (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id               TEXT,
  cluster_id            TEXT    NOT NULL,
  member_addr           TEXT,
  fired_at              INTEGER NOT NULL,
  resolved_at           INTEGER,
  severity              TEXT    NOT NULL CHECK (severity IN ('warning', 'critical')),
  message               TEXT    NOT NULL,
  metric_value          REAL    NOT NULL,
  threshold             REAL    NOT NULL,
  delivery_status_json  TEXT    NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_alert_history_cluster_fired
  ON alert_history (cluster_id, fired_at);

CREATE INDEX IF NOT EXISTS idx_alert_history_rule
  ON alert_history (rule_id, fired_at);

CREATE INDEX IF NOT EXISTS idx_alert_history_unresolved
  ON alert_history (cluster_id)
  WHERE resolved_at IS NULL;

-- ── Notification Deliveries ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_history_id  INTEGER NOT NULL REFERENCES alert_history (id) ON DELETE CASCADE,
  channel_type      TEXT    NOT NULL,
  destination       TEXT    NOT NULL,
  status            TEXT    NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'dead_letter', 'suppressed_rate_limit')),
  attempts          INTEGER NOT NULL DEFAULT 0,
  last_error        TEXT,
  next_attempt_at   INTEGER,
  sent_at           INTEGER,
  created_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_status
  ON notification_deliveries (status, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_dest_window
  ON notification_deliveries (destination, created_at);
