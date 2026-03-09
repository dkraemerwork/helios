# Helios Management Center - Production Plan

## 1. Product Contract

Build `packages/management-center` as a standalone Helios extension package that delivers complete cluster management through an Angular SSR application and a production backend in the same extension.

This plan is final-scope and end-to-end:

- no phased deferrals
- no stub handlers
- no placeholder notification channels
- no UI-only admin screens without working server behavior
- no Management Center logic added directly into Helios core business modules

Helios core may receive only generic extension hooks and missing monitoring/admin data providers required for the extension to operate.

The finished product provides:

- Angular SSR management UI with hydration and live updates
- multi-cluster monitoring and administration
- durable historical metrics in Turso/libSQL
- fully working auth, RBAC, sessions, audit logs, CSRF, rate limiting
- real alerting with email and webhook delivery
- working cluster admin actions
- pipeline/job monitoring with DAG topology
- production deployment, health, backup, and recovery guidance

## 2. Non-Negotiable Constraints

- Management Center lives in its own package: `packages/management-center`
- UI is Angular SSR, not a static SPA served behind a thin shell
- every documented feature must be implemented in the first release
- all backend endpoints described here are real and tested
- all frontend pages described here render in SSR, hydrate correctly, and work after navigation and refresh
- all persistence and notification paths have retry and failure handling
- all privileged actions are authenticated, authorized, audited, and CSRF-protected

## 3. Workspace Layout

```text
packages/management-center/
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── bunfig.toml
├── PLAN.md
├── migrations/
│   ├── 001_initial_schema.sql
│   ├── 002_alerting_and_audit.sql
│   ├── 003_jobs_and_topology.sql
│   └── 004_auth_and_sessions.sql
├── src/
│   ├── index.ts
│   ├── main.ts
│   ├── extension/
│   │   ├── ManagementCenterExtension.ts
│   │   ├── ManagementCenterExtensionConfig.ts
│   │   └── ExtensionRegistration.ts
│   ├── app/
│   │   ├── ManagementCenterModule.ts
│   │   ├── AppShutdown.ts
│   │   └── HealthController.ts
│   ├── config/
│   │   ├── ConfigModule.ts
│   │   ├── ConfigSchema.ts
│   │   └── ConfigService.ts
│   ├── auth/
│   │   ├── AuthModule.ts
│   │   ├── AuthController.ts
│   │   ├── SessionService.ts
│   │   ├── PasswordHasher.ts
│   │   ├── PasswordDenylistService.ts
│   │   ├── AuthMailTemplates.ts
│   │   ├── CsrfGuard.ts
│   │   ├── RbacGuard.ts
│   │   ├── WsTicketService.ts
│   │   └── AuditAuthListener.ts
│   ├── connector/
│   │   ├── ClusterConnectorModule.ts
│   │   ├── ClusterConnectorService.ts
│   │   ├── MemberSseClient.ts
│   │   ├── SseStreamParser.ts
│   │   ├── MemberRestClient.ts
│   │   ├── ClusterStateStore.ts
│   │   └── AggregationEngine.ts
│   ├── persistence/
│   │   ├── PersistenceModule.ts
│   │   ├── TursoConnectionFactory.ts
│   │   ├── MigrationRunner.ts
│   │   ├── AsyncSerialQueue.ts
│   │   ├── WriteBatcher.ts
│   │   ├── BackupScheduler.ts
│   │   ├── BackupUploader.ts
│   │   ├── MetricsRepository.ts
│   │   ├── AuthRepository.ts
│   │   ├── AuditRepository.ts
│   │   ├── DownsampleScheduler.ts
│   │   └── RetentionScheduler.ts
│   ├── alerts/
│   │   ├── AlertsModule.ts
│   │   ├── AlertEngine.ts
│   │   ├── RuleEvaluator.ts
│   │   ├── MetricPathResolver.ts
│   │   ├── NotificationService.ts
│   │   ├── NotificationRateLimiter.ts
│   │   ├── EmailNotificationChannel.ts
│   │   ├── WebhookNotificationChannel.ts
│   │   └── AlertTemplates.ts
│   ├── admin/
│   │   ├── AdminModule.ts
│   │   ├── AdminController.ts
│   │   ├── ClusterAdminService.ts
│   │   ├── JobAdminService.ts
│   │   └── ObjectAdminService.ts
│   ├── jobs/
│   │   ├── JobsModule.ts
│   │   ├── JobsService.ts
│   │   └── TopologySerializer.ts
│   ├── api/
│   │   ├── ClustersController.ts
│   │   ├── MetricsController.ts
│   │   ├── MembersController.ts
│   │   ├── DataStructuresController.ts
│   │   ├── AlertsController.ts
│   │   ├── EventsController.ts
│   │   ├── JobsController.ts
│   │   ├── AuditController.ts
│   │   └── ConfigController.ts
│   ├── realtime/
│   │   ├── RealtimeModule.ts
│   │   ├── DashboardGateway.ts
│   │   ├── HistoryQueryService.ts
│   │   ├── WsHeartbeatService.ts
│   │   └── WsProtocol.ts
│   ├── ssr/
│   │   ├── SsrModule.ts
│   │   ├── AngularSsrController.ts
│   │   ├── SsrStateService.ts
│   │   ├── CookieRequestContext.ts
│   │   ├── CspService.ts
│   │   └── SsrErrorRenderer.ts
│   └── shared/
│       ├── types.ts
│       ├── constants.ts
│       ├── time.ts
│       ├── formatters.ts
│       └── errors.ts
└── frontend/
    ├── package.json
    ├── angular.json
    ├── tsconfig.json
    ├── tsconfig.app.json
    ├── tsconfig.server.json
    ├── tailwind.config.ts
    ├── postcss.config.js
    └── src/
        ├── main.ts
        ├── main.server.ts
        ├── app/
        │   ├── app.component.ts
        │   ├── app.routes.ts
        │   ├── app.config.ts
        │   ├── app.config.server.ts
        │   ├── core/
        │   │   ├── store/
        │   │   │   └── cluster.store.ts
        │   │   ├── services/
        │   │   │   ├── api.service.ts
        │   │   │   ├── websocket.service.ts
        │   │   │   ├── auth.service.ts
        │   │   │   ├── csrf.service.ts
        │   │   │   └── ssr-state.service.ts
        │   │   ├── guards/
        │   │   │   ├── auth.guard.ts
        │   │   │   └── role.guard.ts
        │   │   └── interceptors/
        │   │       ├── auth.interceptor.ts
        │   │       └── csrf.interceptor.ts
│   ├── shell/
│   │   ├── app-shell.component.ts
│   │   ├── sidenav.component.ts
│   │   ├── header.component.ts
│   │   ├── breadcrumb.component.ts
│   │   └── cluster-switcher.component.ts
│   ├── pages/
│   │   ├── login/
│   │   ├── error/
│   │   ├── dashboard/
        │   │   ├── members/
        │   │   ├── data-structures/
        │   │   ├── jobs/
        │   │   ├── alerts/
        │   │   ├── events/
        │   │   ├── config/
        │   │   ├── admin/
        │   │   └── settings/
        │   ├── shared/
        │   └── theme/
        ├── assets/
        └── styles/
            └── global.css
```

