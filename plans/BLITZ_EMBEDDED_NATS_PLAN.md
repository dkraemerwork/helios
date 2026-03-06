# Blitz Embedded NATS Plan

> **Purpose:** Design and implementation reference for embedding a NATS JetStream server
> natively inside `@zenystx/blitz` so that users never need to provision or manage an external
> NATS process. `BlitzService.start()` owns the full server lifecycle — binary resolution,
> spawn, health-poll, cluster formation, and shutdown — with zero user configuration required
> for single-node use and a concise options object for production cluster use.
>
> **Relates to:** `HELIOS_BLITZ_IMPLEMENTATION.md` (Issue 7 / Phase 10 test infrastructure),
> `TYPESCRIPT_PORT_PLAN.md` Block 10.0.

---

## Summary of Design Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | `BlitzService.start()` is a new static method, `connect()` is unchanged | Additive — zero breaking changes to existing API consumers |
| 2 | `nats-server` npm package promoted from `devDependency` → `dependency` | Must be available at runtime, not just test time |
| 3 | Binary resolution: npm package → PATH → explicit override → error | npm package covers 99% of installs; PATH fallback covers monorepos with a system install; explicit override handles air-gapped environments |
| 4 | `dataDir` omitted → in-memory JetStream (ephemeral) | Zero-config for tests and demos; persistent mode requires explicit opt-in |
| 5 | `dataDir` provided → file-based JetStream store on that path | Production-safe; survives restart |
| 6 | Cluster mode: N processes, subject-partitioned ports, `-routes` linking | Matches Hazelcast's own cluster topology; Raft leader election is automatic |
| 7 | `start()` internally calls `connect()` after spawning | Reuses all existing connection logic — one code path for the connection |
| 8 | `shutdown()` extended to kill embedded processes after `nc.drain()` | Drain first — ensure in-flight messages are delivered before server dies |
| 9 | All existing NATS-guarded integration tests lose their `skipIf` guard | After this plan, `bun test` runs all 26 previously skipped tests unconditionally |
| 10 | `NatsServerBinaryResolver` is a separate class, not inlined | Independently testable; easy to mock in unit tests |

---

## Issues Found & Fixed (Pre-Implementation Review)

| # | Issue | Fix |
|---|---|---|
| 1 | `nats-server` in `devDependencies` — not available at runtime for users | Promote to `dependencies` |
| 2 | No `BlitzService.start()` API — users must provision NATS externally | Add `start(config?)` static factory method |
| 3 | Test `beforeAll` blocks duplicate server-spawn logic across 4 test files | Centralize in `NatsServerManager`; tests call `BlitzService.start()` |
| 4 | `skipIf(!NATS_AVAILABLE)` guard means 26 tests never run without CI env var | After this plan, these tests run unconditionally via embedded server |
| 5 | No typed config for embedded server options | Add `EmbeddedNatsConfig` and `NatsClusterConfig` interfaces to `BlitzConfig.ts` |
| 6 | Binary resolution is implicit (`require.resolve`) with no fallback or error message | `NatsServerBinaryResolver` with ordered fallback chain and actionable error |
| 7 | Cluster port allocation is unspecified — naive multi-node spawning would conflict | `basePort + i` / `baseClusterPort + i` scheme; validated for overlap |
| 8 | `shutdown()` has no concept of child processes to kill | `NatsServerManager` reference stored on `BlitzService`; `shutdown()` extended |
| 9 | In-memory vs persistent JetStream selection is implicit | Explicit: `dataDir` absent → `-js` flag only (in-memory); `dataDir` present → `-js -sd <path>` |
| 10 | No test coverage for `NatsServerManager` in isolation | New `NatsServerManagerTest.test.ts` covers binary resolution, spawn, health-poll, shutdown |

## Issues Found & Fixed (Post-Implementation Review — Round 2)

Issues found after the pre-implementation review was incorporated. These are additional bugs
discovered during deeper analysis of the Block-level specs.

| # | Severity | Issue | Fix location |
|---|----------|-------|--------------|
| N6 | GAP | `NatsServerBinaryResolver` has no fallback when npm package is installed but platform binary is missing (e.g., npm post-install script failed) — resolver returns stale path, spawn fails with ENOENT at runtime | Block 1: add `fs.existsSync()` check after `require.resolve()`; fall through to PATH if file doesn't exist |
| N7 | BLOCKING | `NatsServerBinaryResolver` hardcodes `require.resolve()` cluster port range without validating overlap between client ports and cluster ports — `basePort=6222` + `baseClusterPort=6222` gives EADDRINUSE on node 0 | Block 3: add port-overlap validation in `resolveBlitzConfig()` |
| N13 | BLOCKING | `_waitUntilReady` opens a NATS connection to probe server health but never closes it on the error path — every failed poll attempt leaks a half-open TCP connection; in Bun, unresolved promises from these connections produce unhandled rejection warnings that kill the test process | Block 2: add `finally { try { await nc.close() } catch {} }` inside the poll loop |
| N14 | BLOCKING | `NatsServerManager.spawn()` returns as soon as all nodes are TCP-connectable, but Raft leader election is still in progress — `BlitzService.start({ cluster: { nodes: 3 } })` returns before JetStream is operational; first `js.publish()` fails with "no JetStream context" | Block 4 / Block 2: after all nodes are connectable, poll JetStream availability on one node (`js.find()` or `jsm.info()`) before returning |
| N15 | CRITICAL | `NatsServerManager.shutdown()` calls `proc.kill()` which sends SIGTERM and returns synchronously — the process is still alive when the next test's `beforeAll` runs, causing EADDRINUSE on the same port | Block 2: make `shutdown()` `async` and `await proc.exited` after `proc.kill()`; callers must `await` it |
| N16 | WRONG | `require.resolve('nats-server/bin/nats-server')` uses CommonJS `require.resolve()` which throws `ReferenceError: require is not defined` in ESM modules (and in Bun when running `.ts` files with `"type": "module"`) | Block 1: replace with `import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);` OR use `Bun.resolveSync('nats-server/bin/nats-server', import.meta.dir)` |

---

## Architecture

### Three Modes, One API Surface

```
BlitzService.start()                    BlitzService.start({ cluster: { nodes: 3 } })
      │                                          │
      ▼                                          ▼
NatsServerManager.spawn(config)         NatsServerManager.spawnCluster(config)
  resolve binary                          resolve binary
  write temp config file                  write N config files (one per node)
  Bun.spawn(nats-server, [...args])       Bun.spawn(nats-server, [...]) × N
  health-poll until ready                 health-poll all N in parallel
      │                                          │
      ▼                                          ▼
BlitzService.connect({ servers: '...' })  BlitzService.connect({ servers: [...] })
  (existing code path, unchanged)          (existing code path, unchanged)
      │                                          │
      ▼                                          ▼
BlitzService { nc, js, jsm, kvm, _manager }    (same)
      │
      ▼
blitz.shutdown()
  await nc.drain()                        ← existing
  this._manager?.shutdown()               ← new: kills spawned processes
```

