# NestJS App Feature Takeover Spec

## Purpose

This document defines the end-to-end takeover contract for `examples/nestjs-app`.

It answers:

- what exists today
- which runtime owns each feature
- which features stay demo-only
- which features must be proven through standalone Management Center
- what exact workflow counts as takeover-complete

This is a takeover spec, not a roadmap and not a marketing overview.

---

## Binding decisions

These decisions are part of the takeover and are not optional:

1. **Jobs are mandatory takeover scope.**
2. **Alert triggering is mandatory takeover scope.**
3. **The only full takeover acceptance workflow is the exact command set defined in `Exact acceptance workflow`.**
   Shorthand name: `stress + mc + stream`.

4. **`bun run stream` is the real external job-input path.**
   Jobs are not considered takeover-complete unless real external input crosses NATS/Blitz and becomes observable in standalone MC.
5. **No standalone MC claim may depend on hidden in-process example state.**
6. **No mock jobs, mock alerts, stub endpoints, or deferred proof placeholders are allowed in the final takeover path.**

---

## Non-goals

This document does not:

- treat example service code as a platform contract unless explicitly promoted
- require every demo in `bun run start` to become part of standalone takeover
- claim persisted per-map/per-queue/per-topic history unless it really exists
- define release or publishing workflow

---

## Verified current state

### Runtime matrix as implemented today

| Command | Processes | Topology today | Includes today | Excludes today | Actual purpose today |
|---|---:|---|---|---|---|
| `bun run start` | 1 | single Helios member | Helios member, REST/monitor, embedded MC, embedded Blitz/NATS, demo services | stress cluster topology | all-in-one local demo |
| `bun run stress` | 4 | 3 monitored members + 1 non-monitored workload client | clustered Helios, maps/queues/topics/executor stress, REST/monitor on monitored members | Blitz/NATS, Binance, embedded MC | standalone-compatible cluster stress |
| `bun run mc` | 1 | standalone MC | standalone MC seeded from `127.0.0.1:18081`, auto-discovery enabled | Helios member runtime, Blitz runtime, stress harness | out-of-process monitoring/admin |
| `bun run stream` | 1 | external publisher | Binance WS -> NATS publish to `market.ticks` | Helios runtime, MC | external publisher for the embedded `start` path today |

### Critical current facts

1. **Embedded MC and standalone MC are the same product/package.**
2. **`bun run mc` currently targets the stress topology, not `bun run start`.**
3. **`bun run stress` currently does not start Blitz/NATS, quotes ingestion, or jobs.**
4. **`bun run stream` currently expects NATS on `nats://localhost:4222`, which is started by `bun run start`, not by `bun run stress`.**
5. **Standalone MC job polling is periodic, not event-driven.** A short-lived job can be missed unless the target implementation keeps the job active long enough to be captured.
6. **MC auto-discovery uses authoritative member-advertised REST endpoints and capability flags.** It must not guess monitor/admin targets when authoritative addresses are available.
7. **The stress client is a real cluster participant but intentionally not a monitor-capable member.** It must not appear as a degraded monitored node in MC.

---

## Ownership boundaries

### Helios core owns

- member lifecycle
- cluster formation and discovery
- distributed object lifecycle
- maps, queues, topics, executor services
- REST and monitor endpoints
- member capability advertisement
- metrics samples and transport stats
- partition and distributed-object inventory
- admin actions exposed through Helios member REST

### NestJS example owns

- demo orchestration
- example defaults
- stress harness scripts and process layout
- optional dependency wiring for demo modules
- Binance example connectors
- demo-only console output

### Blitz/NATS integration owns

- NATS connectivity and ingress
- pipeline and job execution semantics
- job lifecycle state
- job metadata surfaced through Helios REST bridge
- stream-processing behavior

### Management Center owns

- cluster connection management
- auth, users, sessions
- normalization of exported payloads
- persisted member metric history
- persisted job snapshots
- alert rules and alert history
- audit log
- realtime state distribution and UI
- admin UI and API over exported Helios admin endpoints

### Non-ownership rules

- The NestJS example does **not** define the standalone MC contract.
- MC does **not** define Helios runtime truth.
- Jobs are **not** Helios-owned truth; they are Blitz-owned truth exported through Helios member REST.
- Alerts, auth, and audit are MC-owned data, not Helios-owned data.