## 4. Extension Model

`ManagementCenterExtension` is the only public entry point of the package.

Responsibilities:

- bootstrap the backend server
- start Angular SSR integration
- load config and migrations
- connect to configured clusters
- register health/readiness/liveness endpoints
- coordinate graceful shutdown

Helios core receives only generic extension support if not already present:

```ts
interface HeliosExtension {
  readonly id: string;
  start(context: ExtensionContext): Promise<void>;
  stop(): Promise<void>;
}

interface ExtensionContext {
  logger: Logger;
  env: Record<string, string | undefined>;
  metricsRegistry: MetricsRegistry;
}
```

Management Center does not place UI, auth, persistence, or admin business logic into Helios core modules.

## 5. Runtime Architecture

Single runtime, single public port, single extension package.

```text
Browser
  |
  +--> GET /login, /clusters/:id, /jobs/:jobId
  |        -> Angular SSR render
  |
  +--> REST /api/*
  |        -> Nest controllers
  |
  +--> WS /ws
           -> DashboardGateway

Management Center Extension
  |
  +--> Auth + RBAC + CSRF + Audit
  +--> ClusterConnectorService
  |      +--> fetch/SSE to Helios members
  |      +--> REST admin calls to Helios members
  +--> MetricsRepository + AuthRepository + AuditRepository
  +--> AlertEngine + NotificationService
  +--> Angular SSR engine + hydration state injection
```

Technology choices:

- backend runtime: Bun
- server framework: NestJS with Fastify adapter
- SSR: Angular 19+ using `@angular/ssr`
- persistence: Turso/libSQL via `@libsql/client`
- mail: `nodemailer`
- object storage: S3-compatible client via AWS SDK v3
- password hashing: `argon2`
- schema validation: `zod`
- charts: ECharts via `ngx-echarts`
- DAG layout: `elkjs`

## 6. Request and Rendering Flow

### 6.0 SSR Integration Contract

NestJS and Angular SSR are integrated explicitly, not implicitly.

Implementation requirements:

- `AngularSsrController` loads the Angular server bundle from `frontend/dist/server/main.server.mjs`
- rendering uses Angular `renderApplication()` from `@angular/ssr`
- per-request providers inject:
  - authenticated user/session context
  - request url and query params
  - `APP_BASE_HREF`
  - CSP nonce
  - transfer state payload from `SsrStateService`
- SSR render path must be able to read cookies and headers through `CookieRequestContext`
- Angular server config consumes transfer state and hydrates without duplicate initial fetches

Illustrative render path:

```ts
const html = await renderApplication(AppComponent, {
  appId: 'helios-mc',
  document: this.indexHtmlTemplate,
  url: request.url,
  platformProviders: [
    { provide: APP_BASE_HREF, useValue: '/' },
    { provide: REQUEST_CONTEXT, useValue: cookieRequestContext },
    { provide: SSR_TRANSFER_STATE, useValue: initialState },
    { provide: CSP_NONCE, useValue: nonce },
  ],
});
```

### 6.0.1 Browser Asset Serving

Browser assets are served directly by Fastify static asset middleware mounted inside `SsrModule`.

Requirements:

- serve `frontend/dist/browser`
- immutable cache headers for fingerprinted JS/CSS assets
- no-cache for `index`-style shell responses
- source maps disabled in production bundles
- Brotli and gzip enabled at reverse proxy or Fastify compression layer

Route ordering is explicit:

1. `/health/*`
2. `/api/*`
3. `/ws`
4. static browser assets from `frontend/dist/browser`
5. SSR controller catch-all for application routes

Hashed assets and lazy chunks are never passed to the SSR controller.

### 6.0.2 SSR Failure Handling

If Angular SSR render fails:

- request is logged with request id and route
- authenticated routes return HTTP 500 with a branded server-rendered error page
- login and public recovery routes return HTTP 500 with minimal retry guidance
- the browser shell fallback is not used as a silent downgrade mode
- SSR failure increments MC self-metrics and can trip self-alert rules

### 6.1 SSR Page Request

1. browser requests `/clusters/prod`
2. auth middleware validates secure session cookie
3. RBAC determines accessible clusters and actions
4. `SsrStateService` fetches current cluster snapshot from in-memory state and recent aggregates from Turso
5. Angular server app renders HTML with initial route data embedded in transfer state
6. browser hydrates
7. client opens WebSocket using short-lived WS ticket
8. store subscribes to live cluster stream without visual jump

### 6.2 Mutating Request

1. browser sends `POST /api/admin/cluster-state`
2. secure cookie authenticates session
3. CSRF token header validated
4. RBAC verifies `cluster.operator` or `cluster.admin`
5. admin service performs Helios member command
6. action result persisted to audit log
7. state change emitted via event bus and pushed to WebSocket subscribers
8. SSR pages later reflect the same persisted state on refresh

### 6.3 WebSocket Auth

WebSocket does not trust cookies alone.

Flow:

