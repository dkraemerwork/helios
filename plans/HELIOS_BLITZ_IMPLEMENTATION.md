# Helios Blitz Implementation

> **Purpose:** Implementation reference for `TYPESCRIPT_PORT_PLAN.md` — Phases 9, 10 (Blitz), and 11.  
> Documents every design decision, anti-pattern fix, and mechanism spec in the plan,
> with the exact fix applied to each block. Use this when implementing or reviewing any block.

## Repo-Reality Amendments

When executing this document, apply these corrections everywhere they matter:

- use `examples/native-app/...`, not `app/...`
- consumer subpath imports stay `@zenystx/helios-blitz/nestjs`, but package exports must use `"./nestjs"`
- do not target a nonexistent `CONTRIBUTING.md`; use real repo docs targets
- use the repo's ESM-safe NATS binary resolver approach, not raw `require.resolve(...)`
- do not declare Phase 9 complete while static `CacheableRegistry` or global transaction-manager
  state remains in use anywhere in runtime or tests
- do not remove the native-app control-port endpoints without replacing their current `/demo/*`
  behavior intentionally

---

## Summary of Issues Found & Fixed

| # | Block | Problem | Fix applied |
|---|---|---|---|
| 1 | Block 9.3 | `register()` signature shown changing + "backward compat" contradicts itself | Kept `register(factory)` unchanged; added `registerAsync()` additively; defined 3 new types |
| 2 | Block 9.4 | "Deprecation shim for one release cycle" = cutover mechanic on greenfield code | Removed shim entirely; clean ALS-based resolution |
| 3 | Block 9.4 | `@Transactional` silently executes without a transaction if no manager registered | Throws `CannotCreateTransactionException` — no silent no-op |
| 4 | Block 9.6 | "`@Cacheable` resolves from NestJS DI" stated but mechanism unspecified | Specified `HeliosCacheInterceptor as APP_INTERCEPTOR` pattern |
| 5 | Block 9.8 | "Accept both string and symbol tokens for one release cycle" = two-step migration | Clean switch to `Symbol()` in one commit |
| 6 | Block 10.0 | "Set up workspace" implies workspace doesn't exist — it already does | Changed to "Create directory + files (workspace entry already configured)" |
| 7 | Phase 10 | No spec for how integration tests provision a NATS server | Added test infrastructure section with `Bun.spawn` + `NATS_URL` skip guard |
| 8 | Block 9.0 | Block-level TODOs show `[ ]` but master list shows `[x]` | Marked all Block 9.0 TODO items `[x]` |
| 9 | Block 11.6 | "Delegates /hazelcast/* to core server" = two listeners, one proxying another | `app/src/http-server.ts` deleted; instance configured with `RestApiConfig` directly |
| 10 | Block 10.0 | `nats@^2` pins a superseded monolithic package; v3 API (`nc.jetstream()` etc.) removed | Replace with `@nats-io/transport-node`, `@nats-io/jetstream`, `@nats-io/kv`; update `BlitzService` to v3 scoped API |
| 11 | Block 10.2 | Wire format between pipeline stages unspecified; `Uint8Array` payloads yield `unknown` type | Introduced `BlitzCodec<T>` interface + `JsonCodec`/`StringCodec`/`BytesCodec`; all NATS sources/sinks require a codec parameter |
| 12 | Block 10.4 | NATS KV TTL is per-bucket, not per-key — `WindowState` leaks closed window accumulators indefinitely | Explicit `kv.delete(windowKey)` after every successful window emit; bucket TTL = `maxDurationMs * 3` as safety backstop only |
| 13 | Block 10.5 | NATS queue groups have no key-affinity — grouped aggregations produce wrong results with parallel workers | Replaced queue-group parallelism with subject-partitioned shards (`withParallelism(N)` → `hash(key) % N`); no combiner needed |
| 14 | Block 10.3 | `NakError` referenced in operator spec but never defined anywhere — day-1 compile error | Added `src/errors/` hierarchy (`BlitzError`, `NakError`, `DeadLetterError`, `PipelineError`) to package layout + type definitions; Block 10.0 TODO updated |
| 15 | Block 9.4 | `TransactionExceptions.ts` imported in `Transactional.ts` but missing from `packages/nestjs/` layout and never specified | Added `TransactionExceptions.ts` to nestjs package layout + full `CannotCreateTransactionException` type definition in Block 9.4; Block 9.4 TODO updated |
| 16 | Block 10.9 | `@nestjs/common` and `@nestjs/core` absent from `packages/blitz/package.json`; NestJS submodule leaking through main barrel `src/index.ts` | Added as optional peer dependencies; NestJS submodule exported only via `@zenystx/helios-blitz/nestjs` subpath export; `src/index.ts` must NOT import from `src/nestjs/` |
| 17 | Phase 10 | `process.exit(0)` skip guard makes ALL 10 integration test files silently disappear from `bun test` — done gate shows green with 0 actual integration tests run | Replaced with `describe.skipIf(!NATS_AVAILABLE)` — shows as SKIP in output, counted in test results, done gate can verify skip count vs expected |
| 18 | Block 10.7 | `CheckpointManager` defaults (N, T) and mid-window crash replay scope unspecified — implementer cannot derive correct values | Added `CheckpointManager specification` subsection: N=100 acks, T=5000ms, KV value includes `windowKeys: string[]`, restart seeks to `sequence+1` + restores open window accumulators from KV; both configurable via `BlitzConfig.checkpointIntervalAcks` / `checkpointIntervalMs` |
| 19 | Block 10.7 | Sink error propagation contract undefined — when `write()` throws the plan never specifies whether the upstream JetStream message is nak'd, retried, or silently dropped | Added `Sink error propagation contract` subsection: sink failure = operator failure from fault policy's perspective; upstream message nak'd; full pipeline chain retries as a unit; idempotency requirements for sinks documented per-sink in Block 10.2 |
| 20 | Block 10.0 | NATS server unavailability during pipeline execution is unaddressed — in-flight `js.publish()` and KV writes during reconnect window fail silently | Added NATS reconnect behavior subsection with explicit reconnect config fields (`maxReconnectAttempts`, `reconnectTimeWaitMs`, `connectTimeoutMs`, `natsPendingLimit`), per-primitive reconnect behavior contract, `BlitzEvent` enum for status monitoring, `nc.status()` subscription in `BlitzService` |
| 21 | Block 10.7 | Block 10.7 has only 20 specified tests — severely under-tested for 8 distinct fault-tolerance behavioral axes; 80% coverage gate will fail | Raised Block 10.7 to 35 tests minimum with detailed per-concern test list covering AckPolicy (3), RetryPolicy fixed (3), RetryPolicy exponential (3), DeadLetterSink (4), CheckpointManager (8), Crash simulation (3), Sink errors (3); Phase 10 total raised from ~280 to ~295 |
| 22 | Block 10.5 | `Aggregator<T, A, R>` name collision — plan claimed core batch aggregators are "reused here" but the blitz interface adds `combine()` which is absent in core; the two interfaces are incompatible, violating "no duplicate implementations" | Specified blitz aggregators as thin wrappers: delegate all logic to `@zenystx/helios-core` implementations, add only `combine()` per wrapper; full interface spec and per-aggregator `combine()` semantics documented |
| 23 | Block 10.1 | At-least-once duplicate delivery never documented as an explicit operator contract — operators WILL receive duplicate `process()` calls after restart but no JSDoc, StageContext, or test scenario exists to communicate this | Added at-least-once JSDoc to `Stage.ts` spec; added `StageContext` interface (`messageId`, `deliveryCount`, `nak()`); added `StageContext.ts` to package layout; added `AtLeastOnceTest` scenario to Block 10.10; added positive "What IS guaranteed" statement to Phase 10 intro |
| 24 | Block 10.9 | `HeliosBlitzModule` uses `ConfigurableModuleBuilder` but `HeliosCacheModule` and `HeliosTransactionModule` use hand-rolled `register()`/`registerAsync()` — two patterns in the ecosystem with no documented rationale; new contributors will be confused | Added rationale note in Block 10.9 explaining the historical difference; specified `ConfigurableModuleBuilder` as the canonical pattern for all new `@helios/*` modules; noted cache/transaction migration as a separate future task; added note to Phase 9 done gate |

