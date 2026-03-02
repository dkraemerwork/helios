# Helios Blitz Implementation

> **Purpose:** Implementation reference for `TYPESCRIPT_PORT_PLAN.md` — Phases 9, 10 (Blitz), and 11.  
> Documents every design decision, anti-pattern fix, and mechanism spec in the plan,
> with the exact fix applied to each block. Use this when implementing or reviewing any block.

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

**Root cause:** `@helios/nestjs` has never been published. Zero external consumers exist.
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

Strategy — Bun test lifecycle:
  const natsServer = Bun.spawn(['nats-server', '-js', '-p', '4222']);
  // tests run
  natsServer.kill();

The nats-server binary (~20MB) is added to devDependencies via the `nats-server` npm
package (wraps the binary). Document in CONTRIBUTING.md.

All integration test files must have a NATS_URL skip guard:
  if (!process.env.NATS_URL) {
      console.warn('Skipping NATS integration tests — set NATS_URL to run');
      process.exit(0);
  }

This ensures `bun test` at the workspace root never fails in environments without NATS.
CI sets NATS_URL=nats://localhost:4222.
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
   `@nats-io/transport-node`, `@nats-io/jetstream`, `@nats-io/kv`, `@helios/core`

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
```