1. authenticated browser calls `POST /api/auth/ws-ticket`
2. server issues one-time, 30-second ticket bound to session id and user id
3. browser opens `/ws?ticket=...`
4. gateway validates ticket and consumes it once
5. gateway attaches user context and cluster entitlements

Session validity rules for WebSocket:

- gateway binds each socket to session id and user id
- `WsHeartbeatService` revalidates session state every heartbeat cycle
- logout, password reset, admin session revocation, or session expiry triggers immediate socket close for bound connections
- closed sockets must acquire a fresh WS ticket after HTTP session refresh

## 7. Configuration

```ts
interface ManagementCenterConfig {
  server: {
    host: string;                 // default 0.0.0.0
    port: number;                 // default 8080
    publicUrl: string;            // required in production
    trustProxy: boolean;
    secureCookies: boolean;
  };
  database: {
    url: string;                  // file:/data/mc.db or libsql://...
    authToken?: string;
    backupBucketUrl?: string;     // required when using file mode in prod
    backupBucketRegion?: string;
    backupAccessKeyId?: string;
    backupSecretAccessKey?: string;
    backupRoleArn?: string;
    backupEncryptionKey: string;
  };
  auth: {
    issuer: string;
    sessionTtlMinutes: number;    // default 30
    refreshTtlDays: number;       // default 7
    cookieDomain?: string;
    csrfSecret: string;
    bootstrapAdmin: {
      email: string;
      password: string;
      displayName: string;
    };
  };
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    username: string;
    password: string;
    from: string;
  };
  rateLimit: {
    authPerMinute: number;
    apiPerMinute: number;
    wsPerMinute: number;
  };
  retention: {
    rawSamplesHours: number;
    minuteAggregatesHours: number;
    fiveMinuteAggregatesDays: number;
    hourlyAggregatesDays: number;
    dailyAggregatesDays: number;
    eventDays: number;
    alertDays: number;
    auditDays: number;
    jobDays: number;
  };
  clusters: ClusterConfig[];      // bootstrap seeds only; database is runtime source of truth
}

interface ClusterConfig {
  id: string;
  displayName: string;
  memberAddresses: string[];      // REST addresses only, e.g. ["10.0.0.5:8080"]
  restPort: number;               // default REST port for auto-discovery
  sslEnabled: boolean;
  authToken?: string;
  autoDiscover: boolean;
  requestTimeoutMs: number;
  stalenessWindowMs: number;      // default 30000
}
```

Environment examples:

```bash
MC_SERVER_PUBLIC_URL=https://mc.example.com
MC_DATABASE_URL=libsql://helios-mc-prod.turso.io
MC_DATABASE_AUTH_TOKEN=...
MC_AUTH_BOOTSTRAP_ADMIN_EMAIL=ops@example.com
MC_AUTH_BOOTSTRAP_ADMIN_PASSWORD=...
MC_AUTH_CSRF_SECRET=...
MC_SMTP_HOST=smtp.example.com
MC_SMTP_PORT=465
MC_SMTP_SECURE=true
MC_SMTP_USERNAME=mc@example.com
MC_SMTP_PASSWORD=...
MC_SMTP_FROM="Helios Management Center <mc@example.com>"
MC_CLUSTERS='[{"id":"prod","displayName":"Production","memberAddresses":["10.0.0.11:8080"],"restPort":8080,"sslEnabled":false,"autoDiscover":true,"requestTimeoutMs":5000,"stalenessWindowMs":30000}]'
```

Cluster source of truth:

- `MC_CLUSTERS` is bootstrap input only
- on startup, bootstrap clusters are upserted into the `clusters` table if missing
- once persisted, the database is the runtime source of truth
- API CRUD operations update the database, not environment config
- bootstrap entries are not deleted automatically on later restarts if removed from env; operators must delete them explicitly through API or migration tooling

## 8. Security, Auth, and RBAC

### 8.1 Authentication

Use opaque server-side sessions plus refresh rotation, not localStorage JWTs.

- login sets `mc_session` and `mc_refresh` as `HttpOnly`, `Secure`, `SameSite=Lax` cookies
- session records stored in Turso
- refresh tokens are hashed at rest
- refresh rotates token and invalidates predecessor
- logout revokes current session and refresh chain
- idle timeout and absolute timeout both enforced

Self-service account recovery is included in the first release:

- `POST /api/auth/forgot-password` issues a time-limited reset token by email
- `POST /api/auth/reset-password` consumes the token once and rotates all active sessions for that user
- reset tokens are hashed in storage and expire after 15 minutes
- forgot-password endpoint is rate-limited and returns uniform responses to avoid account enumeration

### 8.2 User Model

```ts
interface User {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  status: 'active' | 'disabled';
  roles: Array<'viewer' | 'operator' | 'admin'>;
  clusterScopes: string[];  // ['*'] or specific cluster ids
  createdAt: number;
  updatedAt: number;
}
```

### 8.3 Authorization Rules

- `viewer`: read dashboards, metrics, events, alerts, config
- `operator`: viewer + acknowledge alerts + job control + object operations + cluster state operations except destructive user management
- `admin`: operator + user management + cluster registration + settings + credential rotation

### 8.4 Mandatory Security Controls

- `helmet` style headers via Fastify middleware
- strict CSP with nonce for SSR scripts
- CSRF required for every non-GET browser request
- rate limiting on auth, REST, and WebSocket handshake
- login attempt throttling per IP and per email
- audit log for login success/failure, user changes, admin actions, rule changes
- encrypted secrets only from env/secret store, never persisted in plaintext exports
- CORS disabled by default in production unless explicitly configured
- TLS termination required in production

Implementation requirements:

- `RateLimitMiddleware` enforces auth/API limits using sliding-window counters in memory with optional Turso spillover for audit
- `CspService` generates per-request nonce, attaches CSP header, and passes nonce into SSR render providers
- `PasswordDenylistService` loads the bundled breached-password index at startup and performs offline lookups during password set/reset
- CSRF token is session-bound and rotated on login, refresh, and password reset; frontend reads it from a non-HttpOnly cookie mirrored from server state and sends it in `X-CSRF-Token`

### 8.5 Session Hygiene

`SessionService` includes scheduled cleanup:

- every 15 minutes: delete expired sessions and consumed reset tokens
- every 24 hours: delete revoked sessions older than retention window
- every cleanup run emits self-metrics and audit summary counts

### 8.6 Session Policy

- multiple concurrent sessions per user are allowed up to 5 active sessions
- oldest active session is revoked when a 6th session is created
- `/settings` shows active sessions with device, IP, created-at, and last-seen
- users can revoke their own sessions except the current one only after reconfirmation
- admins can revoke any user session and the action is audited

### 8.7 Password Policy

- minimum 14 characters
- reject passwords matching email or display name fragments
- reject passwords found in bundled breached-password denylist
- require at least 1 letter and 1 number
- allow passphrases; no forced symbol rule
- password change and reset revoke all other active sessions

Breached-password denylist specification:

- ship a versioned local bundle generated from the top breached-password corpus during release build
- store as normalized SHA-1 prefix index plus suffix set for offline lookup
- no runtime external API dependency for password validation
- bundle updated on each release cut and version recorded in build metadata

## 9. Cluster Connectivity

### 9.1 Member SSE Client

Never use `EventSource` on the server.

Use `fetch()` plus `ReadableStream` and `AbortController`.

Requirements:

- custom `Authorization` header support
- comment/keepalive handling
- `event:` and multi-line `data:` parsing
- reconnect with capped exponential backoff
- no reconnect on HTTP 401/403 because that is configuration/auth failure, not transient transport failure
- graceful disconnect on shutdown

### 9.2 Auto-Discovery

`MemberPartitionInfo.address` contains TCP member address, not REST address.

Logic:

1. parse host from TCP address
2. build REST address with `ClusterConfig.restPort`
3. connect only to `host:restPort`
4. track `lastSeen` by discovered member
5. mark stale/disconnected after `stalenessWindowMs`

### 9.3 Member Failure Semantics

- 401: auth misconfiguration, stop retry, surface operator error
- 403: monitoring or REST disabled, stop retry, surface prerequisite error
- 404: unsupported member version or endpoint mismatch, stop retry, surface compatibility error
- 5xx or network error: retry with backoff

### 9.4 Connector Event Bus

Internal events:

- `member.connected`
- `member.disconnected`
- `sample.received`
- `payload.received`
- `jobs.received`
- `cluster.stateChanged`
- `admin.action.completed`
- `alert.fired`
- `alert.resolved`

## 10. Backend Modules

`ManagementCenterModule` imports:

- `EventEmitterModule.forRoot()`
- `ScheduleModule.forRoot()`
- `ConfigModule`
- `PersistenceModule`
- `AuthModule`
- `ClusterConnectorModule`
- `AlertsModule`
- `JobsModule`
- `AdminModule`
- `RealtimeModule`
- `SsrModule`

No static file module is used for HTML routing. Angular SSR is handled by server-side rendering controller and the browser bundle is served as built assets from the extension package.

## 11. Persistence Design

### 11.1 Database Principles

- all schema changes go through numbered migrations
- `schema_migrations` stores version, name, checksum, applied_at
- `PRAGMA foreign_keys = ON`
- `intMode: 'bigint'`
- all writes serialized through one async write queue
- WAL mode enabled for local file mode

Startup and migration behavior:

- migrations run automatically during boot before HTTP listener starts
- a database advisory lock row in `schema_migrations_lock` prevents concurrent migration execution
- if lock cannot be acquired, the instance waits up to 60 seconds and then exits with startup failure
- if database is unreachable at startup, the process does not enter degraded mode; it keeps retrying with backoff for up to 2 minutes, then exits non-zero
- readiness stays false until migrations complete and the database is writable
- if any migration fails, startup aborts immediately, the process exits non-zero, and the failed migration version is not marked applied
- each migration executes inside a transaction when supported by libSQL; partial schema writes are not accepted as successful boot

### 11.2 Core Tables