---

## Issue 1 — Block 9.3: `HeliosTransactionModule.register()` signature contradiction

**Symptom:** Plan showed changing `register(factory)` → `register({ factory, defaultTimeout })`
while also saying "Retain backward-compat `register()` signatures". These contradict each other.
168 tests already exercise the existing signature.

**Root cause:** The `registerAsync` addition was conflated with a signature redesign.

**Fix applied:** `register(factory: TransactionContextFactory)` is **unchanged**.
`registerAsync()` is purely additive. Three new types are defined in the block and exported
from `HeliosTransactionModule.ts`:

```typescript
// packages/nestjs/src/HeliosTransactionModule.ts — new exports

export interface HeliosTransactionModuleOptions {
    /** Factory that creates TransactionContext instances. */
    factory: TransactionContextFactory;
    /** Default timeout in seconds. -1 = no timeout. Default: -1 */
    defaultTimeout?: number;
}

export interface HeliosTransactionModuleOptionsFactory {
    createHeliosTransactionOptions():
        HeliosTransactionModuleOptions | Promise<HeliosTransactionModuleOptions>;
}

// registerAsync: supports useFactory / useClass / useExisting
static registerAsync(options: {
    imports?: DynamicModule['imports'];
    useFactory?: (...args: any[]) => HeliosTransactionModuleOptions | Promise<HeliosTransactionModuleOptions>;
    useClass?: new (...args: any[]) => HeliosTransactionModuleOptionsFactory;
    useExisting?: any;
    inject?: any[];
    extraProviders?: Provider[];
}): DynamicModule
```

`HeliosCacheModuleOptionsFactory` is also defined (required by `HeliosCacheModuleAsyncTest.test.ts`):

```typescript
// packages/nestjs/src/HeliosCacheModule.ts — new export
export interface HeliosCacheModuleOptionsFactory {
    createHeliosCacheOptions(): HeliosCacheModuleOptions | Promise<HeliosCacheModuleOptions>;
}
```

The vague `store: heliosMapAsStore` example is replaced with a concrete helper:

```typescript
// How to adapt a Helios IMap to IHeliosCacheMap for use as a cache store:
function heliosMapAsStore(map: IMap<string, unknown>): IHeliosCacheMap {
    return {
        async get(key) { return map.get(key); },
        async set(key, value, ttl) {
            if (ttl != null && ttl > 0) await map.put(key, value, ttl, 'MILLISECONDS');
            else await map.put(key, value);
        },
        async delete(key) { await map.remove(key); return true; },
        async clear() { await map.clear(); },
        async has(key) { return map.containsKey(key); },
        async keys() { return [...(await map.keySet())]; },
    };
}

// Usage in registerAsync:
HeliosCacheModule.registerAsync({
    imports: [HeliosModule],
    useFactory: (hz: HeliosInstance) => ({
        ttl: 30_000,
        store: heliosMapAsStore(hz.getMap('cache')),
    }),
    inject: [HELIOS_INSTANCE_TOKEN],
})
```

**Tests already written (RED):**
- `packages/nestjs/test/nestjs/HeliosCacheModuleAsyncTest.test.ts` — 6 tests
- `packages/nestjs/test/nestjs/HeliosTransactionModuleAsyncTest.test.ts` — 7 tests

---

## Issue 2 — Block 9.4: Deprecation shim is a cutover mechanic

**Symptom:** TODO item: "Deprecation shim: if static methods are called, warn + delegate (one release cycle)."

**Root cause:** `@zenystx/helios-nestjs` has never been published. Zero external consumers exist.
A shim creates a state where the API is half-removed, adds dead code, and makes "done" ambiguous.

**Fix applied:** Removed entirely. Block 9.4 is now a clean one-step operation:

1. Remove `static _current`, `setCurrent()`, `getCurrent()` from `HeliosTransactionManager` — no shim
2. Add `_txManagerStorage: AsyncLocalStorage<HeliosTransactionManager>` in `HeliosTransactionModule.ts` (module-file scope, not exported)
3. `HeliosTransactionModule.onModuleInit()` writes manager to `_txManagerStorage`
4. `@Transactional()` reads from `_txManagerStorage` (see Issue 3 for what happens when not found)
5. Remove `HeliosTransactionManager.setCurrent(null)` from `afterEach` in `HeliosTransactionModuleAsyncTest.test.ts` and `HeliosTransactionModuleTest.test.ts` (no longer needed — no global state to reset)

---

## Issue 3 — Block 9.4: Silent no-op fallback in `@Transactional`

**Symptom:** Current `Transactional.ts`:
```typescript
const mgr = HeliosTransactionManager.getCurrent();
if (!mgr) {
    // No manager registered — execute without transaction wrapping.
    // This should not happen in a properly configured NestJS module.
    return originalMethod.apply(this, args);  // ← SILENT BUG
}
```

**Root cause:** Defensive coding that silently swallows a misconfiguration, turning a guaranteed
data-integrity failure into an invisible one.

**Fix applied:** After ALS resolution (Issue 2), the guard is:
```typescript
const mgr = _txManagerStorage.getStore();
if (!mgr) {
    throw new CannotCreateTransactionException(
        '@Transactional() called outside a HeliosTransactionModule context. ' +
        'Import HeliosTransactionModule.register() or registerAsync() in your app module.'
    );
}
```
Fail loud. Never silent.

---

## Issue 4 — Block 9.6: `@Cacheable` DI resolution mechanism unspecified

**Symptom:** "Decorators resolve cache store from NestJS DI (no global state)" stated as goal
with no mechanism. Without a spec, the implementer would use a process-level global.

**Fix applied:** Mechanism specified in the plan block:

```
Implementation pattern:
- @Cacheable / @CacheEvict / @CachePut store only metadata on the method
  via Reflect.defineMetadata (no execution logic at decoration time).
- HeliosCacheModule provides a HeliosCacheInterceptor that extends CacheInterceptor
  from @nestjs/cache-manager, registered as APP_INTERCEPTOR within the module scope.
- HeliosCacheInterceptor reads @Cacheable/@CacheEvict/@CachePut metadata from the
  handler method; injects CACHE_MANAGER via constructor DI; executes cache
  read/write/evict logic around the method call.
- No module-level global. No process-level singleton. Pure NestJS DI.
```

The `APP_INTERCEPTOR` registration ensures the interceptor has full DI access to `CACHE_MANAGER`.
This is identical to how `@nestjs/cache-manager`'s own interceptor works — we extend it.

---

## Issue 5 — Block 9.8: "One release cycle" backward compat for Symbol tokens

**Symptom:** TODO: "Add backward-compat: accept both string and symbol tokens for one release cycle."