```
BlitzService.connect({ servers: 'nats://external:4222' })
  (unchanged — no NatsServerManager involved)
```

---

## File Map

```
packages/blitz/
├── package.json                              ← nats-server: devDep → dep
├── src/
│   ├── BlitzConfig.ts                        ← add EmbeddedNatsConfig + NatsClusterConfig
│   ├── BlitzService.ts                       ← add start(), extend shutdown()
│   └── server/                              ← NEW directory
│       ├── NatsServerBinaryResolver.ts       ← binary resolution chain
│       ├── NatsServerConfig.ts               ← internal typed config (ports, flags, dataDir)
│       └── NatsServerManager.ts             ← spawn + health-poll + shutdown
└── test/
    ├── BlitzServiceTest.test.ts              ← remove skipIf + beforeAll Bun.spawn boilerplate
    ├── PipelineTest.test.ts                  ← remove skipIf guard
    ├── SourceSinkTest.test.ts                ← remove skipIf guard
    ├── WindowingTest.test.ts                 ← remove skipIf guard
    └── server/                              ← NEW directory
        └── NatsServerManagerTest.test.ts    ← NEW test file
```

---

## Block 1 — `package.json` + `NatsServerBinaryResolver`

### `package.json` change

Move `nats-server` from `devDependencies` to `dependencies`:

```json
{
  "dependencies": {
    "@zenystx/core": "file:../..",
    "@nats-io/jetstream": "^3.3.1",
    "@nats-io/kv": "^3.3.1",
    "@nats-io/transport-node": "^3.3.1",
    "nats-server": "*"
  },
  "devDependencies": {
    "@nestjs/common": "^11.1.14",
    "@nestjs/core": "^11.1.14",
    "@nestjs/testing": "^11.1.14",
    "@types/bun": "latest",
    "@types/node": "^25.3.3",
    "typescript": "beta"
  }
}
```

### `src/server/NatsServerBinaryResolver.ts`

Resolution order (first found wins):

1. `config.binaryPath` — explicit user override (air-gapped environments)
2. `require.resolve('nats-server/bin/nats-server')` — npm package (standard install)
3. `which nats-server` via `Bun.which('nats-server')` — system PATH fallback

If none found, throw `NatsServerNotFoundError` with actionable install instructions.

```typescript
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';

// N16 FIX: `require.resolve()` is undefined in ESM context (Bun runs .ts files as
// ESM by default). Use `createRequire(import.meta.url)` to get a CJS-compatible
// resolver that works in both ESM and CJS contexts. Alternatively, use
// `Bun.resolveSync()` as a Bun-native fallback.
const _require = createRequire(import.meta.url);

export class NatsServerNotFoundError extends Error {
    constructor() {
        super(
            'nats-server binary not found. Install it with:\n' +
            '  bun add nats-server   (recommended — adds to package.json)\n' +
            '  brew install nats-server   (macOS system-wide)\n' +
            'Or set embedded.binaryPath in BlitzService.start() config.',
        );
        this.name = 'NatsServerNotFoundError';
    }
}

export class NatsServerBinaryResolver {
    static resolve(binaryPath?: string): string {
        if (binaryPath) return binaryPath;

        // 1. npm package (N16 FIX: use createRequire, not bare require.resolve)
        try {
            const resolved = _require.resolve('nats-server/bin/nats-server');
            // N6 FIX: npm post-install scripts can fail silently — the package.json
            // entry exists but the binary file doesn't. Verify the file actually
            // exists before returning it; if not, fall through to PATH.
            if (existsSync(resolved)) return resolved;
        } catch { /* package not installed */ }

        // 2. System PATH
        const fromPath = Bun.which('nats-server');
        if (fromPath) return fromPath;

        throw new NatsServerNotFoundError();
    }
}
```

**TODO — Block 1:**
- [ ] Move `nats-server` from `devDependencies` → `dependencies` in `package.json`
- [ ] Create `src/server/NatsServerBinaryResolver.ts` with:
  - N16 FIX: `createRequire(import.meta.url)` instead of bare `require.resolve()` (ESM-safe)
  - N6 FIX: `existsSync()` check after `require.resolve()` before returning the path
  - `NatsServerNotFoundError` with install instructions
- [ ] Create `test/server/NatsServerManagerTest.test.ts` — binary resolver tests:
  - `resolve_withExplicitPath_returnsIt` — explicit `binaryPath` returned unchanged
  - `resolve_withNpmPackage_returnsNpmBinaryPath` — resolved path contains `nats-server`
  - `resolve_withNpmPackageButMissingFile_fallsThroughToPath` — N6 test: package resolves but file doesn't exist; expect PATH fallback
  - `resolve_withNoBinary_throwsNatsServerNotFoundError` — error message contains install instructions

---

## Block 2 — `NatsServerConfig` + `NatsServerManager`

### `src/server/NatsServerConfig.ts`

Internal config shape produced by `resolveEmbeddedConfig()` — not exposed to users directly.

```typescript
export interface NatsServerNodeConfig {
    /** Resolved path to the nats-server binary. */
    readonly binaryPath: string;
    /** Client-facing port (default: 4222). */
    readonly port: number;
    /** Intra-cluster routing port (default: 6222). Only used in cluster mode. */
    readonly clusterPort: number;
    /** Directory for JetStream file store. Undefined → in-memory mode. */
    readonly dataDir: string | undefined;
    /** Server name (must be unique per node). */
    readonly serverName: string;
    /** Cluster name shared by all nodes. Only used in cluster mode. */
    readonly clusterName: string | undefined;
    /** `-routes` URLs for all other cluster nodes. Empty array → single-node. */
    readonly routes: string[];
    /** Extra args passed verbatim to nats-server. */
    readonly extraArgs: string[];
    /** How long to wait for the server to become reachable (ms). */
    readonly startTimeoutMs: number;
}
```

### `src/server/NatsServerManager.ts`

Owns the full lifecycle of one or more `nats-server` child processes.