```sql
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);

CREATE TABLE schema_migrations_lock (
  lock_name TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  acquired_at INTEGER NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  roles_json TEXT NOT NULL,
  cluster_scopes_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  refresh_hash TEXT NOT NULL,
  user_agent TEXT,
  ip_address TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  refreshed_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id TEXT,
  action_type TEXT NOT NULL,
  cluster_id TEXT,
  target_type TEXT,
  target_id TEXT,
  request_id TEXT,
  details_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_audit_log_actor_time ON audit_log(actor_user_id, created_at DESC);
CREATE INDEX idx_audit_log_cluster_time ON audit_log(cluster_id, created_at DESC);

CREATE TABLE clusters (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  config_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE metric_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cluster_id TEXT NOT NULL,
  member_addr TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  el_mean_ms REAL,
  el_p50_ms REAL,
  el_p99_ms REAL,
  el_max_ms REAL,
  heap_used INTEGER,
  heap_total INTEGER,
  rss INTEGER,
  cpu_percent REAL,
  bytes_read INTEGER,
  bytes_written INTEGER,
  migration_completed INTEGER,
  op_completed INTEGER,
  inv_timeout_failures INTEGER,
  inv_member_left_failures INTEGER,
  blitz_jobs_submitted INTEGER,
  blitz_jobs_succeeded INTEGER,
  blitz_jobs_failed INTEGER,
  FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE
);

CREATE INDEX idx_metric_samples_cluster_time
  ON metric_samples(cluster_id, timestamp DESC);

CREATE INDEX idx_metric_samples_cluster_member_time
  ON metric_samples(cluster_id, member_addr, timestamp DESC);

CREATE TABLE metric_aggregates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cluster_id TEXT NOT NULL,
  member_addr TEXT NOT NULL,
  resolution TEXT NOT NULL,
  bucket_start INTEGER NOT NULL,
  sample_count INTEGER NOT NULL,
  cpu_percent_avg REAL,
  cpu_percent_max REAL,
  heap_used_avg INTEGER,
  heap_used_max INTEGER,
  el_p99_avg REAL,
  el_p99_max REAL,
  bytes_read_delta INTEGER,
  bytes_written_delta INTEGER,
  op_completed_delta INTEGER,
  migration_completed_delta INTEGER,
  inv_timeout_failures_delta INTEGER,
  blitz_jobs_failed_delta INTEGER,
  FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_metric_aggregates_bucket
  ON metric_aggregates(cluster_id, member_addr, resolution, bucket_start);

CREATE TABLE system_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cluster_id TEXT NOT NULL,
  member_addr TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  details_json TEXT,
  FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_system_events_dedup
  ON system_events(cluster_id, event_type, timestamp, message);

CREATE TABLE alert_rules (
  id TEXT PRIMARY KEY,
  cluster_id TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  severity TEXT NOT NULL,
  metric_path TEXT NOT NULL,
  operator TEXT NOT NULL,
  threshold REAL NOT NULL,
  duration_sec INTEGER NOT NULL,
  cooldown_sec INTEGER NOT NULL,
  delta_mode INTEGER NOT NULL DEFAULT 0,
  scope TEXT NOT NULL,
  staleness_window_ms INTEGER NOT NULL DEFAULT 30000,
  runbook_url TEXT,
  actions_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE
);

CREATE TABLE alert_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id TEXT,
  cluster_id TEXT NOT NULL,
  member_addr TEXT,
  fired_at INTEGER NOT NULL,
  resolved_at INTEGER,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  metric_value REAL NOT NULL,
  threshold REAL NOT NULL,
  delivery_status_json TEXT NOT NULL,
  FOREIGN KEY (rule_id) REFERENCES alert_rules(id) ON DELETE SET NULL,
  FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE
);

CREATE INDEX idx_alert_history_active
  ON alert_history(cluster_id, fired_at DESC) WHERE resolved_at IS NULL;

CREATE TABLE notification_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_history_id INTEGER NOT NULL,
  channel_type TEXT NOT NULL,
  destination TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  last_error TEXT,
  next_attempt_at INTEGER,
  sent_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (alert_history_id) REFERENCES alert_history(id) ON DELETE CASCADE
);

CREATE INDEX idx_notification_deliveries_destination_window
  ON notification_deliveries(destination, created_at DESC);

CREATE TABLE job_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cluster_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  job_name TEXT NOT NULL,
  status TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  execution_start_time INTEGER,
  completion_time INTEGER,
  metrics_json TEXT NOT NULL,
  vertices_json TEXT NOT NULL,
  edges_json TEXT NOT NULL,
  FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE
);
```

### 11.3 Write Path Safety

`WriteBatcher` requirements:

- buffer max 100 rows or 5 seconds
- retry with exponential backoff
- re-enqueue on failure
- clear timer and flush on shutdown
- no dropped writes on transient failure

`AsyncSerialQueue` requirements:

- every write transaction goes through one queue
- schedulers use the same queue
- prevents `SQLITE_BUSY`

### 11.4 Downsampling Rules

Gauges use avg/min/max.

Counters use delta (`MAX - MIN`), never avg.

Scheduler cadence:

- raw -> 1m aggregates runs every minute on the minute
- 1m -> 5m aggregates runs every 5 minutes on 5-minute boundaries
- 5m -> 1h aggregates runs every hour on the hour
- 1h -> 1d aggregates runs every day at 00:05 UTC
- retention cleanup runs every hour at minute 15
- scheduler uses last successful bucket watermark to avoid duplicate aggregate writes

Counter set includes:

- `bytes_read`
- `bytes_written`
- `migration_completed`
- `op_completed`
- `inv_timeout_failures`
- `inv_member_left_failures`
- `blitz_jobs_submitted`
- `blitz_jobs_succeeded`
- `blitz_jobs_failed`

## 12. Monitoring and Data Contracts

### 12.1 Existing Member Endpoints Used by MC

- `GET /helios/monitor/stream`
- `GET /helios/monitor/data`
- `GET /helios/monitor/jobs`
- `GET /helios/monitor/config`
- `GET /hazelcast/health`
- `GET /hazelcast/health/ready`
- `POST /helios/admin/cluster-state`
- `POST /helios/admin/job/:id/cancel`
- `POST /helios/admin/job/:id/restart`
- `POST /helios/admin/object/map/:name/clear`
- `POST /helios/admin/object/map/:name/evict`
- `POST /helios/admin/gc`

### 12.2 SSE Contract

```text
event: init
data: { MonitorPayload }

event: sample
data: { MetricsSample }

event: payload
data: { MonitorPayload }

: keepalive
```

The MC ignores `MonitorPayload.samples` on recurring `payload` events because live `sample` events already provide the stream. This avoids duplicating the ring buffer over the SSR/WebSocket path.

### 12.3 Serialization Fixes Required on Member Side

These are mandatory before release:

- `LocalQueueStats.toJSON()` returns a plain object
- `LocalTopicStats.toJSON()` returns a plain object
- `BlitzJobMetrics.toJSON()` converts `vertices: Map` with `Object.fromEntries`
- `VertexMetrics.toJSON()` converts `tags` and `userMetrics` maps with `Object.fromEntries`
- jobs endpoint includes `edges` from `PipelineDescriptor.edges`
- completed job metrics snapshot stored before executor cleanup
- standalone jobs from `BlitzService` merged with coordinator jobs

## 13. Alerting and Notifications

### 13.1 Alert Rule Model

```ts
type MetricPath =
  | 'cpu.percentUsed'
  | 'memory.heapUsed'
  | 'memory.heapTotal'
  | 'memory.heapUsedPercent'
  | 'memory.rss'
  | 'eventLoop.p99Ms'
  | 'eventLoop.maxMs'
  | 'transport.bytesRead'
  | 'transport.bytesWritten'
  | 'migration.migrationQueueSize'
  | 'migration.activeMigrations'
  | 'migration.completedMigrations'
  | 'operation.queueSize'
  | 'operation.completedCount'
  | 'invocation.pendingCount'
  | 'invocation.usedPercentage'
  | 'invocation.timeoutFailures'
  | 'invocation.memberLeftFailures'
  | 'blitz.runningPipelines'
  | 'blitz.jobCounters.submitted'
  | 'blitz.jobCounters.completedSuccessfully'
  | 'blitz.jobCounters.completedWithFailure';

interface AlertRule {
  id: string;
  clusterId: string;
  name: string;
  severity: 'warning' | 'critical';
  enabled: boolean;
  metric: MetricPath;
  operator: '>' | '>=' | '<' | '<=' | '==';
  threshold: number;
  durationSec: number;
  cooldownSec: number;
  deltaMode: boolean;
  scope: 'any_member' | 'all_members' | 'cluster_aggregate';
  stalenessWindowMs: number;
  runbookUrl?: string;
  actions: AlertAction[];
}

type AlertAction =
  | { type: 'email'; to: string[]; subjectTemplate: string; bodyTemplate: string }
  | { type: 'webhook'; url: string; method: 'POST' | 'PUT'; headers?: Record<string, string>; bodyTemplate: string };
```