**Root cause:** `HELIOS_INSTANCE_TOKEN` is consumed via import everywhere. All call sites already
import the constant — they get whatever value it has automatically. No consumer hardcodes `'HELIOS_INSTANCE'`
as a string literal (that would be a consumer bug).

**Fix applied:** Single clean TODO item:
> "Change `HELIOS_INSTANCE_TOKEN` to `Symbol('HELIOS_INSTANCE')` — all importers automatically
> receive the new value. Verify `bun test` in `packages/nestjs/` stays green."

No transition period. No accepting string tokens. One commit.

---

## Issue 6 — Block 10.0: Workspace entry already exists

**Symptom:** TODO "Set up `packages/blitz/` workspace" implies adding it to `workspaces[]`.

**Root cause:** Root `package.json` already has `"workspaces": ["packages/nestjs", "packages/blitz"]`.
This was done when Blitz was scaffolded (then reverted for files only, not config).

**Fix applied:** TODO changed to:
> "Create `packages/blitz/` directory with `package.json`, `tsconfig.json`, `bunfig.toml`,
> `src/index.ts` (root workspace entry already configured)"

---

## Issue 7 — Phase 10: No NATS server provisioning for integration tests

**Symptom:** Blocks 10.4–10.8 require live NATS with JetStream (KV Store, durable consumers,
checkpoint). No test infrastructure spec existed.

**Fix applied:** Added "Test infrastructure for Phase 10" section in the Phase 10 introduction:

```
Unit tests (Blocks 10.1, 10.3, operators in isolation): mock NatsConnection interface.
No external process needed.

Integration tests (Blocks 10.0, 10.2, 10.4, 10.5, 10.7, 10.8, 10.10): real NATS server.

Strategy — Bun test lifecycle using describe.skipIf (see Issue 17 for why NOT process.exit(0)):
```

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

const NATS_AVAILABLE = !!process.env.NATS_URL || !!process.env.CI;

describe.skipIf(!NATS_AVAILABLE)('BlitzService — NATS integration', () => {
  let natsServer: ReturnType<typeof Bun.spawn>;

  beforeAll(async () => {
    natsServer = Bun.spawn(
      [require.resolve('nats-server/bin/nats-server'), '-js', '-p', '4222'],
      { stdout: 'ignore', stderr: 'ignore' },
    );
    // Health poll — wait until NATS accepts connections (up to 3s)
    const { connect } = await import('@nats-io/transport-node');
    for (let i = 0; i < 30; i++) {
      try { const nc = await connect({ servers: 'nats://localhost:4222' }); await nc.close(); break; }
      catch { await Bun.sleep(100); }
    }
  });

  afterAll(() => { natsServer.kill(); });

  // tests go here
});
```

```
The nats-server binary (~20MB) is added to devDependencies via the `nats-server` npm
package (wraps the binary). Document in CONTRIBUTING.md.