```typescript
export class NatsServerManager {
    private readonly _processes: ReturnType<typeof Bun.spawn>[] = [];
    private readonly _clientUrls: string[];

    private constructor(clientUrls: string[]) {
        this._clientUrls = clientUrls;
    }

    /** URLs to pass to BlitzService.connect() after spawn. */
    get clientUrls(): string[] {
        return this._clientUrls;
    }

    /**
     * Spawn one or more nats-server processes, wait until all are healthy,
     * and — for cluster mode — wait until a Raft leader is elected and
     * JetStream is operational.
     *
     * N14 FIX: TCP-connectable does NOT mean JetStream is ready. In cluster mode,
     * Raft leader election happens AFTER all nodes are up and can take 1-3 seconds.
     * Until a leader is elected, `js.publish()` fails with "no JetStream context"
     * or "JetStream not enabled". After all nodes are TCP-connectable, this method
     * polls `jsm.info()` on node 0 until it succeeds (or times out).
     *
     * Single-node mode: JetStream is ready as soon as the server is connectable
     * (no Raft election needed), so the extra poll is skipped for configs.length === 1.
     *
     * @throws NatsServerNotFoundError if binary cannot be resolved.
     * @throws Error if servers do not become reachable within startTimeoutMs.
     * @throws Error if JetStream cluster does not elect a leader within startTimeoutMs.
     */
    static async spawn(configs: NatsServerNodeConfig[]): Promise<NatsServerManager> { ... }

    /**
     * Kill all managed nats-server processes and wait for them to exit.
     *
     * N15 FIX: This method MUST be async. `proc.kill()` sends SIGTERM but returns
     * immediately before the OS has reclaimed the port. Back-to-back tests that
     * call shutdown() + start() on the same port get EADDRINUSE because the previous
     * process is still alive when the new spawn attempt fires. `await proc.exited`
     * blocks until the kernel confirms the process has exited and the port is free.
     *
     * No-op if already shut down.
     */
    async shutdown(): Promise<void> { ... }

    /** Build the CLI args array for a single nats-server node. */
    private static _buildArgs(config: NatsServerNodeConfig): string[] { ... }

    /** Poll nats://127.0.0.1:{port} until TCP-connectable or timeout. */
    private static async _waitUntilReady(port: number, timeoutMs: number): Promise<void> { ... }

    /**
     * N14 FIX: Poll JetStream on the given port until `jsm.info()` succeeds
     * (indicating a Raft leader has been elected and JetStream is operational).
     * Only called for cluster configs (configs.length > 1).
     *
     * Implementation:
     * ```typescript
     * private static async _waitUntilJetStreamReady(port: number, timeoutMs: number): Promise<void> {
     *     const deadline = Date.now() + timeoutMs;
     *     while (Date.now() < deadline) {
     *         let nc: NatsConnection | null = null;
     *         try {
     *             nc = await connect({ servers: `nats://127.0.0.1:${port}`, timeout: 500 });
     *             const js = nc.jetstream();   // @nats-io/jetstream v3 API
     *             const jsm = await js.jetstreamManager();
     *             await jsm.info();            // throws if no leader yet
     *             return;                      // JetStream is operational
     *         } catch {
     *             await Bun.sleep(200);        // longer sleep — leader election takes time
     *         } finally {
     *             if (nc != null) { try { await nc.close(); } catch {} }
     *         }
     *     }
     *     throw new Error(
     *         `NATS JetStream cluster on port ${port} did not elect a leader within ${timeoutMs}ms`
     *     );
     * }
     * ```
     */
    private static async _waitUntilJetStreamReady(port: number, timeoutMs: number): Promise<void> { ... }
}
```

**`_buildArgs` logic:**

```
args = ['-p', port, '-n', serverName, '-js']
if dataDir     → args.push('-sd', dataDir)
if clusterPort → args.push('--cluster', `nats://0.0.0.0:${clusterPort}`,
                            '--cluster_name', clusterName)
for route in routes → args.push('--routes', route)
args.push(...extraArgs)
```

**`_waitUntilReady` logic:**

```
deadline = Date.now() + timeoutMs
while Date.now() < deadline:
  // N13 FIX: always close the probe connection even when connect() throws.
  // Without the finally block, each failed connect() attempt that partially
  // opened a TCP socket leaks it — Bun raises unhandled-rejection warnings
  // for dangling NATS connections, which can kill the test process.
  nc = null
  try:
    nc = await connect({ servers: `nats://127.0.0.1:${port}`, timeout: 500 })
    await nc.close()
    return   ← success
  catch:
    (ignore — server not ready yet)
  finally:
    if nc != null: try { await nc.close() } catch {} // idempotent — safe to call twice
  await Bun.sleep(100)
throw new Error(`nats-server on port ${port} did not start within ${timeoutMs}ms`)
```

**TypeScript implementation shape:**

```typescript
private static async _waitUntilReady(port: number, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        let nc: NatsConnection | null = null;
        try {
            nc = await connect({ servers: `nats://127.0.0.1:${port}`, timeout: 500 });
            return; // success — nc.close() in finally
        } catch {
            // server not ready yet — sleep and retry
            await Bun.sleep(100);
        } finally {
            // N13 FIX: always close, even on success (idempotent) or partial-open
            if (nc != null) {
                try { await nc.close(); } catch { /* ignore close error */ }
            }
        }
    }
    throw new Error(`nats-server on port ${port} did not start within ${timeoutMs}ms`);
}
```

**`shutdown()` implementation shape (N15 FIX):**

```typescript
async shutdown(): Promise<void> {
    if (this._processes.length === 0) return;  // already shut down
    // Kill all processes concurrently, then wait for all to exit.
    // proc.kill() sends SIGTERM; proc.exited resolves when the OS confirms exit.
    // Without await proc.exited, the port is not free until the OS processes the signal,
    // which is asynchronous — next test's beforeAll can fire before the port is released.
    const procs = [...this._processes];
    this._processes.length = 0;  // clear before await to make method idempotent
    await Promise.all(procs.map(async (proc) => {
        proc.kill();
        await proc.exited;
    }));
}
```

**TODO — Block 2:**
- [ ] Create `src/server/NatsServerConfig.ts` — `NatsServerNodeConfig` interface
- [ ] Create `src/server/NatsServerManager.ts` — `spawn()`, `shutdown()` (async, N15), `_buildArgs()`, `_waitUntilReady()` (with N13 finally-close fix)
- [ ] Add to `NatsServerManagerTest.test.ts`:
  - `spawn_singleNode_inMemory_becomesReachable` — spawns server, verifies connect succeeds
  - `spawn_singleNode_persistent_storesData` — spawns with `dataDir`, verifies JetStream KV survives restart
  - `spawn_multiNode_allNodesReachable` — spawns 3 nodes, verifies all 3 ports connectable
  - `shutdown_killsAllProcesses` — after `await shutdown()`, connecting to port fails (N15: must await)
  - `shutdown_isIdempotent` — calling `shutdown()` twice does not throw
  - `shutdown_portsReleasedBeforeResolves` — N15 test: spawn on port P, shutdown, spawn again on same port P — no EADDRINUSE
  - `waitUntilReady_noConnectionLeak` — N13 test: mock connect to fail 5 times; verify no open connections remain
  - `buildArgs_inMemory_noStoreDirFlag` — args contain `-js` but not `-sd`
  - `buildArgs_persistent_containsStoreDirFlag` — args contain `-js -sd <path>`
  - `buildArgs_clusterNode_containsRoutesAndClusterFlags` — args contain `--cluster` and `--routes`
  - `waitUntilReady_timeoutExceeded_throws` — unreachable port throws with timeout message
  - `waitUntilJetStreamReady_clusterNotLeader_retriesUntilReady` — N14 test: mock `jsm.info()` to fail 3 times then succeed; verify spawn() waits
  - `spawn_cluster_jetStreamReadyBeforeReturn` — N14 integration test: after `spawn()`, `jsm.info()` succeeds immediately (no retry needed at call site)

---

## Block 3 — `BlitzConfig` Extensions

### New types in `src/BlitzConfig.ts`

```typescript
/**
 * Configuration for an embedded nats-server instance.
 * Mutually exclusive with providing `servers` directly in BlitzConfig.
 */