Template variables available to both email and webhook templates:

- `alert.id`
- `alert.name`
- `alert.severity`
- `alert.clusterId`
- `alert.memberAddr`
- `alert.metric`
- `alert.metricValue`
- `alert.threshold`
- `alert.operator`
- `alert.scope`
- `alert.firedAtIso`
- `alert.resolvedAtIso`
- `alert.message`
- `alert.runbookUrl`

### 13.2 Evaluator Rules

- `memory.heapUsedPercent` is computed by resolver, not embedded as raw metric
- `blitz.*` paths are null-safe and resolve to `0` when Blitz is absent
- `deltaMode` uses current minus last value to prevent perpetual firing on monotonic counters
- `all_members` ignores members stale beyond `stalenessWindowMs`

### 13.3 Engine Wiring

`AlertEngine` subscribes to:

- `sample.received`
- `cluster.stateChanged`

and emits:

- `alert.fired`
- `alert.resolved`

### 13.4 Notification Delivery

Email is fully implemented in the initial release.

Requirements:

- SMTP configuration required at startup validation time
- `nodemailer` transport verified during boot in production mode
- failed sends retried with exponential backoff
- delivery attempts persisted in `notification_deliveries`
- alert history stores per-channel delivery state
- duplicate sends avoided with alert history id plus destination uniqueness inside one firing cycle

Delivery safeguards:

- email timeout: 10 seconds per attempt
- webhook timeout: 5 seconds per attempt
- max delivery attempts: 5
- retry backoff: 1s, 5s, 30s, 2m, 10m
- terminal failures are marked `dead_letter` in `notification_deliveries`
- per-rule notification rate cap: max 20 deliveries per 5 minutes per destination
- global notification circuit breaker opens if downstream failure rate exceeds 80 percent over the last 50 attempts
- open circuit breaker suppresses further sends for 60 seconds and records suppression in audit log and delivery table
- webhook responses outside 2xx are treated as failures and persisted with body snippet up to safe limit
- after 60 seconds the breaker enters half-open mode and allows 5 probe deliveries
- breaker closes only if at least 4 of 5 probe deliveries succeed; otherwise it reopens for another 60 seconds

Durability rules:

- notification delivery uses persisted outbox semantics backed by `notification_deliveries`
- unsent or retryable rows with `next_attempt_at <= now` are resumed on startup
- only `sent` and `dead_letter` are terminal states
- worker claims deliveries transactionally to avoid duplicate sends after restart

Enforcement rules:

- `NotificationRateLimiter` checks `notification_deliveries` by destination and time window before send
- suppressed deliveries are written as `suppressed_rate_limit`
- SMTP reset-password emails use `AuthMailTemplates` and the same durable delivery path

### 13.5 Default Rules

- High CPU: `cpu.percentUsed > 80` for 5m
- Critical CPU: `cpu.percentUsed > 95` for 1m
- Memory Pressure: `memory.heapUsedPercent > 90` for 3m
- Critical Memory: `memory.heapUsedPercent > 95` for 1m
- Event Loop Warning: `eventLoop.p99Ms > 100` for 3m
- Event Loop Critical: `eventLoop.p99Ms > 500` for 30s
- Operation Backlog: `operation.queueSize > 1000` for 2m
- Invocation Saturation: `invocation.usedPercentage > 70` for 3m
- Migration Stuck: `migration.activeMigrations > 0` for 10m
- Pipeline Failure: `blitz.jobCounters.completedWithFailure > 0`, `deltaMode = true`

## 14. Admin Capabilities

Every screen must be backed by a real server action.

### 14.1 Cluster Operations

- set cluster state: `ACTIVE`, `PASSIVE`, `FROZEN`
- verify post-action state using health endpoints and updated payload
- disallow duplicate in-flight state transitions per cluster

### 14.2 Job Operations

- cancel job
- restart job
- suspend job if Helios exposes it, otherwise not shown in UI
- each action writes audit entry and emits live update

### 14.3 Data Structure Operations

- clear map
- evict map
- inspect map metadata and entry counts

### 14.4 System Operations

- trigger GC if enabled in runtime
- reject action gracefully if member does not support it

### 14.5 Audit Requirements

Audit log captures:

- actor user id
- cluster id
- target type/id
- request id
- before/after state where available
- outcome success/failure
- error message if failed

## 15. Public Management Center API

List endpoint pagination contract:

- default pagination mode: cursor-based for append-only history tables, offset-based for small admin lists
- history endpoints return `{ items, nextCursor }`
- admin lists return `{ items, page, pageSize, total }`
- maximum page size: 500 for history, 100 for admin lists
- requests above max are clamped and logged

### 15.1 Auth

- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `POST /api/auth/ws-ticket`

### 15.2 Cluster and Monitoring

- `GET /api/clusters`
- `POST /api/clusters`
- `PUT /api/clusters/:id`
- `DELETE /api/clusters/:id`
- `GET /api/clusters/:id/summary`
- `GET /api/clusters/:id/members`
- `GET /api/clusters/:id/events`
- `GET /api/clusters/:id/config`

### 15.3 Metrics and History

- `GET /api/metrics/history`
- `GET /api/maps/:name/history`
- `GET /api/queues/:name/history`
- `GET /api/topics/:name/history`
- `GET /api/jobs/:jobId/history`

### 15.4 Alerts