CI sets NATS_URL=nats://localhost:4222 or CI=true.
```

---

## Issue 8 — Block 9.0 TODO items not marked as done

**Symptom:** Master todo list shows `[x] Block 9.0 ✅ (168 tests)` but block-level TODO items
all showed `[ ]`.

**Fix applied:** All Block 9.0 TODO items marked `[x]`.

---

## Issue 9 — Block 11.6: "Delegates" is a proxy anti-pattern

**Symptom:**
- Block 11.6 TODO: "Refactor `app/src/http-server.ts` — start core `HeliosRestServer` for `/hazelcast/*`; keep custom routes"
- Phase 11 done gate: "app/ demo delegates standard paths to the core server"

**Root cause:** `HeliosRestServer` is started **inside `HeliosInstanceImpl`** automatically when
`restApiConfig.isEnabledAndNotEmpty()`. Having the app proxy requests to it means two HTTP
listeners, one forwarding to another — not production-grade.

**Fix applied:** Block 11.6 is now:

```
Delete app/src/http-server.ts entirely. HeliosRestServer (auto-started by HeliosInstanceImpl)
replaces it for all /hazelcast/* paths. No proxy. No delegation.

app/src/app.ts:
- Configure RestApiConfig: setEnabled(true), enableGroups(HEALTH_CHECK, CLUSTER_READ, DATA)
  → REST server starts with the instance automatically
- Add --rest-port CLI flag → RestApiConfig.setPort()
- Add --rest-groups CLI flag (comma-separated) → RestApiConfig.enableGroups()
- Remove the Bun.serve() block entirely

Demo-specific routes (/map/:name/query predicate DSL, /near-cache/:name/stats):
- Removed. /hazelcast/rest/maps/{name}/{key} covers CRUD.
  Predicate queries are covered by unit tests, not the demo app.

Update app/demo.sh:
- curl .../hazelcast/health/ready (health)
- curl .../hazelcast/rest/maps/{name}/{key} (data ops)
```

Phase 11 done gate updated: "app/src/http-server.ts deleted — instance uses HeliosRestServer
exclusively for /hazelcast/* via RestApiConfig."

---

## Issue 10 — Block 10.0: `nats@^2` pins a superseded package

**Symptom:** `packages/blitz/package.json` specified `nats@^2` and `BlitzService` used
`nc.jetstream()`, `nc.jetstreamManager()`, `js.views.kv()` — all removed in nats.js v3.

**Root cause:** The nats.js library reorganized into a monorepo for v3. The old `nats` monolithic
package is superseded. The modern scoped packages are:
- `@nats-io/transport-node` — TCP transport for Node/Bun; exports `connect()`
- `@nats-io/jetstream` — JetStream client; exports `jetstream(nc)`, `jetstreamManager(nc)`
- `@nats-io/kv` — KV store; exports `Kvm` (used as `new Kvm(nc)`)

**Fix applied:**

1. `packages/blitz/package.json` deps updated to:
   `@nats-io/transport-node`, `@nats-io/jetstream`, `@nats-io/kv`, `@zenystx/helios-core`

2. Package layout comment updated in the Phase 10 Package layout section.

3. Block 10.0 scaffold TODO updated to list the three scoped packages.

4. `BlitzService.connect()` description and inline code spec updated to:

```typescript
import { connect } from '@nats-io/transport-node';
import { jetstream, jetstreamManager } from '@nats-io/jetstream';
import { Kvm } from '@nats-io/kv';

// In BlitzService.connect():
const nc = await connect({ servers: config.servers });
const js = jetstream(nc);
const jsm = jetstreamManager(nc);
const kvm = new Kvm(nc);
```

5. Sink table row for `NatsSink.toStream` clarified: `` `js.publish()` from `@nats-io/jetstream` ``.

---

## Issue 11 — Block 10.2: Wire format between pipeline stages unspecified

**Symptom:** `NatsSource` produced `AsyncIterable<Msg>` with no deserialization step. The
pipeline example used `order.qty`, `order.price` as typed fields with no codec in sight.
In NATS v3, all message payloads are raw `Uint8Array` — `JSONCodec`/`StringCodec` from v2
are removed. Without a codec contract, every operator type parameter `T` resolves to `unknown`.

**Root cause:** The plan never specified how raw bytes become a typed value `T`. The v2
codec helpers were implicitly assumed but they no longer exist.

**Fix applied:**

1. Added `src/codec/BlitzCodec.ts` to the Package layout listing.

2. Defined `BlitzCodec<T>` interface and three built-in implementations in Block 10.2:

```typescript
export interface BlitzCodec<T> {
  decode(payload: Uint8Array): T;
  encode(value: T): Uint8Array;
}
export const JsonCodec   = <T>(): BlitzCodec<T>          => ({ ... });
export const StringCodec = ():    BlitzCodec<string>      => ({ ... });
export const BytesCodec  = ():    BlitzCodec<Uint8Array>  => ({ ... });
```

3. `Source<T>` interface updated to require `readonly codec: BlitzCodec<T>` and emit
   `{ value: T; ack(); nak() }` tuples (already decoded).

4. `NatsSource.fromSubject()` and `NatsSource.fromStream()` factory signatures in the plan
   updated to accept a codec as a required second/third parameter.

5. `NatsSink.toSubject()` and `NatsSink.toStream()` factory signatures updated to accept a codec.

6. Block 10.1 pipeline example updated:
```typescript
p.readFrom(NatsSource.fromSubject<Order>('orders.raw', JsonCodec<Order>()))
 .map(order => ({ ...order, total: order.qty * order.price }))
 .filter(order => order.total > 100)
 .writeTo(NatsSink.toSubject('orders.enriched', JsonCodec<EnrichedOrder>()));
```

7. Block 10.2 TODO list updated with three new items covering `BlitzCodec` implementation,
   codec parameter on all NATS sources, and codec parameter on all NATS sinks.

---

## Issue 12 — Block 10.4: NATS KV TTL is per-bucket, not per-key — WindowState leaks indefinitely

**Symptom:** `WindowState.ts` was described as "NATS KV bucket per pipeline: key=windowKey, value=accumulator[]"
with no deletion strategy. NATS KV `ttl` is set at bucket creation (`KvOptions.ttl`) — there is NO
per-entry TTL override. Every key in the bucket expires at the same time as every other key.

A pipeline might have tumbling windows of 60 s, sliding windows of 5 s, and session windows with
10-minute gaps — impossible to reconcile into one bucket TTL. Without explicit deletion, closed
window accumulators persist in KV indefinitely, growing without bound.

**Root cause:** The original design assumed NATS KV supported per-key TTL (it does not). No
`delete(windowKey)` call was specified after a window closes and emits results.

**Fix applied:**

1. `WindowState` interface now exposes `put(key, acc)`, `get(key)`, `delete(key)`, `list()` — all typed.

2. Lifecycle contract enforced by `WindowOperator`:
   - On event: `kv.put(windowKey, serialize(accumulator))`
   - On window CLOSE (emit triggered): `kv.delete(windowKey)` **after** emitting the result. If emit fails (downstream error), `kv.delete` is NOT called — window remains for retry.
   - Bucket TTL (safety backstop): `windowPolicy.maxDurationMs * 3`. Default: TumblingWindow → `size*3`, SlidingWindow → `size*3`, SessionWindow → `gapMs*6`. Catches leaked state from crashes between emit and delete.

3. `WindowOperator` spec updated: "After emitting a closed window's result, calls `windowState.delete(windowKey)`. Deletion failure is logged but does not block pipeline progress — the bucket TTL backstop will clean it up."

4. Block 10.4 TODO updated with:
   - `WindowState.delete(key)` called explicitly after every successful window emit
   - Bucket TTL set to `windowPolicy.maxDurationMs * 3` at bucket creation (safety backstop only)
   - Test: closed windows are deleted from KV after emit; leaked window keys are evicted by bucket TTL

---

## Issue 13 — Block 10.5: NATS queue groups have no key-affinity — grouped aggregations produce wrong results with parallel workers

**Symptom:** `CountAggregator.byKey(event => event.region)` was shown as producing correct
per-region counts per window with "distributed parallel workers" mapped to "NATS queue groups
(push consumer + queue subscription)".

NATS queue group semantics: messages are distributed round-robin to any available subscriber —
no key-affinity. A message for `region=APAC` goes to worker A; the next `APAC` message goes to
worker B. Each worker holds only a partial count for APAC. The plan's combiner step had no routing
mechanism ensuring all events for a given key reach the same worker, making the partial counts
uncombineable without a shuffle.

**Root cause:** Queue groups are the wrong primitive for keyed aggregation. They provide load
distribution but not the key-routing guarantee required for correct grouped state.

**Fix applied:**

1. The "Distributed parallel workers → NATS queue groups" mapping in the Phase 10 concept table is replaced with: "Subject-partitioned NATS consumers (`withParallelism(N)` → hash(key) % N routing)".

2. `Pipeline.withParallelism(n: number): this` added to the fluent API (Block 10.1 TODO). When set, events are published to subject `blitz.{pipelineName}.keyed.${Math.abs(hash(keyFn(event))) % N}`; worker `i` subscribes only to `blitz.{pipelineName}.keyed.i`. All events for the same key always reach the same worker. No combiner needed.

3. Without `withParallelism()`, the pipeline runs as a single ordered consumer — always correct for grouped aggregations at the cost of single-node throughput.

4. The combiner path for parallel partial aggregates (NATS queue group workers + merge step) is removed from Block 10.5. Key-partitioned subjects replace it entirely.

5. Block 10.5 updated with explicit warning: "Grouped aggregations (`byKey`) MUST NOT be used with plain NATS queue groups — no key-affinity, silently wrong results."

6. Block 10.5 TODO tests updated: (a) single-worker grouped aggregation correctness; (b) `withParallelism(N)` routes same-key events to the same shard across N workers.

---

## Issue 14 — Block 10.3: `NakError` referenced but never defined

**Symptom:** Block 10.3 states "Errors in `fn` surface as `NakError` and trigger the fault
policy (retry / dead-letter)." `NakError` is also imported by operator logic as a type.
The `packages/blitz/src/` package layout had no `NakError.ts`, no `errors/` directory,
and no error hierarchy anywhere in the plan. This is a day-1 compile error.

**Root cause:** The operator spec was written assuming an error hierarchy exists, but no
corresponding file spec was ever added to the package layout or block TODO list.

**Fix applied:**

1. Added `errors/` directory to the `packages/blitz/src/` package layout:
   - `BlitzError.ts` — base class for all `@zenystx/helios-blitz` errors
   - `NakError.ts` — operator returned an error; message will be nak'd
   - `DeadLetterError.ts` — retries exhausted; message routed to DL stream
   - `PipelineError.ts` — structural pipeline error (cycle, no source, etc.)

2. Added "Error types (`src/errors/`)" subsection in Phase 10 (before Block 10.0) with full
   type definitions for all four error classes.

3. Updated Block 10.3 operator description: "Errors in `fn` that extend `NakError` trigger
   the fault policy (retry / dead-letter) — see `src/errors/NakError.ts`. Other errors are
   wrapped in a `NakError` automatically. Operators should `throw new NakError(...)` for
   recoverable errors."

4. Updated Block 10.1 DAG validation TODO: "throws `PipelineError` on: cycle detected, no
   source vertex, no sink vertex, disconnected subgraph."

5. Added to Block 10.0 TODO: "Implement `src/errors/` — `BlitzError`, `NakError`,
   `DeadLetterError`, `PipelineError`"

---

## Issue 15 — Block 9.4: `TransactionExceptions.ts` imported but missing from package layout

**Symptom:** Block 9.4 `Transactional.ts` code example imports:
```typescript
import { CannotCreateTransactionException } from './TransactionExceptions';
```
The `packages/nestjs/src/` layout did not list `TransactionExceptions.ts`. The existing
`HeliosTransactionModule.ts` (191 lines) does not define `CannotCreateTransactionException`.
Block 9.4 TODOs did not include creating this file — it was invisible to an implementer.

**Root cause:** The type was referenced in a code example and in Issue 3 (this doc) but
was never given a file spec or a TODO item.

**Fix applied:**

1. Added `TransactionExceptions.ts` to the `packages/nestjs/src/` layout listing
   (after `Transactional.ts`): `# CannotCreateTransactionException (Block 9.4)`

2. Added full type definition in Block 9.4 (before the `@Transactional` decorator code
   example):
```typescript
// src/TransactionExceptions.ts
/** Thrown when @Transactional() is called outside a HeliosTransactionModule context.
 *  Indicates a misconfiguration — the module was not imported in the app module.
 *  This is always a programmer error, never a recoverable runtime error.
 *  NOTE: Does NOT extend BlitzError — @zenystx/helios-nestjs must not depend on @zenystx/helios-blitz. */