export interface EmbeddedNatsConfig {
    /**
     * TCP port for client connections.
     * @default 4222
     */
    readonly port?: number;

    /**
     * Directory for JetStream persistent file storage.
     * Omit for in-memory mode (ephemeral — data lost on shutdown).
     * Provide an absolute path for persistence across restarts.
     */
    readonly dataDir?: string;

    /**
     * Override the resolved nats-server binary path.
     * Useful for air-gapped environments or custom builds.
     * Default: resolved via npm package → system PATH.
     */
    readonly binaryPath?: string;

    /**
     * Maximum time to wait for the embedded server to become reachable (ms).
     * @default 10_000
     */
    readonly startTimeoutMs?: number;

    /**
     * Extra arguments passed verbatim to the nats-server process.
     * Use for advanced tuning not covered by typed options.
     */
    readonly extraArgs?: string[];
}

/**
 * Configuration for a multi-node embedded NATS JetStream cluster.
 * When provided, BlitzService.start() spawns `nodes` nats-server processes
 * and links them via Raft-based cluster routing.
 *
 * Mutually exclusive with `embedded` (use one or the other).
 */
export interface NatsClusterConfig {
    /**
     * Number of cluster nodes to spawn.
     * Must be odd (1, 3, 5) for correct Raft quorum.
     * @default 1
     */
    readonly nodes?: number;

    /**
     * Cluster name shared across all nodes.
     * @default 'helios-blitz-cluster'
     */
    readonly name?: string;

    /**
     * Base client port. Node i listens on `basePort + i`.
     * @default 4222
     */
    readonly basePort?: number;

    /**
     * Base intra-cluster routing port. Node i listens on `baseClusterPort + i`.
     * @default 6222
     */
    readonly baseClusterPort?: number;

    /**
     * Base directory for JetStream file storage.
     * Each node writes to `<dataDir>/node-<i>/`.
     * Omit for in-memory mode.
     */
    readonly dataDir?: string;

    /**
     * Override the nats-server binary path (same as EmbeddedNatsConfig.binaryPath).
     */
    readonly binaryPath?: string;

    /**
     * Maximum time to wait for ALL nodes to become reachable (ms).
     * @default 15_000
     */
    readonly startTimeoutMs?: number;
}
```

### `BlitzConfig` updated

```typescript
export interface BlitzConfig {
    /**
     * NATS server URL(s) for connecting to an external cluster.
     * Omit when using `embedded` or `cluster` (embedded mode).
     * Mutually exclusive with `embedded` and `cluster`.
     */
    readonly servers?: string | string[];

    /** Embed a single nats-server process. Mutually exclusive with `servers` and `cluster`. */
    readonly embedded?: EmbeddedNatsConfig;

    /** Embed a multi-node nats-server cluster. Mutually exclusive with `servers` and `embedded`. */
    readonly cluster?: NatsClusterConfig;

    // ... all existing optional fields unchanged ...
}
```

### `resolveBlitzConfig` validation

Exactly one of `servers`, `embedded`, `cluster` must be set. For cluster configs, client
ports and cluster routing ports must not overlap:

```typescript
export function resolveBlitzConfig(config: BlitzConfig): ResolvedBlitzConfig {
    const modes = [config.servers, config.embedded, config.cluster].filter(Boolean).length;
    if (modes === 0) {
        // Default: embedded single-node in-memory
        return resolveBlitzConfig({ ...config, embedded: {} });
    }
    if (modes > 1) {
        throw new Error(
            'BlitzConfig: specify exactly one of `servers`, `embedded`, or `cluster` — not multiple.'
        );
    }

    // N7 FIX: Validate that client ports and cluster routing ports don't overlap
    // in multi-node cluster configs. Example of the bug: basePort=6222 and
    // baseClusterPort=6222 with nodes=3 allocates:
    //   client ports:  6222, 6223, 6224
    //   cluster ports: 6222, 6223, 6224
    // Node 0 tries to bind two listeners on port 6222 → EADDRINUSE.
    if (config.cluster) {
        const nodes = config.cluster.nodes ?? 1;
        const basePort = config.cluster.basePort ?? 4222;
        const baseClusterPort = config.cluster.baseClusterPort ?? 6222;
        const clientPorts = new Set(Array.from({ length: nodes }, (_, i) => basePort + i));
        const clusterPorts = new Set(Array.from({ length: nodes }, (_, i) => baseClusterPort + i));
        const overlapping = [...clientPorts].filter(p => clusterPorts.has(p));
        if (overlapping.length > 0) {
            throw new Error(
                `BlitzConfig cluster: client ports and cluster routing ports overlap at [${overlapping.join(', ')}]. ` +
                `Ensure basePort (${basePort}) and baseClusterPort (${baseClusterPort}) ranges do not intersect. ` +
                `Default: basePort=4222, baseClusterPort=6222 (no overlap for up to 1783 nodes).`
            );
        }
    }

    // ... apply remaining defaults as before ...
}
```

**TODO — Block 3:**
- [ ] Add `EmbeddedNatsConfig` interface to `src/BlitzConfig.ts`
- [ ] Add `NatsClusterConfig` interface to `src/BlitzConfig.ts`
- [ ] Make `servers` optional in `BlitzConfig` (was required)
- [ ] Add mutual-exclusivity validation in `resolveBlitzConfig()`
- [ ] Default behavior (no config at all): `embedded: {}` → single-node in-memory
- [ ] Add to `test/BlitzConfigTest.test.ts`:
  - `resolveBlitzConfig_noArgs_defaultsToEmbeddedInMemory`
  - `resolveBlitzConfig_serversAndEmbedded_throws`
  - `resolveBlitzConfig_serversAndCluster_throws`
  - `resolveBlitzConfig_embeddedAndCluster_throws`
  - `resolveBlitzConfig_serversOnly_resolvedCorrectly`
  - `resolveBlitzConfig_embeddedOnly_defaultPortApplied`
  - `resolveBlitzConfig_clusterNodes_mustBeOdd` — 2 nodes throws; 3 nodes succeeds
  - `resolveBlitzConfig_clusterDataDir_appliedToAllNodes`
  - `resolveBlitzConfig_clusterPortOverlap_throws` — N7 test: `basePort=6222, baseClusterPort=6222` throws with overlap message
  - `resolveBlitzConfig_clusterPortNoOverlap_succeeds` — N7 test: `basePort=4222, baseClusterPort=6222` resolves without error

---

## Block 4 — `BlitzService.start()` + `shutdown()` extension

### `BlitzService.start()` static method

```typescript
/**
 * Start an embedded NATS JetStream server and connect BlitzService to it.
 *
 * Single-node (default):
 * ```typescript
 * const blitz = await BlitzService.start();
 * ```
 *
 * Single-node persistent:
 * ```typescript
 * const blitz = await BlitzService.start({
 *   embedded: { port: 4222, dataDir: '/data/blitz' }
 * });
 * ```
 *
 * Three-node cluster:
 * ```typescript
 * const blitz = await BlitzService.start({
 *   cluster: { nodes: 3, dataDir: '/data/blitz' }
 * });
 * ```
 *
 * @throws NatsServerNotFoundError if the nats-server binary cannot be resolved.
 * @throws Error if the server(s) do not become reachable within `startTimeoutMs`.
 */