- `GET /api/alerts/rules`
- `POST /api/alerts/rules`
- `PUT /api/alerts/rules/:id`
- `DELETE /api/alerts/rules/:id`
- `GET /api/alerts/active`
- `GET /api/alerts/history`
- `POST /api/alerts/:id/acknowledge`

### 15.5 Users and Settings

- `GET /api/users`
- `POST /api/users`
- `PUT /api/users/:id`
- `POST /api/users/:id/reset-password`
- `PUT /api/settings/notifications`
- `PUT /api/settings/security`
- `POST /api/settings/test-smtp`
- `POST /api/settings/test-webhook`

### 15.6 Audit

- `GET /api/audit`
- `GET /api/audit/:id`

### 15.7 Admin

- `POST /api/admin/cluster-state`
- `POST /api/admin/jobs/:id/cancel`
- `POST /api/admin/jobs/:id/restart`
- `POST /api/admin/maps/:name/clear`
- `POST /api/admin/maps/:name/evict`
- `POST /api/admin/gc`

### 15.8 System

- `GET /api/system/self-metrics`

## 16. WebSocket Protocol

Client-to-server messages always use `event` and `data`.

```ts
type ClientMessage =
  | { event: 'subscribe'; data: { clusterId: string; scope?: 'all' | string } }
  | { event: 'unsubscribe'; data: { clusterId: string } }
  | { event: 'query:history'; data: { requestId: string; clusterId: string; memberAddr: string | null; from: number; to: number; maxPoints: number } };
```

`scope` semantics:

- `all` = subscribe to full cluster aggregate plus all member updates
- `<memberAddr>` = subscribe to one member stream plus cluster summary

Heartbeat semantics:

- server sends `ws:ping` every 20 seconds
- client replies with `ws:pong` within 10 seconds
- missing 2 consecutive heartbeats closes the connection and forces reconnect

`query:history` handling:

- `DashboardGateway` delegates history requests to `HistoryQueryService`
- `HistoryQueryService` validates RBAC and executes reads through `MetricsRepository`
- result is returned as `history:result` with the original `requestId`

Server-to-client messages:

- `cluster:update`
- `member:sample`
- `data:update`
- `jobs:update`
- `alert:fired`
- `alert:resolved`
- `history:result`
- `admin:result`

On subscribe, gateway immediately sends current aggregate state, latest member samples, latest payload data, jobs snapshot, and active alerts so the hydrated page is never blank.

## 17. Angular SSR Application

### 17.1 Rendering Rules

- every route listed below SSR-renders meaningful HTML for authenticated users
- login route SSR-renders unauthenticated shell
- protected routes redirect server-side when no valid session
- client hydration must preserve transfer state without duplicate fetch storms
- no browser-only APIs in server render path

### 17.2 Routes

- `/login`
- `/forgot-password`
- `/reset-password`
- `/clusters/:id`
- `/clusters/:id/members`
- `/clusters/:id/members/:address`
- `/clusters/:id/data/maps`
- `/clusters/:id/data/maps/:name`
- `/clusters/:id/data/queues`
- `/clusters/:id/data/topics`
- `/clusters/:id/jobs`
- `/clusters/:id/jobs/:jobId`
- `/clusters/:id/alerts`
- `/clusters/:id/events`
- `/clusters/:id/audit`
- `/clusters/:id/config`
- `/clusters/:id/admin`
- `/settings`
- `/users`

### 17.3 State Management

Use Angular signals.

Rules:

- never mutate `Map` in place inside signals
- always produce a new `Map` reference
- append streaming chart points incrementally
- cap in-memory per-member sample arrays

### 17.4 UI Requirements

- responsive desktop and tablet first, mobile functional for triage and approvals
- clear distinction between read-only and privileged actions
- visible live connection health by cluster and by member
- charts support short-range live mode and long-range historical mode
- admin action forms include confirmation and result feedback
- alerts page includes active, history, and rule editor
- settings page includes SMTP test, webhook test, and session security settings
- SSR failure route uses dedicated branded error page component under `frontend/src/app/pages/error/`

### 17.5 Shell Composition

- `AppShellComponent`: top-level authenticated layout used by all protected routes
- `SidenavComponent`: primary navigation with role-aware items
- `HeaderComponent`: cluster status, user menu, session controls, active alerts badge
- `BreadcrumbComponent`: SSR-safe route breadcrumbs
- `ClusterSwitcherComponent`: fast cross-cluster navigation without full reload

## 18. Frontend Data Flow

1. SSR fetches initial route data from in-process services
2. transfer state injects JSON payload into page
3. client hydrates
4. `AuthService` requests WS ticket
5. `WebSocketService` connects and subscribes
6. `ClusterStore` merges live updates with SSR baseline
7. charts use append/patch strategy, not full redraw on every sample

## 19. SSR and Asset Build

Frontend `package.json` must include:

- `@angular/core`
- `@angular/common`
- `@angular/router`
- `@angular/platform-browser`
- `@angular/platform-server`
- `@angular/ssr`
- `@angular/cli`
- `@angular-devkit/build-angular`
- `rxjs`
- `ngx-echarts`
- `echarts`
- `elkjs`
- `tailwindcss`

Build outputs:

- `frontend/dist/browser`
- `frontend/dist/server`

Backend SSR module loads the Angular server bundle from `frontend/dist/server` and serves browser assets from `frontend/dist/browser`.

## 20. Health, Operations, and Reliability

### 20.1 Health Endpoints

- `GET /health/live` -> process running
- `GET /health/ready` -> config valid, migrations applied, DB reachable, SSR bundle loaded
- `GET /health/startup` -> extension fully bootstrapped and at least initial cluster connect attempt performed

### 20.2 Graceful Shutdown

- stop accepting new HTTP and WS connections
- revoke new WS ticket issuance
- drain WebSocket sessions
- abort SSE readers
- flush write batcher
- finish queued DB writes
- close SMTP transport
- close Turso client

### 20.3 Backup and Recovery

Remote Turso:

- rely on Turso managed durability
- nightly schema export and metadata snapshot

File mode:

- daily compressed copy to object storage
- startup warns if file mode used in production without backup target
- `BackupScheduler` creates encrypted compressed snapshots and uploads them through `BackupUploader`
- upload target is S3-compatible object storage using the configured bucket URL and credentials
- backup success/failure is written to audit log and self-metrics
- backup uploader supports either static credentials or cloud runtime role-based auth via `backupRoleArn` / ambient workload identity
- snapshot encryption uses `database.backupEncryptionKey`, loaded from secret storage and rotated through admin settings with dual-read support for previous key during migration window

Recovery steps documented and tested:

1. restore database
2. start MC extension
3. rehydrate from live cluster state
4. resume writes and downsampling

### 20.4 Management Center Self-Observability

Management Center exposes its own internal metrics and status panel.

Required self-metrics:

- process CPU and memory
- active HTTP requests
- active WebSocket sessions
- connected member SSE streams per cluster
- reconnect attempts per member
- write batcher buffer depth
- async write queue depth
- notification attempts, failures, circuit breaker state
- SSR render duration and failures
- auth login failures and password reset requests

These metrics are available through:

- `GET /api/system/self-metrics`
- SSR settings page operational panel
- audit and alert rules for MC self-health

Built-in self-health alert rules:

- MC DB Unreachable: readiness false for 30s
- MC SSR Failures: more than 5 render failures in 5m
- MC Notification Circuit Open: circuit breaker open for 60s
- MC Write Queue Backlog: async write queue depth > 1000 for 2m
- MC Memory Pressure: process heap usage > 85 percent for 3m

Seeding and ownership rules:

- self-health rules are inserted by migration as built-in rules under reserved cluster id `__mc__`
- they run through the same `AlertEngine` and `NotificationService` as cluster rules
- built-in rules can be disabled but not deleted
- edits are limited to threshold, duration, cooldown, and actions

## 21. Deployment

### 21.1 Docker

Management Center ships one image containing:

- compiled backend
- Angular SSR server bundle
- Angular browser assets
- SQL migrations

### 21.2 Kubernetes

- one deployment
- one service
- one ingress
- secrets for DB/auth/SMTP
- readiness and liveness probes
- pod disruption budget

### 21.3 Horizontal Scaling

Initial release supports active-passive scale for simplicity and correctness.

Production mode options:

- preferred: one active replica with remote Turso
This release supports single-active deployment only. Multi-active deployment is explicitly unsupported behavior and must not be configured.

## 22. Mandatory Helios Core Work

These are generic capability additions or missing serializers required by the extension.

### 22.1 Generic Extension Support

Add generic extension bootstrapping to Helios if absent.

### 22.2 Monitoring/Admin Capability Completion

Required member-side work:

- ensure monitoring and REST can be enabled independently of Management Center package
- expose `/helios/monitor/jobs`
- expose `/helios/monitor/config`
- expose admin endpoints used by this plan
- expose consistent error codes for unsupported/admin-disabled/auth-failed actions

Minimum member compatibility:

- Management Center requires Helios members on the first release version that includes all capability items from sections 12.3 and 22.2
- compatibility is checked on first connect through `/helios/monitor/config` capability metadata
- incompatible members are shown as unsupported and excluded from admin actions

### 22.3 Serialization Corrections

- `LocalQueueStats.toJSON()`
- `LocalTopicStats.toJSON()`
- `BlitzJobMetrics.toJSON()`
- `VertexMetrics.toJSON()`

### 22.4 Job Visibility and History

- merge coordinator jobs and standalone jobs
- snapshot completed jobs before cleanup
- include topology edges in jobs output

## 23. Delivery Sequence

This is sequencing only, not scoping. Release is not complete until all steps are done.

1. generic extension host support and package bootstrap
2. SSR app skeleton and server integration
3. auth, sessions, CSRF, RBAC, audit
4. cluster connector and in-memory state
5. persistence, migrations, schedulers, retention
6. live WebSocket bridge and SSR hydration
7. alerts and notifications
8. jobs/DAG/history
9. admin actions and audit coverage
10. deployment, health, backup, recovery
11. full test matrix and release checklist

## 24. Testing Matrix

### 24.1 Unit

- SSE parser
- metric path resolver
- rule evaluator
- CSRF guard
- RBAC guard
- password hashing and session rotation
- notification template rendering

### 24.2 Integration

- login, refresh, logout
- SSR protected route render
- WS ticket issuance and consumption
- SSE ingest to DB write path
- alert fire and resolve lifecycle
- admin endpoint to member command to UI update
- migration runner and rollback-safe startup behavior

### 24.3 End-to-End

Use a real 3-member Helios cluster and real Management Center runtime.

Must cover:

- SSR login and redirect behavior
- cluster overview live updates
- member details history query
- rule creation, firing, email delivery, resolution
- job DAG rendering for running and completed jobs
- cluster state transition with audit log
- map clear action with confirmation and live result
- pod restart with DB recovery

## 25. Production Acceptance Criteria

Release is acceptable only when all are true:

- Angular SSR pages render correctly on first request and after refresh
- no management feature documented here is hidden behind future phase language
- login, refresh rotation, logout, RBAC, and CSRF all pass E2E tests
- alerts send working emails and webhooks with persisted delivery status
- admin actions succeed against real Helios members and appear in audit log
- `payload` handling does not duplicate sample ring buffers into frontend traffic
- no `EventSource` used server-side
- no WS `command` protocol remains; all client messages use `event` and `data`
- no dropped writes under transient DB errors
- no perpetual firing on monotonic counters
- queue/topic/job metrics serialize correctly end-to-end
- completed jobs remain visible historically after runtime cleanup
- readiness, liveness, and startup probes behave correctly

## 26. Explicitly Rejected Approaches

- static SPA without SSR
- browser-local JWT storage
- UI-only admin actions without server implementation
- email support documented but not implemented
- production guidance that depends on manual unexplained operator steps
- multi-active deployment claims without distributed coordination
- Management Center-specific business logic merged into Helios core libraries

## 27. Final Outcome

When this plan is executed, Helios ships a separate Management Center extension package that operators can deploy as a production service, serving an Angular SSR application and complete management backend for live monitoring, historical analytics, alerting, notifications, and cluster administration.