export class CannotCreateTransactionException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CannotCreateTransactionException';
  }
}
```

3. Added to Block 9.4 TODO (first item):
   `- [ ] Create src/TransactionExceptions.ts — export CannotCreateTransactionException`

Note: `TransactionExceptions.ts` in `@zenystx/helios-nestjs` does **not** extend `BlitzError` from
`@zenystx/helios-blitz`. `@zenystx/helios-nestjs` must not depend on `@zenystx/helios-blitz`. It is a standalone
`Error` subclass.

---

## Issue 16 — Block 10.9: `@nestjs/common` and `@nestjs/core` absent from `packages/blitz/package.json`

**Symptom:** `packages/blitz/package.json` was specified with only:
`deps: @nats-io/transport-node, @nats-io/jetstream, @nats-io/kv, @zenystx/helios-core`

`src/nestjs/HeliosBlitzModule.ts`, `HeliosBlitzService.ts`, and `InjectBlitz.decorator.ts`
all use NestJS decorators (`@Module`, `@Injectable`, `@Inject`, `@Global`, `DynamicModule`).
These require `@nestjs/common`. `ModuleRef` requires `@nestjs/core`. Without these declared
anywhere, the Block 10.9 implementation fails to compile on a fresh install.

Additionally, the `src/nestjs/` submodule was listed in the package layout but there was no
barrier preventing it from being re-exported through `src/index.ts`, which would force all
consumers to install `@nestjs/common` and `@nestjs/core` even when not using NestJS at all.

**Root cause:** The NestJS integration was added to the package layout without specifying
the corresponding peer dependency declarations or the subpath export boundary.

**Fix applied:**

1. `packages/blitz/package.json` updated to declare optional peer dependencies:
   ```
   peerDependencies:
     @nestjs/common: "^11"   (optional)
     @nestjs/core:   "^11"   (optional)
   peerDependenciesMeta:
     @nestjs/common: { optional: true }
     @nestjs/core:   { optional: true }
   ```

2. Package layout comment for `package.json` updated to show the full structure:
   ```
   # deps: @nats-io/transport-node, @nats-io/jetstream, @nats-io/kv, @zenystx/helios-core
   # peerDeps (optional): @nestjs/common@^11, @nestjs/core@^11
   # devDeps: nats-server (binary), bun-types, typescript
   ```

3. Added `src/nestjs/index.ts` barrel export file to the package layout listing.

4. Added `@zenystx/helios-blitz/nestjs` subpath export to the package layout exports spec:
   ```json
   "@zenystx/helios-blitz/nestjs": {
     "import": "./dist/src/nestjs/index.js",
     "types": "./dist/src/nestjs/index.d.ts"
   }
   ```

5. Explicit constraint added to package layout and Block 10.9:
   > "`src/index.ts` must NOT import from `src/nestjs/`"

6. Block 10.9 TODO list updated with:
   - "Add `@nestjs/common@^11` and `@nestjs/core@^11` as optional peer dependencies in `packages/blitz/package.json`"
   - "Export `src/nestjs/` via `@zenystx/helios-blitz/nestjs` subpath export — NOT from main barrel `src/index.ts`"
   - "Verify `src/index.ts` does NOT import or re-export anything from `src/nestjs/`"

---

## Issue 17 — Phase 10: `process.exit(0)` skip guard silently disappears from `bun test` output

**Symptom:** The Phase 10 test infrastructure section (and Issue 7's original fix) specified:
```typescript
if (!process.env.NATS_URL) {
    console.warn('Skipping NATS integration tests — set NATS_URL to run');
    process.exit(0);
}
```

**Root cause:** `bun test` behavior: a file that calls `process.exit(0)` before any tests
run registers **0 tests run, 0 failures**. The file is completely invisible in the output.
The Phase 10 done gate requires "~280 tests green" but with this skip mechanism, ALL 10
integration test files silently disappear when `NATS_URL` is unset. The done gate shows green
with 0 actual integration tests run — this is an unenforceable done gate.

This also creates a startup race condition (the original code used `Bun.sleep(200)` to wait
for the NATS server — not a reliable health check).

**Fix applied:**

1. Replaced `process.exit(0)` with `describe.skipIf(!NATS_AVAILABLE)` in the Phase 10 test
   infrastructure section of `TYPESCRIPT_PORT_PLAN.md`:

```typescript
const NATS_AVAILABLE = !!process.env.NATS_URL || !!process.env.CI;