---

## Current feature classification

### Standalone-proven today in `stress + mc`

- monitor-capable member discovery and state
- member metrics ingestion and persisted member metric history
- maps visibility with live stats
- queues visibility with live stats
- topics visibility with live stats
- stress executor activity
- basic standalone admin actions against exported Helios endpoints

### Product-capable in MC but not proven end-to-end for this example today

- jobs UI and persisted job snapshots in standalone MC
- alert rule creation and firing against the NestJS example
- job cancel/restart from standalone MC against the NestJS example

### Embedded-only today

- Binance warm quotes path into `IMap('quotes')`
- Binance raw tick stream demo
- embedded NATS consumer path
- Blitz job `binance-market-rollups`
- embedded MC proof of jobs
- console dashboard

### Demo-only features that remain outside takeover acceptance unless explicitly promoted

- near-cache on `catalog`
- `@Cacheable` example flow
- predicate query demo
- Turso/libSQL MapStore demo
- MongoDB MapStore demo
- S3 MapStore demo
- DynamoDB/Alternator MapStore demo

---

## Current proof status matrix

| Feature | `start` | `start + stream + embedded MC` | `stress + mc` | `stress + mc + stream` today | Current status |
|---|---|---|---|---|---|
| members | limited single-member | limited single-member | yes | yes | standalone-proven today |
| member metrics/history | limited single-member | limited single-member | yes | yes | standalone-proven today |
| maps/queues/topics | limited single-member | limited single-member | yes | yes | standalone-proven today |
| executor stress | no | no | yes | yes | standalone-proven today |
| jobs in standalone MC | no | no | no | no | not proven today |
| alert triggering in standalone MC | no | no | no | no | not proven today |
| job cancel/restart in standalone MC | no | no | no | no | not proven today |

---

## Takeover target state

### Primary full acceptance workflow

```bash
bun run stress -- --duration 1800
MC_DATABASE_URL=file:data/takeover-mc.db \
MC_AUTH_BOOTSTRAP_ADMIN_EMAIL=takeover@helios.local \
MC_AUTH_BOOTSTRAP_ADMIN_PASSWORD=takeover-admin-1234 \
MC_AUTH_BOOTSTRAP_ADMIN_NAME="Takeover Admin" \
bun run mc
NATS_URL=nats://127.0.0.1:4222 bun run stream -- BTCUSDT ETHUSDT SOLUSDT
```

This three-process workflow is the only workflow that proves takeover-complete standalone operations.

### Secondary workflows

```bash
bun run stress
bun run mc
```

This remains the standalone monitoring/admin path **without** job proof.

```bash
bun run start
```

This remains the all-in-one demo path and is never an acceptance substitute for standalone takeover.

### Final target outcome

Standalone MC becomes the primary operator path for:

- members
- metrics/history
- maps
- queues
- topics
- jobs
- alerts
- admin actions

Every feature claimed for standalone takeover must be backed by a real exported remote contract from its owning runtime:

- **Helios** for member, cluster, object, and admin state
- **Blitz/NATS** for jobs
- **Management Center** for alerts, auth, sessions, audit, and persisted MC-owned records

---

## Required final target topology

This is the required final topology. It is **not** the current implementation.

The final takeover topology is:

| Component | TCP | REST/monitor | NATS | Required role |
|---|---:|---:|---:|---|
| stress member 1 | 15701 | 18081 | 4222 | monitor-capable, admin-capable, Blitz/NATS ingress, job host |
| stress member 2 | 15702 | 18082 | none required | monitor-capable, admin-capable |
| stress member 3 | 15703 | 18083 | none required | monitor-capable, admin-capable |
| stress client | 15710 | none | none | non-monitored workload driver |
| standalone MC | n/a | 9090 | n/a | standalone operator plane |

### Mandatory final runtime requirements

