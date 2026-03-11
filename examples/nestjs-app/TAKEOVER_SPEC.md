# NestJS App Takeover Spec

## Purpose

This document records the implemented standalone takeover contract for `examples/nestjs-app`.

It defines:

- which command flows are demo-only versus acceptance-worthy
- which runtime owns each exported truth
- which exact operator workflow proves standalone takeover
- which credentials and checks are used for acceptance

This is a current-state spec. It does not describe future work.

---

## Binding truths

1. `bun run start` is all-in-one demo mode only.
2. `bun run stress && bun run mc` is standalone monitoring/admin without full job proof.
3. `bun run stress && bun run mc && NATS_URL=nats://127.0.0.1:4222 bun run stream` is the only full takeover acceptance path.
4. Stress member 1 hosts the real Blitz/NATS job runtime on port `4222`.
5. `bun run stream` is the real external input path and full acceptance requires that input to cross NATS/Blitz and become visible in standalone MC.
6. Standalone MC proves jobs, alerts, and admin actions.
7. Embedded MC remains demo-only and is never an acceptance substitute.
8. Standalone MC may depend only on exported remote contracts, never hidden in-process example state.

---

## Command modes

| Command flow | Processes | Purpose | What it proves | What it does not prove |
|---|---:|---|---|---|
| `bun run start` | 1 | all-in-one local demo | single-member demo services, embedded MC, embedded Blitz/NATS, console dashboard | standalone takeover |
| `bun run stress` + `bun run mc` | 2 | standalone operator plane over the stress topology | members, metrics/history, maps, queues, topics, executor load, standalone admin actions | full external job proof |
| `bun run stress` + `bun run mc` + `NATS_URL=nats://127.0.0.1:4222 bun run stream` | 3 | full standalone acceptance | members, metrics/history, maps, queues, topics, jobs, alerts, admin actions | nothing else is required for takeover |

---

## Implemented topology

| Component | TCP | REST/monitor | NATS | Role |
|---|---:|---:|---:|---|
| stress member 1 | 15701 | 18081 | 4222 | monitor-capable, admin-capable, Blitz/NATS job host |
| stress member 2 | 15702 | 18082 | none | monitor-capable, admin-capable |
| stress member 3 | 15703 | 18083 | none | monitor-capable, admin-capable |
| stress client | 15710 | none | none | non-monitored workload driver |
| standalone MC | n/a | 9090 | n/a | standalone operator plane |

Important runtime facts:

- the stress client is a real cluster participant but is intentionally not monitor-capable
- `bun run mc` seeds the cluster from `127.0.0.1:18081` and auto-discovers the other monitored members
- `bun run stream` must target `nats://127.0.0.1:4222` for standalone acceptance
- the active job visible in MC is `binance-market-rollups`
- the job materializes output into `quote-rollups`

---

## Ownership boundaries

### Helios core owns

- member lifecycle and cluster formation
- distributed object lifecycle
- maps, queues, topics, and executor services
- REST and monitor endpoints
- member capability advertisement
- admin endpoints exposed by monitored members

### Blitz/NATS integration owns

- NATS connectivity and ingress
- job and pipeline execution
- job lifecycle state
- stream processing from `market.ticks`
- rollup materialization into `quote-rollups`

### Management Center owns

- cluster connections and normalization of exported payloads
- auth, users, and sessions
- persisted member metric history
- persisted job snapshots
- alert rules and alert history
- realtime operator state distribution and UI
- admin UI and API over exported Helios admin endpoints

### NestJS example owns

- demo orchestration
- the stress harness process layout
- example defaults and local bootstrap commands
- embedded demo wiring used by `bun run start`

Non-ownership rules:

- the example does not invent standalone MC truth
- MC does not invent Helios member truth
- jobs are Blitz-owned truth exported through Helios member REST and monitor surfaces
- alerts, auth, sessions, and audit are MC-owned data

---

## Exported contract used by standalone MC

Standalone MC consumes exported remote contracts only.

### Cluster and object ingest

- `GET /helios/monitor/stream`
- `GET /helios/monitor/data`

Required exported truths:

- cluster identity and cluster state
- member addresses and rest addresses
- monitor/admin capability flags
- distributed object inventory
- `mapStats`, `queueStats`, `topicStats`
- Blitz activity surfaced in member payloads

### Jobs

- `GET /helios/monitor/jobs`

Required exported truths:

- active job name `binance-market-rollups`
- live job status while `stream` is publishing
- enough visibility for standalone MC polling to capture the job

### Admin actions

- `POST /helios/admin/cluster-state`
- `POST /helios/admin/object/map/:name/clear`
- `POST /helios/admin/object/map/:name/evict`
- `POST /helios/admin/job/:id/cancel`
- `POST /helios/admin/job/:id/restart`
- `POST /helios/admin/gc`

MC must execute admin actions against those exported endpoints rather than any embedded helper.

---

## Standalone acceptance workflow

### Terminal 1 - stress topology

```bash
bun run stress -- --duration 1800
```

Expected runtime state:

- three monitored stress members are running
- stress member 1 exposes REST/monitor on `127.0.0.1:18081`
- stress member 1 hosts the real Blitz/NATS runtime on `nats://127.0.0.1:4222`
- the cluster workload is actively moving map, queue, topic, and executor stats

### Terminal 2 - standalone MC

```bash
MC_DATABASE_URL=file:data/takeover-mc.db \
MC_AUTH_BOOTSTRAP_ADMIN_EMAIL=takeover@helios.local \
MC_AUTH_BOOTSTRAP_ADMIN_PASSWORD=takeover-admin-1234 \
MC_AUTH_BOOTSTRAP_ADMIN_NAME="Takeover Admin" \
bun run mc
```

Expected runtime state:

- standalone MC is available at `http://127.0.0.1:9090`
- a fresh bootstrap admin exists for the run
- the `stress` cluster auto-discovers all three monitored members

### Terminal 3 - external job input

```bash
NATS_URL=nats://127.0.0.1:4222 bun run stream -- BTCUSDT ETHUSDT SOLUSDT
```

Expected runtime state:

- real Binance input is flowing into `market.ticks`
- the standalone Blitz job path is active on stress member 1
- `quote-rollups` is changing while the job is active

---

## Operator verification steps

1. Log in to standalone MC with email `takeover@helios.local` and password `takeover-admin-1234`.
2. Verify exactly 3 monitor-capable members are connected for cluster `stress`.
3. Verify live member metrics are non-zero and persisted history begins to accumulate.
4. Verify `stress-map`, `near-cache-map`, `hot-map`, `cold-map`, and `quote-rollups` are visible.
5. Verify queue and topic stats continue to move under load.
6. Verify the active job `binance-market-rollups` is visible while `stream` is publishing.
7. Create the alert rule `clusterId=stress` with metric `blitz.runningPipelines > 0`, verify it fires, then acknowledge it and verify it remains in alert history.
8. Clear `stress-map` from standalone MC and verify the map drops or resets and then repopulates under load.
9. Cancel `binance-market-rollups` from standalone MC, verify status changes, restart it, and verify the active job returns.
10. Change cluster state to `FROZEN`, verify the state change in standalone MC, then return it to `ACTIVE` and verify recovery.

---

## Proof matrix

| Feature | `start` | `stress + mc` | `stress + mc + stream` | Source of truth |
|---|---|---|---|---|
| members | demo-only single member | yes | yes | Helios monitor payload |
| member metrics/history | demo-only single member | yes | yes | Helios monitor payload + MC persistence |
| maps/queues/topics | demo-only single member | yes | yes | Helios monitor payload |
| executor stress | no | yes | yes | Helios member metrics |
| jobs in standalone MC | no | no | yes | Blitz job data via `/helios/monitor/jobs` |
| alert triggering in standalone MC | no | no | yes | MC alert engine + MC persistence |
| job cancel/restart in standalone MC | no | no | yes | Helios admin REST over Blitz job host |
| embedded MC proof | demo-only | n/a | n/a | not an acceptance path |

---

## Acceptance criteria

Takeover is complete when the operator can run:

```bash
bun run stress -- --duration 1800
MC_DATABASE_URL=file:data/takeover-mc.db \
MC_AUTH_BOOTSTRAP_ADMIN_EMAIL=takeover@helios.local \
MC_AUTH_BOOTSTRAP_ADMIN_PASSWORD=takeover-admin-1234 \
MC_AUTH_BOOTSTRAP_ADMIN_NAME="Takeover Admin" \
bun run mc
NATS_URL=nats://127.0.0.1:4222 bun run stream -- BTCUSDT ETHUSDT SOLUSDT
```

and verify all of the following in standalone MC:

1. monitored members are connected and correctly discovered
2. live operations and history are non-zero
3. maps, queues, and topics show real stats
4. `binance-market-rollups` is visible while the streamer is active
5. `quote-rollups` changes while the job is active
6. the required alert rule fires, is acknowledged, and remains in history
7. map clear works through exported admin endpoints
8. job cancel and restart work through exported admin endpoints
9. cluster state changes to `FROZEN` and back to `ACTIVE` through exported admin endpoints

If any of those checks depend on embedded MC or hidden in-process state, the takeover is not complete.

---

## External dependencies

| Dependency | Used by | Required for full takeover acceptance? | Degraded behavior |
|---|---|---:|---|
| Binance internet access | `bun run stream` | yes | standalone jobs proof unavailable |
| NATS ingress on stress member 1 | Blitz job host | yes | standalone jobs proof unavailable |
| local MC database file | standalone MC persistence | yes | auth, history, jobs, and alerts cannot persist |
| MongoDB | Mongo MapStore demo | no | demo skips gracefully |
| S3-compatible endpoint | S3 MapStore demo | no | demo skips gracefully |
| Scylla/Alternator | DynamoDB MapStore demo | no | demo skips gracefully |

---

## Local-only defaults

These local defaults are accepted for the example takeover flow only:

- bootstrap admin credentials
- file-backed MC database
- local URLs and open local ports

They describe the local example flow, not production posture.