describe.skipIf(!NATS_AVAILABLE)('BlitzService — NATS integration', () => {
  let natsServer: ReturnType<typeof Bun.spawn>;

  beforeAll(async () => {
    natsServer = Bun.spawn(
      [require.resolve('nats-server/bin/nats-server'), '-js', '-p', '4222'],
      { stdout: 'ignore', stderr: 'ignore' },
    );
    // Health poll — wait until NATS accepts connections (up to 3s)
    const { connect } = await import('@nats-io/transport-node');
    for (let i = 0; i < 30; i++) {
      try { const nc = await connect({ servers: 'nats://localhost:4222' }); await nc.close(); break; }
      catch { await Bun.sleep(100); }
    }
  });

  afterAll(() => { natsServer.kill(); });

  // tests go here
});
```

2. `describe.skipIf(condition)` is built into `bun:test`. When `!NATS_AVAILABLE`:
   - The describe block appears as SKIP in `bun test` output
   - Tests are counted in results (shows as N skipped)
   - Done gate can verify: "expect ~280 pass + N skip; never 0 total"
   - No process exit, no silent disappearance

3. Also fixes the startup race condition: health poll replaces `Bun.sleep(200)`.
   `require.resolve('nats-server/bin/nats-server')` uses the exact binary path from
   `devDependencies` instead of relying on a global `nats-server` in PATH.

4. Issue 7's fix description updated to show the `describe.skipIf` pattern instead of
   `process.exit(0)`.

---

## Issue 18 — Block 10.7: `CheckpointManager` defaults and mid-window crash replay scope unspecified

**Symptom:** Block 10.7 states `CheckpointManager` "write every N acks or T ms" but N and T
are never defined. An implementer reading only the plan cannot determine what values to use.
Additionally, no specification exists for what happens mid-window when the window accumulator
exists in KV but the checkpoint is behind the window start — how many messages replay, and
is the window state still correct after replay?

**Root cause:** The checkpoint spec was written at the intent level ("write periodically") but
never made concrete. The interaction between `CheckpointManager` sequence tracking and
`WindowState` KV keys was not specified.

**Fix applied:**

Added `CheckpointManager specification` subsection in Block 10.7 (between the file listing
and the TODO list) specifying:

1. **Default N = 100** (consecutive ack'd messages before checkpoint write)
2. **Default T = 5 000 ms** (time interval before checkpoint write — whichever fires first)
3. Both configurable via `BlitzConfig.checkpointIntervalAcks` and `BlitzConfig.checkpointIntervalMs`
4. KV key format: `checkpoint.{pipelineName}.{consumerName}`
5. KV value format: `{ sequence: number; ts: number; windowKeys: string[] }` — `windowKeys` is the set of open window KV keys at checkpoint time
6. Restart sequence: read checkpoint → seek consumer to `sequence+1` → for each `windowKey`, the KV window state bucket contains the partial accumulator → WindowOperator resumes accumulating
7. Mid-window replay scope: **at most N messages** (default 100) per consumer — bounded, predictable
8. Safety: replay is correct because accumulators are additive; for non-additive aggregations the window accumulator stores raw events

`BlitzConfig.ts` package layout comment updated to mention `checkpointIntervalAcks` and
`checkpointIntervalMs` as configuration fields.

Block 10.7 TODO updated with four new items covering implementation, KV value shape,
restart behavior, and test coverage.

---

## Issue 19 — Block 10.7: Sink error propagation contract undefined

**Symptom:** Block 10.7 specifies nak/retry/DL for operator errors but never addresses
what happens when a sink's `write()` method throws. Sinks are terminal — there is no
downstream NATS message to nak. The upstream JetStream message that triggered the
pipeline execution is still in-flight. Without an explicit contract, an implementer
might: (a) silently swallow the error and ack the upstream message (data loss),
(b) throw and crash the consumer loop, or (c) log and continue (messages silently skipped).

**Root cause:** The fault tolerance spec was written from the perspective of operators
(which have a NATS message to nak). Sinks were omitted because they are terminal and have
no obvious "message to nak" — but the upstream source message IS the message to nak.

**Fix applied:**

Added `Sink error propagation contract` subsection in Block 10.7 (after the
`CheckpointManager specification`, before the TODO list) specifying:

1. Sink `write()` throws → the **upstream JetStream source message** is nak'd
2. `RetryPolicy` applies to the entire stage chain (source → operators → sink) as a unit
3. On retry, the full pipeline chain re-executes: operators run again, sink is called again
4. After `maxRetries` exhausted: message routed to `DeadLetterSink` with `sinkName`, `errorMessage`, `deliveryCount`
5. `NatsSink.toSubject()` publish failures → wrapped as `NakError` → standard retry/DL path
6. `NatsSink.toStream()` publish ack timeout/failure → treated as `NakError` → upstream nak'd + retried
7. Pipeline either succeeds atomically or fails and retries as a unit — no partial success

Idempotency notes added to each sink in the Block 10.2 sinks table:
- `HeliosMapSink.put()` — idempotent: IMap.put() overwrites; safe to retry
- `NatsSink.toSubject()` — at-most-once publish; retry on failure wraps as NakError
- `NatsSink.toStream()` — durable; ack-based; retry on publish timeout
- `FileSink.appendLines()` — NOT idempotent: retry appends duplicates; batch mode only with dedup
- `HeliosTopicSink.publish()` — at-most-once broadcast; retry on failure wraps as NakError

Block 10.7 TODO updated with three new test items covering sink error propagation.

---

## Issue 20 — Block 10.0: NATS server unavailability during pipeline execution is unaddressed

**Symptom:** `BlitzService` only described `shutdown()` (graceful drain + close) but had no
spec for mid-execution NATS server loss. NATS clients have built-in reconnect logic, but
in-flight `js.publish()` calls during a reconnect window return errors or queue silently.
`CheckpointManager` and `WindowState` KV writes during reconnect fail silently — no contract
specified what to do in each case.

**Root cause:** The plan focused on the happy path (connect → pipeline → shutdown). Partial
failures during a reconnect window were not modeled for any of the four primitive types that
interact with NATS during pipeline execution (JetStream consumers, JetStream publishes, core
NATS publishes, KV operations).

**Fix applied:**

Added "NATS reconnect behavior" subsection in Block 10.0 (after the `BlitzService.connect()`
code block, before the TODO list) specifying:

1. **Explicit reconnect config fields** added to `BlitzConfig.ts`:
   - `maxReconnectAttempts` (default: `-1` = infinite)
   - `reconnectTimeWaitMs` (default: `2_000` ms)
   - `connectTimeoutMs` (default: `10_000` ms)
   - `natsPendingLimit` (default: 512 MB)

2. **Per-primitive reconnect behavior contract:**
   - JetStream consumers: NATS client buffers internally; no messages lost; delivery pauses and resumes
   - JetStream publishes (`NatsSink.toStream`): throws `NatsError` → caught by `BlitzService` → wrapped as `NakError` → standard retry/DL policy
   - Core NATS publishes (`NatsSink.toSubject`): NATS client buffers up to `pendingLimit`; configure `natsPendingLimit` to bound memory
   - KV operations (`CheckpointManager`, `WindowState`): throw during reconnect; `WindowState.put()` retried 3× with 500ms backoff then `NakError`; `CheckpointManager.write()` failures swallowed + logged (missed checkpoint = slightly more replay, not data loss)

3. **Status monitoring**: `BlitzService` subscribes to `nc.status()` and emits `BlitzEvent.NATS_RECONNECTING` / `BlitzEvent.NATS_RECONNECTED` for application observability.

4. **`BlitzEvent.ts`** added to package layout as `src/BlitzEvent.ts` with enum values: `NATS_RECONNECTING`, `NATS_RECONNECTED`, `PIPELINE_ERROR`, `PIPELINE_CANCELLED`.

5. Block 10.0 TODO updated with:
   - "Configure NATS connection with explicit reconnect settings (`maxReconnectAttempts`, `reconnectTimeWaitMs`, `connectTimeoutMs`)"
   - "Implement `BlitzEvent` enum: `NATS_RECONNECTING`, `NATS_RECONNECTED`, `PIPELINE_ERROR`, `PIPELINE_CANCELLED`"
   - "Subscribe to `nc.status()` in `BlitzService`; emit `BlitzEvents` on reconnect/error"
   - "Test: KV write during reconnect is retried 3× then propagates as `NakError`"
   - "Test: `BlitzEvent.NATS_RECONNECTING` fires during connection loss"

---

## Issue 21 — Block 10.7: 20 tests severely under-covers 8 behavioral axes

**Symptom:** The Block 10.7 done-line said "20 tests green". Block 10.7 covers at least
8 distinct behavioral axes: AckPolicy (explicit/none), RetryPolicy fixed delay, RetryPolicy
exponential backoff, DeadLetterSink lifecycle, CheckpointManager triggers, CheckpointManager
restart/restore, crash simulation, and sink error propagation. At 20 tests total that averages
fewer than 2.5 tests per concern — insufficient to meet the 80% coverage gate.

**Root cause:** The test list was written at the intent level ("tests: successful ack; nak
triggers redeliver; ...") without expanding each behavioral axis into discrete test cases.
High-coverage fault-tolerance testing requires testing both the happy path and every failure
mode per concern.

**Fix applied:**

1. Block 10.7 commit message / done-line updated from "20 tests green" to "35 tests green".

2. Block 10.7 TODO test list replaced with a detailed 35-minimum test list organized by concern:

   - **AckPolicy (3):** EXPLICIT success → ack once; EXPLICIT error → nak not ack; NONE → no ack/redelivery
   - **RetryPolicy fixed (3):** first retry delay; second retry delay; `maxRetries=1` on second failure → DL
   - **RetryPolicy exponential (3):** delay doubles each retry; jitter applied; `maxBackoffMs` cap enforced
   - **DeadLetterSink (4):** exhausted retries → DL with error headers; headers include original-subject + error-message + delivery-count; DL stream idempotent creation; DL stream isolated from live traffic
   - **CheckpointManager defaults (8):** checkpoint after 100th ack; checkpoint after 5000ms < 100 acks; restart seeks checkpoint.sequence+1; restart restores windowKeys from checkpoint; first startup (no KV entry) starts from beginning; missed checkpoint logged not blocking; `checkpointIntervalAcks` configurable; `checkpointIntervalMs` configurable
   - **Crash simulation (3):** crash at 50/100 → replay from last checkpoint ≤ 50 messages; window accumulator correct after restart; no duplicate window emission after restart
   - **Sink errors (3):** `HeliosMapSink` throws → nak'd → retried → success; `NatsSink.toStream` timeout → nak'd; exhausted sink retries → DL with sinkName in error headers

3. Phase 10 total test count updated: `~280 tests` → `~295 tests` (delta: +15 from raising Block 10.7 from 20 to 35).

4. Phase 10 Master Todo List entry for Block 10.7 updated from `~20 tests` to `~35 tests`.

5. Phase 10 checkpoint and footer version string updated accordingly.

---

## Issue 22 — Block 10.5: `Aggregator` name collision between `@zenystx/helios-core` and `@zenystx/helios-blitz`

**Symptom:** Block 10.5 stated "Aggregators follow the same interface as Phase 1 Block 1.4
(`src/aggregation/`). They are **reused here** — no duplicate implementations." However, the
blitz `Aggregator<T, A, R>` interface includes a `combine(a: A, b: A): A` method that does not
exist in the core batch aggregator. The two interfaces are incompatible. Claiming "reused" while
defining an incompatible superset creates a false contract that will produce compile errors.

**Root cause:** The subject-partitioned parallelism model (`withParallelism(N)` routing) does
not require a combiner — all events for a given key always reach the same worker. However,
the `combine()` method was retained in the blitz interface for scenarios where partial
accumulators from separate time periods need to be merged. The plan never specified how the
blitz aggregators relate to the core aggregators at the implementation level.

**Fix applied:**

1. The blitz `Aggregator<T, A, R>` interface is specified as a **superset** of the core batch
   aggregator — it adds exactly one method: `combine(a: A, b: A): A`. Full interface spec added
   to Block 10.5 with JSDoc for each method.

2. The six concrete aggregators in `packages/blitz/src/aggregate/` are specified as **thin
   wrappers** that:
   - Delegate `create()`, `accumulate()`, and `export()` to `@zenystx/helios-core` implementations
   - Add only `combine()` as a single new method per wrapper

3. Per-aggregator `combine()` semantics documented:
   - `CountAggregator`: `combine(a, b) = a + b`
   - `SumAggregator`: `combine(a, b) = a + b`
   - `MinAggregator`: `combine(a, b) = Math.min(a, b)`
   - `MaxAggregator`: `combine(a, b) = Math.max(a, b)`
   - `AvgAggregator`: accumulator `{ sum, count }`, `combine(a, b) = { sum: a.sum + b.sum, count: a.count + b.count }`
   - `DistinctAggregator`: accumulator `Set<T>`, `combine(a, b) = new Set([...a, ...b])`

4. The confusing "reused here" sentence replaced with the wrapper pattern description.

5. Block 10.5 TODO updated: first item is "Implement blitz aggregate wrappers that delegate to
   `@zenystx/helios-core` aggregators and add `combine()` — no business logic duplication".

6. Package layout comment for `Aggregator.ts` updated to: "extends core batch contract with
   `combine()` for parallel partial aggregation".

---

## Issue 23 — Block 10.1: At-least-once duplicate delivery undocumented as an operator contract

**Symptom:** The "What is NOT in scope" section mentions at-least-once delivery once, in the
context of exactly-once being deferred. `process()` WILL be called more than once for the same
message after a crash or nak. Without explicit documentation at the API level — JSDoc on
`Stage`, a `StageContext` with `deliveryCount`, or a test scenario — implementers will not
know this and will write non-idempotent operators that produce duplicate data on retry.

**Root cause:** The at-least-once contract was mentioned as a "not in scope" caveat rather than
surfaced as the positive guarantee it is. No API surface was provided for implementers to detect
or handle duplicate delivery.

**Fix applied:**

1. Added at-least-once JSDoc to the `Stage<T, R>` abstract class spec in Block 10.1, covering:
   - The three scenarios that trigger redelivery (crash, nak, missed heartbeat)
   - Three recommended idempotency patterns (idempotent by design, dedup key, natural idempotency)
   - Warning for non-idempotent operations

2. Added `StageContext` interface spec to Block 10.1:
   ```typescript
   export interface StageContext {
     readonly messageId: string;      // same ID = same message, possibly redelivered
     readonly deliveryCount: number;  // 1 = first delivery
     nak(delayMs?: number): void;     // explicit nak with optional delay
   }
   ```

3. Added `StageContext.ts` to the package layout (under `src/`, after `Stage.ts`).

4. Updated `Stage.ts` method signature from `process(msg)` to `process(value: T, context: StageContext)`.

5. Added `AtLeastOnceTest` to the Block 10.10 acceptance test table:
   > Simulate crash mid-pipeline → restart → verify no data loss AND dedup key prevents double-counting

6. Added a "What IS guaranteed (at-least-once)" positive statement section in the Phase 10
   introduction (after the "What is NOT in scope" section), summarising the guarantee and
   pointing to `Stage.ts` JSDoc for patterns.

7. Added Block 10.1 TODOs: implement `Stage` abstract class with at-least-once JSDoc;
   implement `StageContext` interface in `src/StageContext.ts`.

---

## Issue 24 — Block 10.9: `HeliosBlitzModule` DI pattern diverges from cache/transaction modules

**Symptom:** Block 10.9 specifies `HeliosBlitzModule` uses `ConfigurableModuleBuilder` ("same
pattern as Phase 9 Block 9.1"). The actual reference implementations `HeliosCacheModule.ts`
(213 lines) and `HeliosTransactionModule.ts` (191 lines) both use hand-rolled `register()` +
`registerAsync()` with manual `DynamicModule` — NOT `ConfigurableModuleBuilder`. Two different
patterns exist in the `@helios/*` ecosystem with no documented rationale. New contributors will
not know which pattern to follow.

**Root cause:** `HeliosCacheModule` and `HeliosTransactionModule` were implemented before
`ConfigurableModuleBuilder` was adopted as the standard in the `@helios/*` ecosystem. The
pattern divergence accumulated organically without documentation. The fix is documentation,
not code change — both patterns are correct; the choice needs to be captured.

**Fix applied:**

1. Added a rationale note in Block 10.9 (inserted before the code example), explaining:
   - `HeliosBlitzModule` uses `ConfigurableModuleBuilder` (same as `HeliosModule` Block 9.1)
   - `HeliosCacheModule` and `HeliosTransactionModule` use hand-rolled pattern — correct but
     implemented before `ConfigurableModuleBuilder` was standardized
   - **Canonical rule for new modules:** use `ConfigurableModuleBuilder`
   - Cache/transaction migration to `ConfigurableModuleBuilder` tracked as a separate future
     task, not in Phase 10 scope

2. Added a note to the Phase 9 done gate section:
   > "Note: `HeliosCacheModule` and `HeliosTransactionModule` use hand-rolled `register()`/
   > `registerAsync()`. Future migration to `ConfigurableModuleBuilder` is tracked separately."

The fix is purely documentation. No code changes required. The rationale is now available at
the point of confusion (Block 10.9) and at the reference point (Phase 9 done gate).

---

## Verification Commands

Run these after any further plan edits to confirm no regressions:

```bash
# 1. No anti-patterns remain
grep -n "delegate\|backward.compat\|deprecation shim\|one release cycle\|setCurrent(null)" \
  plans/TYPESCRIPT_PORT_PLAN.md

# 2. New types are defined
grep -n "HeliosTransactionModuleOptions\|HeliosCacheModuleOptionsFactory\|HeliosTransactionModuleOptionsFactory" \
  plans/TYPESCRIPT_PORT_PLAN.md

# 3. Block 9.0 is fully checked
grep -n -A 20 "TODO — Block 9.0" plans/TYPESCRIPT_PORT_PLAN.md | grep "\- \[ \]"
# → should return nothing

# 4. Throw-on-missing guard documented
grep -n "CannotCreateTransactionException" plans/TYPESCRIPT_PORT_PLAN.md

# 5. app/src/http-server.ts is deleted (not refactored/delegated)
grep -n "http-server.ts" plans/TYPESCRIPT_PORT_PLAN.md

# 6. NATS test infrastructure present
grep -n "NATS_URL\|nats-server" plans/TYPESCRIPT_PORT_PLAN.md

# 7. WindowState.delete() present (Issue 12)
grep -n "delete" plans/TYPESCRIPT_PORT_PLAN.md | grep -i "windowstate\|windowKey\|window.*delete\|delete.*key"

# 8. withParallelism present in Pipeline API (Issue 13)
grep -n "withParallelism" plans/TYPESCRIPT_PORT_PLAN.md

# 9. Queue groups no longer presented as the parallelism mechanism without caveat (Issue 13)
grep -n "queue group" plans/TYPESCRIPT_PORT_PLAN.md
# → should only appear in warning/caveat context, not as the primary parallel worker mechanism

# 10. Issue 12 and Issue 13 present in implementation doc
grep -n "Issue 12\|Issue 13" plans/HELIOS_BLITZ_IMPLEMENTATION.md

# 11. nats@^2 no longer present (Issue 10)
grep -n "nats@\^2" plans/TYPESCRIPT_PORT_PLAN.md plans/HELIOS_BLITZ_IMPLEMENTATION.md
# → should return nothing

# 12. BlitzCodec and JsonCodec present (Issue 11)
grep -n "BlitzCodec\|JsonCodec" plans/TYPESCRIPT_PORT_PLAN.md
# → should appear in package layout, codec contract section, and pipeline example

# 13. @nats-io/transport-node present in Block 10.0 (Issue 10)
grep -n "nats-io/transport-node" plans/TYPESCRIPT_PORT_PLAN.md

# 14. NakError.ts and errors/ directory in blitz package layout (Issue 14)
grep -n "NakError.ts\|errors/" plans/TYPESCRIPT_PORT_PLAN.md
# → should show package layout entry + Error types subsection

# 15. TransactionExceptions.ts in nestjs package layout (Issue 15)
grep -n "TransactionExceptions.ts" plans/TYPESCRIPT_PORT_PLAN.md
# → should appear in layout AND in Block 9.4 code block

# 16. CannotCreateTransactionException defined in a code block in Block 9.4 (Issue 15)
grep -n "CannotCreateTransactionException" plans/TYPESCRIPT_PORT_PLAN.md
# → should show layout + type definition + Transactional.ts usage

# 17. PipelineError in DAG validation spec (Issue 14)
grep -n "PipelineError" plans/TYPESCRIPT_PORT_PLAN.md
# → should appear in errors/ layout + Error types section + Block 10.1 TODO

# 18. @nestjs/common declared as optional peer dependency (Issue 16)
grep -n "nestjs/common\|peerDeps" plans/TYPESCRIPT_PORT_PLAN.md
# → should show in package layout + Block 10.0 comment + Block 10.9 note

# 19. @zenystx/helios-blitz/nestjs subpath export present (Issue 16)
grep -n "blitz/nestjs\|nestjs/index" plans/TYPESCRIPT_PORT_PLAN.md
# → should appear in package layout exports block

# 20. No process.exit(0) in NATS skip guard sections (Issue 17)
grep -n "process\.exit(0)" plans/TYPESCRIPT_PORT_PLAN.md
# → should return nothing (no process.exit in skip guard sections)

# 21. describe.skipIf present in test infrastructure section (Issue 17)
grep -n "describe\.skipIf\|NATS_AVAILABLE" plans/TYPESCRIPT_PORT_PLAN.md
# → should appear in Phase 10 test infrastructure section

# 22. checkpointIntervalAcks present in Block 10.7 or BlitzConfig spec (Issue 18)
grep -n "checkpointIntervalAcks\|checkpointIntervalMs" plans/TYPESCRIPT_PORT_PLAN.md
# → should appear in BlitzConfig.ts layout comment + CheckpointManager specification subsection

# 23. windowKeys present in checkpoint spec (Issue 18)
grep -n "windowKeys" plans/TYPESCRIPT_PORT_PLAN.md
# → should appear in KV value format + windowKeys description in CheckpointManager spec

# 24. Sink error propagation heading present in Block 10.7 (Issue 19)
grep -n "Sink error propagation" plans/TYPESCRIPT_PORT_PLAN.md
# → should appear as a subsection heading in Block 10.7

# 25. idempotent appears in sink descriptions (Issue 19)
grep -n "idempotent" plans/TYPESCRIPT_PORT_PLAN.md
# → should appear in Block 10.2 sink table (HeliosMapSink, FileSink rows)

# 26. Issue 18 and Issue 19 present in implementation doc
grep -n "Issue 18\|Issue 19" plans/HELIOS_BLITZ_IMPLEMENTATION.md

# 27. BlitzEvent.ts in blitz package layout (Issue 20)
grep -n "BlitzEvent" plans/TYPESCRIPT_PORT_PLAN.md
# → should appear in package layout listing + Block 10.0 TODO

# 28. maxReconnectAttempts in BlitzConfig spec and reconnect behavior subsection (Issue 20)
grep -n "maxReconnectAttempts\|reconnectTimeWait\|natsPendingLimit" plans/TYPESCRIPT_PORT_PLAN.md
# → should appear in NATS reconnect behavior subsection + BlitzConfig.ts layout comment

# 29. Block 10.7 commit message says 35 tests (Issue 21)
grep -n "fault tolerance.*35 tests\|35 tests green" plans/TYPESCRIPT_PORT_PLAN.md
# → should appear in Block 10.7 commit message

# 30. ~295 tests appears in Phase 10 introduction and master todo list (Issue 21)
grep -n "295 tests" plans/TYPESCRIPT_PORT_PLAN.md
# → should appear in Phase 10 heading + Master Todo + Phase 10 checkpoint + footer

# 31. Issue 20 and Issue 21 present in implementation doc
grep -n "Issue 20\|Issue 21" plans/HELIOS_BLITZ_IMPLEMENTATION.md

# 32. require.resolve in test infrastructure (Gap 2)
grep -n "require\.resolve" plans/TYPESCRIPT_PORT_PLAN.md
# → should appear in Phase 10 test infrastructure section (Bun.spawn with resolved binary)