static async start(config: Omit<BlitzConfig, 'servers'> = {}): Promise<BlitzService> {
    const resolved = resolveBlitzConfig(config);
    const nodeConfigs = buildNodeConfigs(resolved);   // produces NatsServerNodeConfig[]
    const manager = await NatsServerManager.spawn(nodeConfigs);
    const servers = manager.clientUrls;               // ['nats://127.0.0.1:4222', ...]
    const service = await BlitzService.connect({ ...config, servers });
    service._manager = manager;                       // stored for shutdown()
    return service;
}
```

### `BlitzService.shutdown()` extension

```typescript
async shutdown(): Promise<void> {
    if (this._closed) return;
    this._closed = true;
    await this.nc.drain();           // existing — deliver in-flight messages
    // N15 FIX: must await shutdown() — it is now async and blocks until all
    // child processes have exited and their ports are fully released.
    // Without await, tests that call shutdown() then start() on the same port
    // get EADDRINUSE because the OS hasn't reclaimed the port yet.
    await this._manager?.shutdown(); // new — kills embedded processes, awaits exit
}
```

### `_manager` field

```typescript
private _manager: NatsServerManager | null = null;
```

### `buildNodeConfigs()` helper (internal, not exported)

Translates `ResolvedBlitzConfig` → `NatsServerNodeConfig[]`:

```
if config.embedded:
  return [single NatsServerNodeConfig from embedded fields + defaults]

if config.cluster:
  nodes = config.cluster.nodes (default 1)
  for i in 0..nodes-1:
    port = basePort + i
    clusterPort = baseClusterPort + i
    routes = all other nodes' cluster URLs: `nats://127.0.0.1:${baseClusterPort + j}` for j ≠ i
    dataDir = config.cluster.dataDir ? `${config.cluster.dataDir}/node-${i}` : undefined
    serverName = `${clusterName}-node-${i}`
    return NatsServerNodeConfig for this node
  return array of N configs
```

**TODO — Block 4:**
- [ ] Add `private _manager: NatsServerManager | null = null` field to `BlitzService`
- [ ] Implement `BlitzService.start()` static factory
- [ ] Extend `BlitzService.shutdown()` to `await this._manager?.shutdown()` after `nc.drain()` (N15 FIX: must await)
- [ ] Implement internal `buildNodeConfigs()` helper
- [ ] Add to `test/BlitzServiceTest.test.ts` (these replace the `skipIf` block entirely):
  - `start_noConfig_connectsToEmbeddedInMemoryServer`
  - `start_embedded_customPort_connectsOnThatPort`
  - `start_embedded_inMemory_dataLostAfterShutdown` — KV write, shutdown, restart, key gone
  - `start_embedded_persistent_dataSurvivesRestart` — KV write, shutdown, restart, key readable
  - `start_cluster_3nodes_allReachable` — after start, 3 client URLs all connectable
  - `start_cluster_leaderElected_jetstreamOperational` — N14 test: publish+consume works on cluster immediately after `start()` returns (no sleep needed)
  - `shutdown_afterStart_killsEmbeddedProcess` — N15 test: connecting after `await shutdown()` throws; test must NOT use `void shutdown()` — must await
  - `shutdown_portReleasedAfterShutdown` — N15 test: shutdown then immediately start on same port — no EADDRINUSE
  - `shutdown_afterConnect_doesNotKillExternalServer` — `_manager` is null, no process killed
  - All existing `connect()` tests are retained unchanged

---

## Block 5 — Remove `skipIf` Guards from Integration Test Files

All four integration test files are updated to use `BlitzService.start()` in `beforeAll` and `BlitzService.shutdown()` in `afterAll`. The `NATS_AVAILABLE` constant and `describe.skipIf` wrapper are removed.

### Pattern — before (current)

```typescript
const NATS_AVAILABLE = !!process.env['NATS_URL'] || !!process.env['CI'];
const NATS_URL = process.env['NATS_URL'] ?? 'nats://localhost:4222';

describe.skipIf(!NATS_AVAILABLE)('BlitzService — NATS integration', () => {
    let natsServer: ReturnType<typeof Bun.spawn> | null = null;

    beforeAll(async () => {
        if (!process.env['NATS_URL']) {
            natsServer = Bun.spawn([...], { stdout: 'ignore', stderr: 'ignore' });
            // health poll ...
        }
    });

    afterAll(() => { natsServer?.kill(); });

    it('connects to NATS server', async () => {
        const blitz = await BlitzService.connect({ servers: NATS_URL });
        // ...
        await blitz.shutdown();
    });
});
```

### Pattern — after (this plan)

```typescript
describe('BlitzService — NATS integration', () => {
    let blitz: BlitzService;

    beforeAll(async () => {
        blitz = await BlitzService.start();
    });

    afterAll(async () => {
        await blitz.shutdown();
    });

    it('connects to embedded NATS server', async () => {
        expect(blitz.isClosed).toBe(false);
        expect(blitz.js).toBeDefined();
    });
    // ...
});
```

**Files to update:**
- `test/BlitzServiceTest.test.ts`
- `test/PipelineTest.test.ts`
- `test/SourceSinkTest.test.ts`
- `test/WindowingTest.test.ts`

**TODO — Block 5:**
- [ ] Remove `NATS_AVAILABLE` constant from all 4 test files
- [ ] Remove `NATS_URL` constant from all 4 test files
- [ ] Remove `describe.skipIf(!NATS_AVAILABLE)` wrapper — replace with plain `describe`
- [ ] Remove `Bun.spawn` boilerplate from all `beforeAll` blocks
- [ ] Replace `BlitzService.connect({ servers: NATS_URL })` calls with `BlitzService.start()`
  where appropriate, or reuse the shared `blitz` instance from `beforeAll`
- [ ] Move per-test `blitz.shutdown()` calls to shared `afterAll`
- [ ] Verify `bun test packages/blitz/test/` — **0 skip, all pass**

---

## Execution Order

Blocks are sequential (each builds on the previous):

```
Block 1 — package.json + NatsServerBinaryResolver
  └─► Block 2 — NatsServerConfig + NatsServerManager
        └─► Block 3 — BlitzConfig extensions
              └─► Block 4 — BlitzService.start() + shutdown() extension
                    └─► Block 5 — Remove skipIf guards