1. `bun run stress` must start stress member 1 as the **monitor-capable** job host that also runs the real Blitz/NATS job runtime.
2. The stress topology must expose a real NATS ingress at `nats://127.0.0.1:4222` for `bun run stream`.
3. The stress topology must register `quote-rollups` on the clustered Helios runtime and keep job output visible through exported map stats.
4. The stress topology must expose `/helios/monitor/jobs` from monitored stress member 1.
5. The job used for takeover proof must stay active while `bun run stream` is publishing, so standalone MC captures it through polling.
6. The stress topology must not rely on embedded MC or in-process-only helpers for jobs, alerts, or admin proofs.

---

## Exported runtime contract required for standalone MC

Standalone MC must consume exported remote contracts only.

### 1. Live cluster and object ingest

**Endpoint:** `GET /helios/monitor/stream`

Required semantics:

- initial full payload event
- ongoing sample events
- ongoing payload refresh events

Required exported data:

- cluster name and cluster state
- cluster size
- `members[].address`
- `members[].restPort`
- `members[].restAddress`
- `members[].monitorCapable`
- `members[].adminCapable`
- distributed object inventory
- `mapStats`
- `queueStats`
- `topicStats`
- `blitz`

### 2. One-shot payload fetch

**Endpoint:** `GET /helios/monitor/data`

Required for bootstrap, backfill, and direct verification of:

- members
- partitions
- distributed objects
- map stats
- queue stats
- topic stats
- latest Blitz block

### 3. Job export

**Endpoint:** `GET /helios/monitor/jobs`

Required fields:

- `jobs[].id`
- `jobs[].name`
- `jobs[].status`
- `jobs[].submittedAt`
- `jobs[].lightJob`
- `jobs[].supportsCancel`
- `jobs[].supportsRestart`
- `jobs[].participatingMembers`
- `jobs[].vertices`
- `jobs[].edges`
- `jobs[].metrics`

### 4. Configuration and capability export

**Endpoint:** `GET /helios/monitor/config`

Required fields:

- `nodeState`
- `capabilities.monitoring`
- `capabilities.admin`
- `capabilities.jobs`
- `memberVersion`
- `partitionCount`

### 5. Health export

**Endpoints:**

- `GET /hazelcast/health`
- `GET /hazelcast/health/node-state`
- `GET /hazelcast/health/cluster-safe`

Required use:

- post-admin verification
- operator corroboration of node state and cluster safety

### 6. Admin export

**Endpoints:**

- `POST /helios/admin/cluster-state`
- `POST /helios/admin/object/map/:name/clear`
- `POST /helios/admin/object/map/:name/evict`
- `POST /helios/admin/job/:id/cancel`
- `POST /helios/admin/job/:id/restart`
- `POST /helios/admin/gc`

---

## Normalization and persistence discipline

### Operator truths that must be preserved

Standalone MC must preserve these operator-relevant truths without guessing or silent loss:

- authoritative member REST address
- monitor/admin capability flags
- latest member sample as `latestSample`
- Blitz presence and Blitz job counters in member samples
- live map/queue/topic stats
- cluster state
- node state
- cluster safety

### Required source mapping

| Operator truth | Required source |
|---|---|
| member REST address and capability flags | `/helios/monitor/data` or `/helios/monitor/stream` payload |
| latest member sample | MC materialized `latestSample` from monitor stream |
| node state | `/helios/monitor/config` or health endpoint |
| cluster safety | member sample or `/hazelcast/health/cluster-safe` |
| jobs capability | `/helios/monitor/config.capabilities.jobs` |

### Historical truth

The spec claims durable history only for:

- member metrics/history
- job snapshots/history
- alert history
- audit log
- MC system events

The spec explicitly treats these as **live-only** until a real persistence path exists:

- map stats
- queue stats
- topic stats
- distributed object inventory

No takeover text may claim persisted per-map, per-queue, or per-topic history unless that persistence is actually implemented.

---

## Required standalone data flows

### 1. Cluster monitoring path

```text
stress client + monitored stress members
  -> Helios metrics samples + object stats
  -> /helios/monitor/stream and /helios/monitor/data
  -> standalone MC connector
  -> MC persistence + realtime + UI
```

### 2. Required standalone jobs path

```text
bun run stream
  -> Binance WS
  -> NATS subject market.ticks on stress member 1
  -> Blitz NatsSource job on monitored stress member
  -> IMap('quote-rollups')
  -> /helios/monitor/jobs + member blitz metrics
  -> standalone MC jobs UI and job snapshots
```

