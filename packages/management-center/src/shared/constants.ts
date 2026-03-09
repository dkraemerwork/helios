/**
 * Shared constants for the Helios Management Center.
 *
 * All magic strings, default values, and tuning parameters are centralised
 * here so they can be referenced consistently across modules.
 */

// ── Cookie & CSRF ───────────────────────────────────────────────────────────

export const SESSION_COOKIE = 'mc_session';
export const REFRESH_COOKIE = 'mc_refresh';
export const CSRF_COOKIE = 'mc_csrf';
export const CSRF_HEADER = 'x-csrf-token';

// ── Route Prefixes ──────────────────────────────────────────────────────────

export const WS_PATH = '/ws';
export const API_PREFIX = '/api';
export const HEALTH_PREFIX = '/health';

// ── Session Limits ──────────────────────────────────────────────────────────

export const MAX_SESSIONS_PER_USER = 5;
export const PASSWORD_MIN_LENGTH = 14;
export const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;

// ── WebSocket ───────────────────────────────────────────────────────────────

export const WS_TICKET_TTL_MS = 30 * 1000;
export const WS_HEARTBEAT_INTERVAL_MS = 20 * 1000;
export const WS_HEARTBEAT_TIMEOUT_MS = 10 * 1000;
export const WS_MAX_MISSED_HEARTBEATS = 2;

// ── Write Batcher ───────────────────────────────────────────────────────────

export const WRITE_BATCH_MAX_ROWS = 100;
export const WRITE_BATCH_MAX_WAIT_MS = 5000;

// ── Pagination ──────────────────────────────────────────────────────────────

export const MAX_HISTORY_PAGE_SIZE = 500;
export const MAX_ADMIN_PAGE_SIZE = 100;

// ── Notification & Circuit Breaker ──────────────────────────────────────────

export const NOTIFICATION_MAX_ATTEMPTS = 5;
export const NOTIFICATION_RETRY_BACKOFF_MS = [1000, 5000, 30000, 120000, 600000];
export const NOTIFICATION_EMAIL_TIMEOUT_MS = 10000;
export const NOTIFICATION_WEBHOOK_TIMEOUT_MS = 5000;
export const NOTIFICATION_RATE_LIMIT_MAX = 20;
export const NOTIFICATION_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;

export const CIRCUIT_BREAKER_THRESHOLD = 0.8;
export const CIRCUIT_BREAKER_SAMPLE_SIZE = 50;
export const CIRCUIT_BREAKER_OPEN_DURATION_MS = 60 * 1000;
export const CIRCUIT_BREAKER_PROBE_COUNT = 5;
export const CIRCUIT_BREAKER_PROBE_SUCCESS_THRESHOLD = 4;

// ── Internal Identifiers ────────────────────────────────────────────────────

export const MC_SELF_CLUSTER_ID = '__mc__';

// ── Database ────────────────────────────────────────────────────────────────

export const MIGRATION_LOCK_TIMEOUT_MS = 60 * 1000;
export const DB_CONNECT_RETRY_MAX_MS = 2 * 60 * 1000;

// ── Session Cleanup ─────────────────────────────────────────────────────────

export const SESSION_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
export const SESSION_REVOKED_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

// ── In-Memory Buffers ───────────────────────────────────────────────────────

export const MAX_SAMPLES_IN_MEMORY = 300;

// ── Counter Metrics (monotonically increasing values requiring delta calc) ──

export const COUNTER_METRICS = new Set([
  'bytes_read',
  'bytes_written',
  'migration_completed',
  'op_completed',
  'inv_timeout_failures',
  'inv_member_left_failures',
  'blitz_jobs_submitted',
  'blitz_jobs_succeeded',
  'blitz_jobs_failed',
]);