```

---

## Done Gate

All of the following must be true before this plan is complete:

- [ ] `bun test packages/blitz/test/` — **0 skip, 0 fail** (currently: 26 skip)
- [ ] `bun test packages/blitz/test/server/` — all `NatsServerManagerTest` tests pass
- [ ] `bun test` (root, full suite) — **0 skip, 0 fail** (currently: 26 skip, 1 fail)
- [ ] `BlitzService.start()` works with zero arguments in a fresh `bun install` environment
- [ ] `BlitzService.connect()` is unchanged and all existing `connect()` tests still pass
- [ ] `BlitzService.start({ cluster: { nodes: 3 } })` spawns 3 processes and Raft forms
- [ ] `BlitzService.start({ embedded: { dataDir: '/tmp/blitz-test' } })` — data survives restart
- [ ] TypeScript compiles with zero errors: `bun run tsc --noEmit`

---

## API Surface Reference

```typescript
// Zero config — embedded, in-memory, single-node
const blitz = await BlitzService.start();

// Embedded, persistent single-node
const blitz = await BlitzService.start({
    embedded: { dataDir: '/data/blitz' },
});

// Embedded, custom port
const blitz = await BlitzService.start({
    embedded: { port: 14222 },
});

// Embedded three-node cluster (Raft-replicated, persistent)
const blitz = await BlitzService.start({
    cluster: {
        nodes: 3,
        dataDir: '/data/blitz',
        basePort: 4222,
        baseClusterPort: 6222,
    },
});

// External cluster (existing behaviour — unchanged)
const blitz = await BlitzService.connect({
    servers: ['nats://nats-1:4222', 'nats://nats-2:4222', 'nats://nats-3:4222'],
});

// Shutdown in all cases — drains in-flight messages, then kills embedded processes if any
await blitz.shutdown();
```

---

## What Does NOT Change

- `BlitzService.connect()` — identical API and behaviour
- `Pipeline`, `BatchPipeline`, `Stage`, `StageContext` — untouched
- All sources, sinks, operators, window policies, aggregators, joins — untouched
- `FaultHandler`, `CheckpointManager`, `RetryPolicy`, `DeadLetterSink` — untouched
- `HeliosBlitzModule` (NestJS) — `forRoot()` can pass any `BlitzConfig` including `embedded`
- Wire format, codec, subject routing — untouched
- `@zenystx/core` — zero changes

---

## Appendix A - Per-Helios-Node Embedded NATS Cluster Mode

> Purpose: support the production topology where each Helios/API replica starts one local
> embedded `nats-server`, all local servers join the same JetStream cluster, and each app
> instance connects to its own local NATS process.
>
> This appendix defines the low-level `clusterNode` primitive. The Helios-default distributed
> orchestration layer that should use it automatically is specified in Appendix B.

### Problem this solves

Current Blitz startup supports:

- `connect({ servers })` -> use an already-running external NATS cluster
- `start({ embedded })` -> spawn one local single-node NATS server
- `start({ cluster })` -> one process spawns many local `nats-server` children on `127.0.0.1`

What it does **not** support is the real deployment shape:

- replica A hosts NATS node A
- replica B hosts NATS node B
- replica C hosts NATS node C
- A/B/C form one JetStream cluster
- each replica connects locally to `127.0.0.1:<port>`

There should be no app-level `master` flag. NATS should elect leaders itself.

### Recommended topology

```text
Helios/API A -> embedded NATS A -> local client connect on 127.0.0.1:4222
Helios/API B -> embedded NATS B -> local client connect on 127.0.0.1:4222
Helios/API C -> embedded NATS C -> local client connect on 127.0.0.1:4222

NATS A <-> NATS B <-> NATS C  (route mesh / seed routes)
JetStream/KV replicas = 3
```

### Design decisions

| # | Decision | Why |
|---|---|---|
| A1 | Add a new `clusterNode` startup mode | Existing `cluster` means "one process spawns N local nodes"; it should not be overloaded |
| A2 | No manual `master` env flag in the low-level primitive | Helios bootstrap-master orchestration is layered above this in Appendix B; NATS still handles data-plane leadership |
| A3 | Each app instance connects to its own local NATS URL | Lowest latency, simplest reconnect story, least cross-node client coupling |
| A4 | v1 uses explicit seed routes, not Helios membership-driven auto-discovery | Much simpler, deterministic, works in Docker/Kubernetes/systemd immediately |
| A5 | Cluster-node startup waits for local server readiness by default, not full cluster quorum | First node must be allowed to boot before peers exist |
| A6 | Replication factor is a separate Blitz setting | Forming a cluster does not automatically make streams/KV replicated |

### Proposed public API

Add a fourth Blitz startup mode:

```typescript
export interface ClusterNodeNatsConfig {
    readonly port?: number;                 // default 4222
    readonly clusterPort?: number;          // default 6222
    readonly dataDir?: string;              // strongly recommended in production
    readonly binaryPath?: string;
    readonly startTimeoutMs?: number;       // default 15_000
    readonly extraArgs?: string[];

    readonly clusterName?: string;          // default 'helios-blitz-cluster'
    readonly serverName?: string;           // default HOSTNAME || random UUID
    readonly bindHost?: string;             // default '0.0.0.0'
    readonly advertiseHost?: string;        // host peers should route to
    readonly routes?: string[];             // seed route URLs, may include self

    readonly waitForCluster?: {
        readonly minNodes?: number;         // default 1 (self only)
        readonly timeoutMs?: number;        // default startTimeoutMs
        readonly requiredForStart?: boolean;// default false
    };
}

export interface BlitzConfig {
    readonly servers?: string | string[];
    readonly embedded?: EmbeddedNatsConfig;
    readonly cluster?: NatsClusterConfig;
    readonly clusterNode?: ClusterNodeNatsConfig;

    readonly defaultReplicas?: number;      // default 1
}
```

Usage:

```typescript
const blitz = await BlitzService.start({
    clusterNode: {
        port: 4222,
        clusterPort: 6222,
        clusterName: 'helios-prod',
        serverName: process.env.HOSTNAME,
        advertiseHost: `${process.env.HOSTNAME}.api-headless.default.svc.cluster.local`,
        routes: [
            'nats://api-0.api-headless.default.svc.cluster.local:6222',
            'nats://api-1.api-headless.default.svc.cluster.local:6222',
            'nats://api-2.api-headless.default.svc.cluster.local:6222',
        ],
        dataDir: `/var/lib/blitz/${process.env.HOSTNAME}`,
    },
    defaultReplicas: 3,
});
```

### Runtime semantics

- `BlitzService.start({ clusterNode })` spawns exactly one local `nats-server` child process.
- The child process binds local client traffic on `port` and cluster routing on `clusterPort`.
- `routes` are seed routes for peer NATS nodes; the library should normalize duplicates and drop self-routes.
- After spawn, Blitz connects locally to `nats://127.0.0.1:<port>` unless a future `connectUrl` override is added.
- Default readiness is: local TCP ready + local JetStream ready.
- Optional cluster readiness is controlled by `waitForCluster`; this should inspect route/peer count but remain opt-in.
- `defaultReplicas` is used when Blitz creates JetStream/KV resources that should be replicated by default.