### 3. Required standalone alerts path

```text
monitored stress member samples
  -> MC AlertEngine rule evaluation on supported MetricPath values
  -> alert_history persistence
  -> standalone MC alerts UI
```

### 4. Standalone admin path

```text
MC UI or MC admin API
  -> MC admin backend
  -> exported Helios admin endpoint
  -> runtime state change
  -> refreshed monitor/config/health data
  -> standalone MC confirmation
```

---

## Required implementation deltas

The takeover is not complete until these deltas exist in the real runtime. None of the deltas in this section are fully implemented today.

### Delta 1 — stress topology must host the real job path

`bun run stress` must be extended so the final stress topology includes:

- a real Blitz/NATS ingress on monitor-capable member 1
- the real `market.ticks` subject
- the real `binance-market-rollups` job
- the real `quote-rollups` distributed map

The final stress topology must not fake job snapshots and must not proxy embedded `start` state.

### Delta 2 — `bun run stream` must target the stress topology

`bun run stream` must publish to the stress NATS ingress, not to an embedded-only runtime.

Final takeover expectation:

```bash
NATS_URL=nats://127.0.0.1:4222 bun run stream -- BTCUSDT ETHUSDT SOLUSDT
```

### Delta 3 — the job must be observable by standalone MC

The job used for takeover proof must remain active while stream traffic is flowing.

A short bootstrap batch job is insufficient because standalone MC polls job state periodically. The job must be visible long enough to produce:

- live job visibility in MC
- at least one persisted job snapshot
- a visible output map change in `quote-rollups`

### Delta 4 — alerts must be proven against supported metrics

The standalone alerts proof must use a metric already supported by the current alert engine.

The required rule is:

- clusterId: `stress` (the MC cluster id, not the Helios runtime clusterName)
- metric: `blitz.runningPipelines`
- operator: `>`
- threshold: `0`
- durationSec: `0`
- cooldownSec: `0`
- scope: `any_member`

This ties alert proof directly to the promoted standalone jobs path.

### Delta 5 — standalone-only proof discipline

No feature is takeover-complete if its only proof still depends on:

- embedded MC
- local console dashboard state
- in-process NestJS service helpers not exported remotely
- manually inferred member ports or capabilities

---

## Feature proof map

### Standalone takeover features

| Feature | Runtime(s) | Source of truth | Export path | MC consumer path | External deps | Failure mode | Acceptance proof |
|---|---|---|---|---|---|---|---|
| members | `stress + mc + stream` | Helios core | `/helios/monitor/stream`, `/helios/monitor/data` | connector -> cluster state -> UI | none beyond local processes | standalone MC cannot show full monitored topology | all 3 monitor-capable members visible in standalone MC; non-monitor client excluded |
| member metrics/history | `stress + mc + stream` | Helios samples + MC persistence | monitor stream | connector -> metrics repository -> UI/API | none beyond local processes | no live metrics or no persisted history | non-zero member metrics visible live and queryable as history |
| maps | `stress + mc + stream` | Helios core | monitor payload `mapStats` | cluster state -> UI | none for stress maps; Binance/NATS for `quote-rollups` updates | map list/stats missing or static | `stress-map`, `near-cache-map`, `hot-map`, `cold-map`, and `quote-rollups` visible with live stats |
| queues | `stress + mc + stream` | Helios core | monitor payload `queueStats` | cluster state -> UI | none beyond local processes | queue stats remain zero under load | queue stats visible and changing under load |
| topics | `stress + mc + stream` | Helios core | monitor payload `topicStats` | cluster state -> UI | none beyond local processes | topic stats remain zero under load | topic stats visible and changing under load |
| jobs | `stress + mc + stream` | Blitz/NATS runtime | `/helios/monitor/jobs`, member `blitz.*` metrics | jobs polling -> job snapshots -> UI | Binance internet + NATS ingress | no active job visible, no snapshot persisted, or no output map change | while `stream` is publishing, standalone MC shows the named active job and `quote-rollups` changes |
| alerts | `stress + mc + stream` | MC alert engine + MC persistence | MC API over exported member samples | alert engine -> alert history -> UI | none beyond cluster/job path already running | rule never fires or is not visible in MC | create the required `blitz.runningPipelines > 0` rule, observe fired alert in standalone MC, then acknowledge it |
| cluster state admin | `stress + mc + stream` | Helios core | `POST /helios/admin/cluster-state` | MC admin backend -> UI | none beyond local processes | state change not executed or not reflected | change cluster to `FROZEN`, verify in standalone MC, then return to `ACTIVE` |
| map clear/evict admin | `stress + mc + stream` | Helios core | `POST /helios/admin/object/map/:name/clear`, `.../evict` | MC admin backend -> UI | none beyond local processes | action fails or map stats do not react | clear `stress-map`, observe drop/reset then repopulation under load |
| job cancel/restart admin | `stress + mc + stream` | Blitz/NATS runtime through Helios admin REST | `POST /helios/admin/job/:id/cancel`, `.../restart` | MC admin backend -> UI | Binance internet + NATS ingress | action unsupported or job does not transition | cancel the active standalone job from MC, observe status change, restart it, observe active job return |

