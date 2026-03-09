-- 004_auth_and_sessions.sql
-- User authentication, sessions, and password reset tokens.

-- ── Users ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id                TEXT    PRIMARY KEY,
  email             TEXT    NOT NULL UNIQUE,
  display_name      TEXT    NOT NULL,
  password_hash     TEXT    NOT NULL,
  status            TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  roles_json        TEXT    NOT NULL DEFAULT '["viewer"]',
  cluster_scopes_json TEXT  NOT NULL DEFAULT '[]',
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email
  ON users (email);

-- ── Sessions ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT    PRIMARY KEY,
  user_id       TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  refresh_hash  TEXT    NOT NULL,
  user_agent    TEXT,
  ip_address    TEXT,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  refreshed_at  INTEGER NOT NULL,
  revoked_at    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id
  ON sessions (user_id);

CREATE INDEX IF NOT EXISTS idx_sessions_expires_at
  ON sessions (expires_at);

-- ── Password Reset Tokens ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          TEXT    PRIMARY KEY,
  user_id     TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  TEXT    NOT NULL,
  expires_at  INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user
  ON password_reset_tokens (user_id);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash
  ON password_reset_tokens (token_hash);