### Env-var contract

The core library remains config-first, but we add an env helper for app deployments.

```typescript
export function resolveBlitzConfigFromEnv(
    env: Record<string, string | undefined> = process.env,
): BlitzConfig;

export class BlitzService {
    static async startFromEnv(
        env: Record<string, string | undefined> = process.env,
    ): Promise<BlitzService>;
}
```

Recommended env contract:

```text
BLITZ_MODE=cluster-node

BLITZ_NATS_PORT=4222
BLITZ_NATS_CLUSTER_PORT=6222
BLITZ_NATS_CLUSTER_NAME=helios-prod
BLITZ_NATS_SERVER_NAME=api-0
BLITZ_NATS_BIND_HOST=0.0.0.0
BLITZ_NATS_ADVERTISE_HOST=api-0.api-headless.default.svc.cluster.local
BLITZ_NATS_ROUTES=nats://api-0.api-headless.default.svc.cluster.local:6222,nats://api-1.api-headless.default.svc.cluster.local:6222,nats://api-2.api-headless.default.svc.cluster.local:6222
BLITZ_NATS_DATA_DIR=/var/lib/blitz/api-0
BLITZ_NATS_START_TIMEOUT_MS=15000
BLITZ_DEFAULT_REPLICAS=3
BLITZ_WAIT_FOR_CLUSTER_MIN_NODES=1
BLITZ_WAIT_FOR_CLUSTER_REQUIRED=false
```

Notes:

- `BLITZ_MODE=cluster-node` means "start one local embedded NATS node and join a remote/shared NATS cluster".
- No `BLITZ_MASTER=true/false` flag exists.
- `BLITZ_NATS_ROUTES` can list all nodes; the library should filter self after deriving this node's own route URL from `advertiseHost` + `clusterPort`.
- `BLITZ_DEFAULT_REPLICAS` controls how many JetStream replicas Blitz requests for its own buckets/streams; it does not control NATS cluster formation.

### Three-replica deployment example

Replica `api-0`:

```text
BLITZ_MODE=cluster-node
BLITZ_NATS_SERVER_NAME=api-0
BLITZ_NATS_ADVERTISE_HOST=api-0.api-headless.default.svc.cluster.local
BLITZ_NATS_ROUTES=nats://api-0.api-headless.default.svc.cluster.local:6222,nats://api-1.api-headless.default.svc.cluster.local:6222,nats://api-2.api-headless.default.svc.cluster.local:6222
BLITZ_DEFAULT_REPLICAS=3
```

Replica `api-1`:

```text
BLITZ_MODE=cluster-node
BLITZ_NATS_SERVER_NAME=api-1
BLITZ_NATS_ADVERTISE_HOST=api-1.api-headless.default.svc.cluster.local
BLITZ_NATS_ROUTES=nats://api-0.api-headless.default.svc.cluster.local:6222,nats://api-1.api-headless.default.svc.cluster.local:6222,nats://api-2.api-headless.default.svc.cluster.local:6222
BLITZ_DEFAULT_REPLICAS=3
```

Replica `api-2`:

```text
BLITZ_MODE=cluster-node
BLITZ_NATS_SERVER_NAME=api-2
BLITZ_NATS_ADVERTISE_HOST=api-2.api-headless.default.svc.cluster.local
BLITZ_NATS_ROUTES=nats://api-0.api-headless.default.svc.cluster.local:6222,nats://api-1.api-headless.default.svc.cluster.local:6222,nats://api-2.api-headless.default.svc.cluster.local:6222
BLITZ_DEFAULT_REPLICAS=3
```

### Implementation blocks

#### Block A1 - Config surface and validation

- add `ClusterNodeNatsConfig` and `clusterNode` to `packages/blitz/src/BlitzConfig.ts`
- extend mode validation from 3-way to 4-way: exactly one of `servers`, `embedded`, `cluster`, `clusterNode`
- add `defaultReplicas` to `BlitzConfig` / `ResolvedBlitzConfig`
- validate `clusterNode` has stable `serverName`, sane ports, and non-empty `clusterName`
- if `waitForCluster.minNodes > 1`, validate it is sensible for the route set

#### Block A2 - Single embedded cluster-node spawn path

- extend `packages/blitz/src/server/NatsServerConfig.ts` so a node can describe bind host, advertise host, and seed routes cleanly
- add `buildNodeConfigs()` support for `clusterNode` in `packages/blitz/src/BlitzService.ts`
- emit `--cluster nats://<bindHost>:<clusterPort>` and route flags for seed peers
- if `advertiseHost` is set, pass the equivalent NATS advertise flag via typed config or `extraArgs`
- normalize routes: trim, dedupe, drop self

#### Block A3 - Readiness and cluster waiting

- keep local startup success separate from full cluster quorum
- add optional cluster wait helper in `packages/blitz/src/server/NatsServerManager.ts`
- default: return once local JetStream is usable
- optional: if `requiredForStart=true`, wait until cluster peer count reaches `minNodes`
- surface clear errors when the local node is healthy but the cluster never reaches the requested size

#### Block A4 - Env helper and NestJS ergonomics

- add `resolveBlitzConfigFromEnv()` in `packages/blitz/src/BlitzConfig.ts` or a new helper file
- add `BlitzService.startFromEnv()` as a thin wrapper over `resolveBlitzConfigFromEnv()`
- document NestJS usage via `HeliosBlitzModule.forRootAsync({ useFactory: () => resolveBlitzConfigFromEnv(process.env) })`
- keep env parsing out of the core startup path unless the caller opts into it

#### Block A5 - Replication defaults for Blitz-owned state

- thread `defaultReplicas` through Blitz-owned JetStream/KV creation points
- start with `packages/blitz/src/window/WindowState.ts`, which currently creates KV buckets without a replica count
- audit any future stream/KV creation helpers so cluster-node deployments actually get replicated Blitz state by default
- do not silently force `replicas > live cluster size`; fail with actionable errors from JetStream

#### Block A6 - Tests and rollout

- unit tests for config validation, env parsing, route normalization, and self-route removal
- integration tests that start 3 separate cluster-node services on different ports and verify they form one cluster
- integration tests that each service can connect to its own local NATS while sharing one KV bucket with `replicas: 3`
- restart test: kill one node, confirm surviving nodes continue, restart it, and verify it rejoins
- shutdown test: `await shutdown()` releases both client and route ports deterministically

### Test matrix

| Test | What it proves |
|---|---|
| `clusterNode_start_localServerReady_returns` | first node can boot without peers |
| `clusterNode_routes_selfIncluded_selfFiltered` | callers can provide one shared route list |
| `clusterNode_threeServices_formOneCluster` | 3 app replicas each hosting 1 NATS node work together |
| `clusterNode_defaultReplicas_appliedToWindowKv` | Blitz-owned state is actually replicated |
| `clusterNode_requiredClusterWait_timesOutCleanly` | optional quorum wait fails clearly |
| `clusterNode_restart_rejoinsCluster` | a restarted replica can rejoin its peers |