### Example-only or demo-only features retained outside takeover acceptance

| Feature | Runtime(s) | Owner | Status after takeover |
|---|---|---|---|
| near-cache on `catalog` | `start` | NestJS example | demo-only |
| `@Cacheable` example | `start` | NestJS example | demo-only |
| predicate queries | `start` | NestJS example | demo-only |
| Turso/libSQL MapStore demo | `start` | NestJS example | demo-only |
| MongoDB MapStore demo | `start` | NestJS example | optional demo-only |
| S3 MapStore demo | `start` | NestJS example | optional demo-only |
| DynamoDB/Alternator MapStore demo | `start` | NestJS example | optional demo-only |
| Binance direct WS quotes into `quotes` | `start` | NestJS example | demo-only until separately promoted |
| raw Binance tick stream | `start` | NestJS example | demo-only |
| embedded MC | `start` | Management Center package in embedded mode | demo-hosting mode only |
| console dashboard | `start` | NestJS example | demo-only |

---

## Exact acceptance workflow

Run all commands from `examples/nestjs-app`.

This is the final acceptance workflow after the implementation deltas above are complete.

### Terminal 1 — clustered runtime

```bash
bun run stress -- --duration 1800
```

Expected runtime state:

- 3 monitored stress members on REST `18081-18083`
- 1 non-monitored workload client
- non-zero map/queue/topic/executor activity
- member 1 exposes NATS ingress on `4222`
- monitored stress member 1 exposes `/helios/monitor/jobs`

### Terminal 2 — standalone MC with a fresh acceptance database

```bash
MC_DATABASE_URL=file:data/takeover-mc.db \
MC_AUTH_BOOTSTRAP_ADMIN_EMAIL=takeover@helios.local \
MC_AUTH_BOOTSTRAP_ADMIN_PASSWORD=takeover-admin-1234 \
MC_AUTH_BOOTSTRAP_ADMIN_NAME="Takeover Admin" \
bun run mc
```

Expected runtime state:

- standalone MC on `http://127.0.0.1:9090`
- a fresh bootstrap admin exists for this run
- the `stress` cluster auto-discovers all monitor-capable members

### Terminal 3 — real external job input

```bash
NATS_URL=nats://127.0.0.1:4222 bun run stream -- BTCUSDT ETHUSDT SOLUSDT
```

Expected runtime state:

- real Binance input is flowing
- `market.ticks` is receiving traffic
- the standalone stress job path is active

### Operator verification steps in standalone MC

1. **Log in** with:
   - email: `takeover@helios.local`
   - password: `takeover-admin-1234`
2. **Members**: verify exactly 3 monitor-capable members are connected.
3. **Metrics/history**: verify live member metrics are non-zero and history accumulates.
4. **Maps**: verify `stress-map`, `near-cache-map`, `hot-map`, `cold-map`, and `quote-rollups` are visible.
5. **Queues/topics**: verify queue/topic stats move under load.
6. **Jobs**: verify the active job named `binance-market-rollups` is visible while `stream` is publishing.
7. **Alerts**: create the required `clusterId=stress`, `blitz.runningPipelines > 0` rule, verify it fires, then acknowledge it and verify it remains visible in alert history.
8. **Admin / map**: clear `stress-map` from standalone MC and verify the map drops or resets and then repopulates under load.
9. **Admin / jobs**: cancel `binance-market-rollups` from standalone MC, verify status changes, restart it, and verify the active job returns.
10. **Admin / cluster**: change cluster state to `FROZEN`, verify it in standalone MC, then return it to `ACTIVE` and verify recovery.

---

## Acceptance criteria for takeover

### A. Command clarity

1. `start` is documented only as all-in-one demo mode.
2. `stress + mc` is documented only as standalone monitoring/admin without job proof.
3. `stress + mc + stream` is documented as the only full takeover acceptance path.

### B. Standalone MC completeness

Using:

```bash
bun run stress -- --duration 1800
MC_DATABASE_URL=file:data/takeover-mc.db \
MC_AUTH_BOOTSTRAP_ADMIN_EMAIL=takeover@helios.local \
MC_AUTH_BOOTSTRAP_ADMIN_PASSWORD=takeover-admin-1234 \
MC_AUTH_BOOTSTRAP_ADMIN_NAME="Takeover Admin" \
bun run mc
NATS_URL=nats://127.0.0.1:4222 bun run stream -- BTCUSDT ETHUSDT SOLUSDT
```

the operator must be able to verify in standalone MC:

1. all monitor-capable members are connected
2. non-zero live operations under load
3. maps are visible with real stats
4. queues are visible with real stats
5. topics are visible with real stats
6. the active job `binance-market-rollups` is visible while `stream` is publishing
7. `quote-rollups` changes while the job is active
8. the required alert rule fires, is acknowledged, and remains visible in standalone MC alert history
9. map clear works through exported admin endpoints
10. job cancel and restart work through exported admin endpoints
11. cluster state change to `FROZEN` and back to `ACTIVE` works through exported admin endpoints

### C. Contract discipline

1. No standalone MC feature depends on hidden example-only in-process state.
2. No member discovery depends on guessed ports when authoritative addresses are available.
3. Non-monitor members are excluded rather than treated as unhealthy monitored members.
4. Jobs are exported from the real Blitz/NATS runtime, not synthesized by MC.

### D. Documentation discipline

1. Every claimed feature has an exact proof path in this document.
2. Every feature marked standalone has a named source of truth and exported path.
3. No deferred placeholders, TODO rows, or follow-up artifacts remain.

### E. Embedded-versus-standalone rule

1. Embedded MC remains demo-hosting mode only.
2. Embedded MC is never an acceptance path for standalone takeover-complete claims.
3. Any feature that only works in embedded mode remains explicitly marked demo-only until promoted.

---

## External dependency and degraded-mode matrix

| Dependency | Used by | Required for bare boot? | Required for full takeover acceptance? | Expected degraded behavior |
|---|---|---:|---:|---|
| Binance internet access | `bun run stream` real job input | no | yes | standalone jobs proof unavailable |
| NATS/Blitz ingress on stress member 1 | standalone jobs path | no | yes | standalone jobs proof unavailable |
| MongoDB | Mongo MapStore demo | no | no | demo skipped gracefully |
| S3-compatible endpoint | S3 MapStore demo | no | no | demo skipped gracefully |
| Scylla/Alternator | DynamoDB MapStore demo | no | no | demo skipped gracefully |
| libSQL/Turso file or configured MC DB | standalone MC persistence | yes for local example path | yes | standalone MC cannot persist auth, metrics, jobs, alerts, or audit |

---

## Security and demo defaults that are not final design standards

The example currently uses convenient local defaults. They are not the production design:

- bootstrap admin credentials
- local file-backed MC database
- local public URLs and open local ports
- local CSRF secret defaults

The takeover only accepts these as local example boot defaults, not as production posture.

---

## Summary

The takeover is complete only when:

1. ownership boundaries are explicit,
2. standalone MC depends only on exported remote contracts,
3. `bun run stress + bun run mc + bun run stream` is the primary complete operator flow,
4. jobs and alerts are proven end to end in standalone MC,
5. embedded MC remains demo-only,
6. every standalone feature claim is backed by a commandable end-to-end proof path in this document.