### Recommended rollout order

1. land config/API + `clusterNode` spawn support
2. land env helper and docs
3. land `defaultReplicas` propagation into Blitz-owned KV/state
4. add 3-process integration tests that model real API replicas
5. only then document this as the preferred HA embedded deployment mode

### Non-goals for Appendix A / v1 primitive

- automatic route discovery from Helios member lists (handled by Appendix B)
- Helios oldest-member bootstrap/master orchestration (handled by Appendix B)
- coupling Blitz startup to Helios cluster join state (handled by Appendix B)
- replacing explicit NATS routes with a full discovery/control plane outside Helios integration

### Done gate for this appendix

- [ ] one API replica can boot with `clusterNode` before peers exist
- [ ] three API replicas can each host one NATS node and form one JetStream cluster
- [ ] Blitz-owned KV/window state honors `defaultReplicas=3`
- [ ] `startFromEnv()` works for `cluster-node` without custom app bootstrap glue
- [ ] docs clearly recommend "one embedded NATS node per app replica" over a single embedded primary

---

## Appendix B - Distributed-by-Default Helios Blitz Flow (Phase 18)

> Purpose: make the Helios-integrated Blitz experience distributed by default. Once a second
> Helios node joins the cluster, the local embedded NATS nodes should automatically form a
> shared JetStream cluster.

### Default behavior

- every Helios node hosts one local embedded `nats-server`
- every app instance connects to its own local NATS server
- the oldest/current Helios master member is the Blitz bootstrap master for topology + seed routing
- all nodes are still NATS/JetStream replicas; the master is a control-plane role, not the only data node
- no manual `BLITZ_MASTER=true/false` flag exists

### Automatic flow

1. first Helios node boots, starts one local embedded NATS node, and is the initial Blitz bootstrap master
2. the first node registers its Blitz node metadata in a Helios-owned cluster metadata service
3. when a second Helios node joins, it asks the oldest/master Helios member for the current Blitz seed/topology snapshot
4. the joining node starts its own local NATS node in `clusterNode` mode and routes to the seed node(s)
5. once connected, the NATS nodes form a cluster automatically; both app instances continue connecting locally
6. when later nodes join, they repeat the same flow
7. if the oldest/master Helios member leaves, the next oldest member becomes the Blitz bootstrap master for future joins; the existing NATS cluster continues running

### Important distinction

- Helios oldest/master member = Blitz bootstrap master / control plane coordinator
- NATS cluster leader = JetStream/Raft data-plane leader elected by NATS

These are related but not the same role.

### Distributed default policy

For Helios-integrated deployments, the default startup policy should be `distributed-auto`:

- if Helios TCP clustering is disabled -> Blitz falls back to local embedded mode
- if Helios TCP clustering is enabled and the node is alone -> start one local embedded NATS node and wait for future peers
- if Helios TCP clustering is enabled and peers exist -> auto-join the Blitz cluster through the current oldest/master Helios member

The raw `packages/blitz` primitives stay usable directly, but the Helios-facing default should
be the distributed flow above.

### Env and bootstrap contract

Recommended operator contract:

```text
BLITZ_MODE=auto
BLITZ_NATS_PORT=4222
BLITZ_NATS_CLUSTER_PORT=6222
BLITZ_NATS_CLUSTER_NAME=helios-blitz
BLITZ_NATS_DATA_DIR=/var/lib/blitz/${HOSTNAME}
BLITZ_DEFAULT_REPLICAS=3
```

Meaning:

- `BLITZ_MODE=auto` is the default
- no explicit master flag is required
- stable per-node identity comes from Helios member identity / hostname
- the oldest/master Helios member supplies or confirms the current seed topology
- explicit `BLITZ_NATS_ROUTES` remains available as an override, but is not the primary Helios path

### Canonical queue mapping

Appendix B maps to canonical master-plan blocks `18.1`-`18.5` in
`plans/TYPESCRIPT_PORT_PLAN.md`.

### Block 18.1 - `clusterNode` primitive + replication defaults

Goal: finish the low-level Blitz package support needed for one embedded NATS node per app replica.

- add `ClusterNodeNatsConfig` and `clusterNode` to `packages/blitz/src/BlitzConfig.ts`
- add `defaultReplicas` to Blitz config and resolved config
- support a single spawned clustered node in `packages/blitz/src/BlitzService.ts`
- extend `packages/blitz/src/server/NatsServerConfig.ts` for bind host, advertise host, and seed routes
- normalize routes, dedupe entries, and drop self-routes

### Block 18.2 - Helios Blitz bootstrap-master control plane

Goal: let the oldest/current Helios master member coordinate Blitz cluster metadata automatically.

- add a Helios-owned Blitz cluster metadata service that tracks member UUID, server name, advertise host, client port, cluster port, and generation
- define the oldest/current Helios master member as the Blitz bootstrap master for topology snapshots and future joins
- publish deterministic topology snapshots for joining nodes
- define master handoff behavior when the oldest member leaves

### Block 18.3 - Distributed-auto startup, join, and rejoin flow

Goal: make distributed Blitz the default Helios behavior, not an opt-in manual role assignment.

- on first-node startup, boot local embedded NATS without requiring peers
- on later-node startup, fetch seed topology from the current bootstrap master and auto-join
- keep every app instance connected locally to `127.0.0.1:<port>`
- support node restart/rejoin without manual reconfiguration
- keep Helios cluster join independent from NATS data-plane leadership

### Block 18.4 - Env helpers, NestJS wiring, and replicated Blitz-owned state

Goal: make the default path easy to operate and actually replicated.

- add `resolveBlitzConfigFromEnv()` / `BlitzService.startFromEnv()` with `BLITZ_MODE=auto`
- add a Helios/NestJS bootstrap path that uses the distributed-auto default when clustering is enabled
- propagate `defaultReplicas` into Blitz-owned JetStream/KV creation points
- start with `packages/blitz/src/window/WindowState.ts` so KV-backed window state replicates across nodes

### Block 18.5 - Multi-node HA verification

Goal: prove the full user story works with real Helios members.

- start 3 Helios/API replicas, each hosting one local NATS node, and verify they form one cluster
- verify node 1 alone boots successfully and node 2 auto-joins without manual master flags
- verify the oldest/master Helios member changeover after member loss does not break future joins
- verify Blitz-owned KV/window state honors `defaultReplicas=3`
- verify restart/rejoin and shutdown semantics stay deterministic

### Done gate for Appendix B / Phase 18

- [ ] starting a second Helios node automatically forms a Blitz cluster with the first node
- [ ] the oldest/current Helios master member acts as Blitz bootstrap master with no manual env toggle
- [ ] every Helios node hosts its own local embedded NATS node and connects locally
- [ ] Blitz-owned state is replicated by default in multi-node deployments
- [ ] a 3-node Helios deployment survives bootstrap-master loss and allows new nodes to join afterward
