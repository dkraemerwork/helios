#!/usr/bin/env bash
# =============================================================================
# loop.sh — Helios Module-Batch TDD Porting Loop
#
# Usage:  ./loop.sh
#
# Strategy: ONE BLOCK per iteration (not one test).
# A block = an entire module (e.g. all of internal/util, all of map/).
#
# Each iteration invokes Claude, which:
#   1. Reads the plan
#   2. Picks the next uncompleted [ ] Block item
#   3. Batch-converts ALL Java tests for the block (converter + manual cleanup)
#   4. Verifies RED  (all tests fail before any implementation)
#   5. Reads Java source as spec
#   6. Implements the FULL TypeScript module (all source files for the block)
#   7. Verifies GREEN (all block tests pass + tsc --noEmit clean)
#   8. Marks the Block [x] in the plan + updates counts
#   9. Commits
#  10. Exits — loop re-triggers for the next Block
#
# Deferred blocks (SQL, Jet, CP, scheduledexecutor) are automatically skipped.
# Replaced blocks (tpc-engine, cloud discovery) are handled as described in the plan.
#
# Stop:  Ctrl+C
# Runtime: Bun 1.x | TypeScript: 6.0 beta | DI: NestJS 11
# =============================================================================

set -euo pipefail

ITERATION=0

ROOT="$(cd "$(dirname "$0")" && pwd)"
PLAN="$ROOT/plans/TYPESCRIPT_PORT_PLAN.md"

MAX_ITERATIONS=150
PROMPT_FILE="$(mktemp /tmp/helios-tdd-prompt.XXXXXX)"
RUN_LOG="$(mktemp /tmp/helios-tdd-run.XXXXXX)"

trap 'rm -f "$PROMPT_FILE" "$RUN_LOG"; echo ""; echo "Loop stopped after ${ITERATION:-0} iteration(s)."; exit 0' INT TERM EXIT

BUN_VER="$(bun --version 2>/dev/null || echo '1.x')"

cat > "$PROMPT_FILE" << 'ENDOFPROMPT'
You are one iteration of the Helios module-batch TDD porting loop.
Your job: complete EXACTLY ONE Block from the plan, then stop.

The unit of work is a BLOCK (an entire module), NOT a single test file.
You convert all tests for the block, implement the full module, get everything green, commit.

══════════════════════════════════════════════════════════
PROJECT: HELIOS
══════════════════════════════════════════════════════════
Root           : %%ROOT%%
Plan           : %%PLAN%%
Runtime        : Bun %%BUN_VER%%
TypeScript     : 6.0 beta (typescript@beta)
DI framework   : NestJS 11 (Spring → NestJS — see mapping table in the plan)
Import alias   : @helios/<path>  resolves to  %%ROOT%%/src/<path>

Project root already contains:
  - package.json / tsconfig.json / bunfig.toml  (Bun + NestJS 11 configured)
  - scripts/convert-java-tests.ts               (run with: bun)
  - node_modules/ installed (bun install already done)
  - app/          — demo application (HTTP + near-cache + predicates)
  - packages/nestjs/ — @helios/nestjs NestJS integration package
  - packages/blitz/  — @helios/blitz NATS-backed stream processing (Phase 10)

══════════════════════════════════════════════════════════
PRIMARY GOAL
══════════════════════════════════════════════════════════
The end goal is a production-ready Helios with full near cache support.
Near cache is the client-side read cache that eliminates cluster round-trips for hot data.
Blocks marked ⭐ in the plan are critical path for this goal — do not skip or stub them.
  Block 3.12a — internal/nearcache storage/runtime core (TTL, eviction, record stores)
  Block 3.12b — shared near-cache invalidation + repair internals (metadata, repairing, stale-read)
  Block 3.13a — server local near-cache integration (MapNearCacheManager, NearCachedMapProxyImpl)
  Block 4.4  — near-cache migration metadata + metadata fetch surfaces
  Block 5.1  — client near cache proxies + invalidation listener codecs
  Block 5.2  — invalidation anti-entropy internals (RepairingTask/metadata reconciliation)
  Block 5.3  — end-to-end near cache production-flow acceptance tests

══════════════════════════════════════════════════════════
SCOPE — READ BEFORE PICKING A BLOCK
══════════════════════════════════════════════════════════

DEFERRED (skip if you encounter these blocks — mark SKIP and pick the next):
  - hazelcast-sql / SQL engine  →  deferred to v2 (requires porting Apache Calcite)
  - jet/ (Java DAG engine)      →  REPLACED by @helios/blitz (Phase 10, NOT deferred)
  - cp / Raft CP subsystem      →  deferred to v2
  - scheduledexecutor           →  deferred to v2

REPLACED (do NOT convert Java files — write TypeScript from scratch):
  - hazelcast-tpc-engine  →  Write Bun-native Eventloop.ts adapter from scratch (no Java line-by-line port).
                             Preserve protocol-facing behavior: frame compatibility, ordering, bounded buffering,
                             explicit backpressure behavior. Do not convert Java TPC thread tests directly.
  - aws/azure/gcp/kubernetes cloud discovery  →  Write HeliosDiscovery.ts (~100 lines)
                             using fetch() + env vars. Do not convert Java discovery tests.

DROPPED (never port — skip any block referencing these):
  osgi, console, auditlog, hotrestart, persistence, crdt, wan, vector,
  durableexecutor, flakeidgen, dataconnection

PHASE 10 — @helios/blitz (NOT deferred):
  Phase 10 blocks (10.0–10.10) build @helios/blitz, a TypeScript-first NATS-backed
  stream processing engine in packages/blitz/. This REPLACES the deferred Java jet/
  module. These blocks are IN SCOPE — do NOT skip them as deferred.
  Source: packages/blitz/src/     Tests: packages/blitz/test/
  No Java test conversion — write TypeScript tests from the plan spec.

PHASE 13 — Infrastructure Fixes (NOT new features):
  Phase 13 blocks (13.1, 13.2) fix broken infrastructure — no new source files, no Java
  conversion, no test pattern gating. These are pure config/test-hygiene fixes.
  Block 13.1: add reflect-metadata to packages/blitz devDependencies + run bun install.
  Block 13.2: suppress CheckpointManager log leak in FaultToleranceTest so root bun test shows 0 errors.
  Gate for BOTH: cd %%ROOT%% && bun test → 0 fail, 0 error.
  Gate for 13.1 additionally: cd %%ROOT%%/packages/blitz && bun test → 0 errors, all NestJS tests green.
  No GATE-CHECK required gate count > 0 for Phase 13 blocks — emit GATE-CHECK: block=13.1 required=0 passed=0 labels=infrastructure-fix.

PHASE 14 — Blitz Embedded NATS Server (NOT deferred):
  Phase 14 blocks (14.1–14.5) embed a NATS JetStream server natively inside @helios/blitz.
  This eliminates the need for external NATS provisioning for single-node and cluster use.
  Source: packages/blitz/src/server/     Tests: packages/blitz/test/server/
  No Java test conversion — read `%%ROOT%%/plans/BLITZ_EMBEDDED_NATS_PLAN.md` as spec.
  Block 14.1: promote nats-server from devDep → dep + NatsServerBinaryResolver.
  Block 14.2: NatsServerConfig + NatsServerManager (spawn + health-poll + shutdown).
  Block 14.3: BlitzConfig extensions (EmbeddedNatsConfig, NatsClusterConfig).
  Block 14.4: BlitzService.start() static factory + shutdown() extension.
  Block 14.5: Remove skipIf guards from all 4 blitz integration test files.
  Gate: cd %%ROOT%%/packages/blitz && bun test → 0 skip, 0 fail.

PHASE 15 — Production SerializationServiceImpl (NOT deferred):
  Phase 15 blocks (15.1–15.5) replace TestSerializationService with a production-grade
  SerializationServiceImpl supporting all built-in typeIds, BufferPool, DataSerializerHooks,
  and writeObject/readObject. Primary spec: %%ROOT%%/plans/SERIALIZATION_SERVICE_IMPL_PLAN.md
  Source: %%ROOT%%/src/internal/serialization/impl/
  Tests:  %%ROOT%%/test/internal/serialization/impl/
  No Java test conversion — author TypeScript tests from the plan spec.
  Block 15.1: HazelcastSerializationError + SerializerAdapter + DataSerializerHook + SerializationConfig + BufferPool.
  Block 15.2: All 21 built-in serializers (primitive, array, UUID, JavaScriptJson).
  Block 15.3: DataSerializableSerializer (typeId -2, IDS dispatch, factory registry).
  Block 15.4: SerializationServiceImpl (dispatch chain, toData/toObject/writeObject/readObject, BufferPool wiring).
  Block 15.5: Wire SerializationServiceImpl into HeliosInstanceImpl + full regression (0 fail, 0 error).
  CRITICAL FIXES to implement (see plan for full detail):
    - Block 15.2 UuidSerializer.read(): use BigInt.asUintN(64, value).toString(16) — NOT signed bigint hex
    - Block 15.2 JavaScriptJsonSerializer.write(): check json===undefined after JSON.stringify (functions/Symbols return undefined, not throw)
    - Block 15.4 dispatch step 7: use Buffer.isBuffer(obj) NOT instanceof Uint8Array
    - Block 15.4 readObject(): implement useBigEndianForTypeId parameter
    - Block 15.5: store ss as private field, call this._ss.destroy() in shutdown()

Important scope clarification:
  - Legacy Java `hazelcast/extensions/*` modules remain dropped.
  - Phase 12 extension packages in this repo are IN SCOPE: `packages/s3`, `packages/mongodb`, `packages/turso`.

══════════════════════════════════════════════════════════
YOUR STEPS — execute all in order
══════════════════════════════════════════════════════════

STEP 1 — READ THE PLAN
  Read %%PLAN%% in full.
  Go to the Master Todo List section.
  If a phase header in Master Todo List is marked with '← **CURRENT**', select the first
  '- [ ] **Block ...' under that CURRENT phase section.
  If no CURRENT marker exists (or no unchecked block remains in that section),
  find the FIRST line starting with '- [ ] **Block' (not checkpoint lines).
  If it already has '(BLOCKED: ...)', re-check whether the blocker is now resolved.
  Keep blocked entries in the same canonical form so they stay selectable/revisitable:
    - [ ] **Block X.Y** (BLOCKED: <reason>)
  Check if it is deferred or dropped (see SCOPE above).
  If it is → mark it:  - [~] **Block X.Y** (SKIPPED: deferred/dropped)
  and find the next non-skipped [ ] Block. If still blocked, keep/refresh BLOCKED reason and pick the next [ ] **Block ...** line.
  The target is the first [ ] **Block** that is not currently blocked.

STEP 2 — IDENTIFY ALL FILES FOR THE BLOCK
  From the block description in the plan, determine:
    a) ALL Java test files for this block (not just one — the entire module)
    b) ALL Java source files needed to make those tests pass
    c) Where TypeScript tests go:   %%ROOT%%/test/<path>/
    d) Where TypeScript source goes: %%ROOT%%/src/<path>/

  For Phase 13 blocks (`13.1`, `13.2`):
    - These are INFRASTRUCTURE FIX blocks — no Java source, no test conversion, no new source files.
    - Block 13.1: edit `packages/blitz/package.json` devDependencies, run `bun install`, verify.
    - Block 13.2: find and suppress the console.warn leak in `packages/blitz/test/FaultToleranceTest.test.ts`.
    - Gate: `cd %%ROOT%% && bun test` must show `0 fail 0 error`.
    - Block 13.1 additional gate: `cd %%ROOT%%/packages/blitz && bun test` must show no `preload not found`.
    - Emit GATE-CHECK: block=<id> required=0 passed=0 labels=infrastructure-fix

  For Phase 14 blocks (`14.1`–`14.5`):
    - Read `%%ROOT%%/plans/BLITZ_EMBEDDED_NATS_PLAN.md` as the source-of-truth spec.
    - Source goes in: %%ROOT%%/packages/blitz/src/server/
    - Tests go in:   %%ROOT%%/packages/blitz/test/server/
    - No Java test conversion — author TypeScript tests from the plan spec.
    - Treat work as TypeScript-first embedded NATS server implementation.

  For Phase 15 blocks (`15.1`–`15.5`):
    - Read `%%ROOT%%/plans/SERIALIZATION_SERVICE_IMPL_PLAN.md` as the source-of-truth spec.
    - Source goes in: %%ROOT%%/src/internal/serialization/impl/
    - Tests go in:   %%ROOT%%/test/internal/serialization/impl/
    - No Java test conversion — author TypeScript tests from the plan spec.
    - Treat as TypeScript-first serialization implementation (no Java conversion).
    - MUST implement all Round-3 critical fixes verbatim as specified in the plan:
        * UuidSerializer.read(): BigInt.asUintN(64, val).toString(16) (NOT signed .toString(16))
        * JavaScriptJsonSerializer.write(): undefined check after JSON.stringify + before Buffer.from()
        * serializerFor() step 7: Buffer.isBuffer(obj) NOT instanceof Uint8Array
        * readObject(): useBigEndianForTypeId parameter
        * HeliosInstanceImpl: store ss as field, call this._ss.destroy() in shutdown()

  For Phase 12 blocks (`12.A1`, `12.A2`, `12.A3`, `12.B`, `12.C`, `12.D`):
    - Read `%%ROOT%%/plans/MAPSTORE_EXTENSION_PLAN.md` as the source-of-truth spec.
    - Treat work as TypeScript-first in this repo (no Java test conversion requirement).
    - Keep `%%PLAN%%` and `MAPSTORE_EXTENSION_PLAN.md` terminology aligned when updating status text.

  For Phase 10 blocks (`10.0`–`10.10`):
    - Read `%%PLAN%%` Phase 10 section + `%%ROOT%%/plans/HELIOS_BLITZ_IMPLEMENTATION.md` as spec.
    - Source goes in: %%ROOT%%/packages/blitz/src/
    - Tests go in:   %%ROOT%%/packages/blitz/test/
    - No Java test conversion — write TypeScript tests from the plan spec.

  For REPLACED blocks (TPC engine, cloud discovery):
    - Identify what the replacement should do (from plan description)
    - You will write TypeScript from scratch, not convert Java files

  For Phase 6 / NestJS blocks, also determine:
    - Which Spring annotations map to which NestJS equivalents (see mapping table in plan)
    - Which tests need @nestjs/testing Test.createTestingModule()
    - That jest.mock/spyOn/fn must be replaced with bun:test equivalents (see below)

STEP 3 — CONVERT ALL TESTS FOR THE BLOCK
  For Phase 12 blocks:
    - Do NOT run `scripts/convert-java-tests.ts`.
    - Author TypeScript tests directly from `plans/MAPSTORE_EXTENSION_PLAN.md` expectations.
    - Ensure tests compile, then run RED before implementation.

  For Phase 10 blocks:
    - Do NOT run `scripts/convert-java-tests.ts`.
    - Author TypeScript tests directly from `plans/TYPESCRIPT_PORT_PLAN.md` Phase 10 block specs
      and `plans/HELIOS_BLITZ_IMPLEMENTATION.md`.
    - Ensure tests compile, then run RED before implementation.

  For Phase 14 blocks:
    - Do NOT run `scripts/convert-java-tests.ts`.
    - Author TypeScript tests directly from `plans/TYPESCRIPT_PORT_PLAN.md` Phase 14 block specs
      and `plans/BLITZ_EMBEDDED_NATS_PLAN.md`.
    - Tests go in `%%ROOT%%/packages/blitz/test/server/` — create directory if missing.
    - Ensure tests compile, then run RED before implementation.

  For Phase 15 blocks:
    - Do NOT run `scripts/convert-java-tests.ts`.
    - Author TypeScript tests directly from `plans/TYPESCRIPT_PORT_PLAN.md` Phase 15 block specs
      and `plans/SERIALIZATION_SERVICE_IMPL_PLAN.md`.
    - Tests go in `%%ROOT%%/test/internal/serialization/impl/` — create directory if missing.
    - Ensure tests compile, then run RED before implementation.
    - Include the mandatory new tests from the plan's Implementation Order section step 14.

  For standard blocks, batch-convert using the converter:

    cd %%ROOT%%
    bun run scripts/convert-java-tests.ts \
      --src <java-test-dir-for-this-block> \
      --out %%ROOT%%/test/<module>

  Then clean up ALL generated files:
    - Fix import paths to use @helios/<path> alias (NOT com/hazelcast/<path>)
    - Fix Java syntax the converter missed (anonymous classes, multi-catch, wildcards)
    - Replace any assertXxx() the converter missed with expect() equivalents
    - For NestJS/Spring tests replace:
        @RunWith / @ContextConfiguration
        → const module = await Test.createTestingModule({ imports: [HeliosModule] }).compile()
    - Replace Jest-only APIs with Bun equivalents:
        jest.mock(...)          → mock(...)     from 'bun:test'
        jest.spyOn(obj, 'fn')   → spyOn(obj, 'fn')  from 'bun:test'
        jest.fn()               → mock(() => {})  from 'bun:test'
        jest.resetAllMocks()    → mock.restore()
    - Every test file must be valid TypeScript before proceeding

  For REPLACED blocks (TPC engine, cloud discovery):
    Write new TypeScript tests from scratch that test the replacement API.

STEP 4 — VERIFY RED
  Run all tests for this block:

    cd %%ROOT%% && bun test --pattern '<block-pattern>' 2>&1

  Expected: "Cannot find module", missing class, type errors, assertion failures.
  Every test must FAIL at this point.
  If any test passes before implementation — stop, something is wrong, report it.

STEP 5 — READ THE JAVA SOURCE
  Read every Java source file for this block.
  These are your spec. Understand every public method, exception, edge case, invariant.
  For REPLACED blocks, understand the intent, not the implementation.
  For Phase 12 blocks, use `plans/MAPSTORE_EXTENSION_PLAN.md` + current TypeScript code as primary spec
  (consult listed Java references only where needed for behavioral parity).
  For Phase 10 blocks, use `plans/TYPESCRIPT_PORT_PLAN.md` Phase 10 section +
  `plans/HELIOS_BLITZ_IMPLEMENTATION.md` as the authoritative spec.
  No Java source to read — this is a TypeScript-first implementation.

STEP 6 — IMPLEMENT THE FULL TYPESCRIPT MODULE
  Create all %%ROOT%%/src/<path>/<Name>.ts files for the block.
  For Phase 10 blocks, create files in %%ROOT%%/packages/blitz/src/<path>/<Name>.ts (NOT %%ROOT%%/src/).

  Type-mapping rules:
    long / int / short / byte / double / float  →  number
    long for sequence IDs or overflow-sensitive  →  bigint
    String                                       →  string
    byte[]                                       →  Buffer
    java.time.Instant / Duration                 →  TimeSource/Clock abstractions (Temporal when available, fallback otherwise)
    CompletableFuture<T>                         →  Promise<T>
    computeIfAbsent(key, fn)                     →  map.getOrInsertComputed(key, fn)  (ES2025)
    synchronized / volatile / AtomicXxx          →  plain field/number  (Bun is single-threaded)
    final local var                              →  const
    final field                                  →  readonly
    throws XxxException                          →  remove; add @throws JSDoc
    new HashSet<>() / Sets.union()               →  new Set<>() / setA.union(setB)  (ES2025)
    TTL / time-based logic                       →  TimeSource/Clock only (no direct Temporal.now.* in runtime paths)

  Naming conventions (TypeScript target = Helios branding):
    HazelcastInstance  →  HeliosInstance
    HazelcastModule    →  HeliosModule
    HazelcastClient    →  HeliosClient
    HazelcastException →  HeliosException
    (any Hazelcast-prefixed class in the TypeScript output becomes Helios-prefixed)
    Java source class names in comments/JSDoc keep original names.

  For NestJS / Spring classes:
    @Service/@Component  →  @Injectable()
    @Autowired           →  constructor injection
    @Bean in @Configuration  →  provider in @Module({ providers: [...] })
    ApplicationContext   →  ModuleRef from @nestjs/core
    @Transactional       →  custom @Transactional() decorator
    Spring Boot autoconfiguration  →  @Global() DynamicModule.forRoot()
    Spring Boot 3 is EXCLUDED — Boot 4 only.
    Add reflect-metadata import only if not already preloaded (bunfig.toml preloads it).

  Only implement what the block's tests require. No speculative code.
  Keep implementations minimal but complete and correct.

STEP 7 — VERIFY GREEN
  Determine BLOCK_ID from the selected plan item (e.g., 3.12a, 4.4, 5.1).

  Run block-default tests first:

    cd %%ROOT%% && bun test --pattern '<block-pattern>' 2>&1

  For near-cache critical blocks, run additional required gates:
    3.12a:
      - bun test --pattern 'internal/nearcache|NearCache(Manager|RecordStore|Stats|Preloader)' 2>&1
      - bun test --pattern 'NearCache(Test|RecordStoreTest|StatsImplTest)' 2>&1
    3.12b:
      - bun test --pattern 'Invalidator|MetaDataGenerator|Repairing(Task|Handler)|StaleReadDetector' 2>&1
      - bun test --pattern 'InvalidationMetaDataFetcher|MetaDataContainer|BatchInvalidator|NonStopInvalidator' 2>&1
    3.13a:
      - bun test --pattern 'map/impl/nearcache|MapNearCacheManager|NearCachedMapProxyImpl' 2>&1
      - bun test --pattern 'MapNearCache(Invalidation|Staleness|StaleRead|LocalInvalidation)' 2>&1
    4.4:
      - bun test --pattern 'MapNearCacheStateHolder|CacheNearCacheStateHolder' 2>&1
      - bun test --pattern 'FetchNearCacheInvalidationMetadata(Task|Codec)|metadata.*partition' 2>&1
    5.0:
      - bun test --pattern 'MapAddNearCacheInvalidationListener|CacheAddNearCacheInvalidationListener|ReplicatedMapAddNearCache' 2>&1
      - bun test --pattern 'MapFetchNearCacheInvalidationMetadata|CacheFetchNearCacheInvalidationMetadata' 2>&1
    5.1:
      - bun test --pattern 'NearCachedClient(Map|Cache)Proxy|Client(Map|Cache|ReplicatedMap)NearCache' 2>&1
      - bun test --pattern 'NearCacheMetricsProvider|NearCacheIsNotShared|ClientNearCacheConfig' 2>&1
    5.2:
      - bun test --pattern 'Repairing(Task|Handler)|StaleReadDetector|MetaDataGenerator' 2>&1
      - bun test --pattern 'MapInvalidationMetaDataFetcher|CacheInvalidationMetaDataFetcher|anti-entropy|stale-read' 2>&1
    5.3:
      - bun test --pattern 'nearcache.*(e2e|acceptance|production-flow)|ClientNearCache.*Acceptance' 2>&1

  For Phase 10 (@helios/blitz) blocks, run tests from the packages/blitz/ directory:
    10.0: bun test --pattern 'BlitzService|BlitzConfig|connect' 2>&1
    10.1: bun test --pattern 'Pipeline|Vertex|Edge|Stage|DAG' 2>&1
    10.2: bun test --pattern 'source|sink|Source|Sink|Codec' 2>&1
    10.3: bun test --pattern 'operator|MapOperator|Filter|FlatMap|Merge|Branch|Peek' 2>&1
    10.4: bun test --pattern 'window|Window|WindowState|WindowOperator' 2>&1
    10.5: bun test --pattern 'aggregate|Aggregat|AggregatingOperator' 2>&1
    10.6: bun test --pattern 'join|HashJoin|WindowedJoin' 2>&1
    10.7: bun test --pattern 'fault|Ack|Retry|DeadLetter|Checkpoint' 2>&1
    10.8: bun test --pattern 'batch|Batch|EndOfStream' 2>&1
    10.9: bun test --pattern 'nestjs|BlitzModule|BlitzService|InjectBlitz' 2>&1
    10.10: bun test --pattern 'e2e|acceptance|parity' 2>&1

  Run from: cd %%ROOT%%/packages/blitz && bun test --pattern '<pattern>' 2>&1
  Then also run from root to ensure no regressions:
    cd %%ROOT%% && bun run tsc --noEmit 2>&1

  For Phase 13 (infrastructure-fix) blocks, run:
    13.1: cd %%ROOT%%/packages/blitz && bun test 2>&1   (must show 0 errors, no "preload not found")
          cd %%ROOT%% && bun test 2>&1                  (must show 0 fail, 0 error)
    13.2: cd %%ROOT%% && bun test 2>&1                  (must show 0 fail, 0 error)
    Phase 13 blocks emit: GATE-CHECK: block=<id> required=0 passed=0 labels=infrastructure-fix
    (required=0 is valid for infra-fix blocks — the loop accepts passed==required==0 as green)

  For Phase 15 (SerializationServiceImpl) blocks, run from root:
    15.1: bun test test/internal/serialization/impl/BufferPoolTest.test.ts 2>&1
    15.2: bun test test/internal/serialization/impl/SerializerPrimitivesTest.test.ts 2>&1
    15.3: bun test test/internal/serialization/impl/DataSerializableSerializerTest.test.ts 2>&1
    15.4: bun test test/internal/serialization/impl/ 2>&1
    15.5: bun test 2>&1   (full regression — exit code 0, 0 fail, 0 error required)
    Then always: bun run tsc --noEmit 2>&1
    Block 15.5 gate criterion: exit code 0 (do NOT hardcode a test count — the count grows
    as Phase 14 + Phase 15 add tests; the authoritative gate is the exit code being 0).

  Gate rules:
    - Every required gate command must pass.
    - Every required gate command must execute non-zero tests (EXCEPT Phase 13 infra-fix blocks where required=0 is valid).
    - Any missing or failed required gate means NOT GREEN.

  ALL required gates must pass. Fix → re-run → repeat until fully green.
  Then typecheck the entire project:

    cd %%ROOT%% && bun run tsc --noEmit 2>&1

  Fix ALL type errors before continuing. Zero tolerance — clean typecheck required.

STEP 8 — UPDATE THE PLAN
  In %%PLAN%%:
    a) In the per-phase checklist: change  - [ ] (block item)  →  - [x] (block item)
    b) In the Master Todo List:    change  - [ ] **Block X.Y**  →  - [x] **Block X.Y**
    c) Update the "Tests already ported & green" counter (add the number of tests just greened)
    d) Update the "Tests remaining" counter (subtract the same number)

  For Phase 12 blocks, also keep `plans/MAPSTORE_EXTENSION_PLAN.md` status/count text in sync
  with what was actually completed in the iteration.

STEP 9 — COMMIT AND STOP
    git -C %%ROOT%% add -A
    git -C %%ROOT%% commit -m "feat(<module>): <BlockName> — <N> tests green"

  Print two lines:
    ✅  <BlockName>  —  <N> tests green
    GATE-CHECK: block=<BLOCK_ID> required=<N> passed=<N> labels=<label1,label2,...>

  Then STOP. Do not pick another block. The loop will restart for the next one.

══════════════════════════════════════════════════════════
RULES — non-negotiable
══════════════════════════════════════════════════════════
- One Block per iteration. Exactly one. No more.
- Process the ENTIRE block — all tests, all source files — not just one test.
- Never skip RED — all tests must fail before writing any source.
- Never modify Java source files under %%ROOT%%/hazelcast* (read-only spec).
- bun run tsc --noEmit must be clean before committing.
- Use @helios/* import alias, NOT com/hazelcast/*.
- Deferred blocks (SQL, Jet, CP, scheduledexecutor): mark [~] SKIPPED, move to next.
- Dropped packages (osgi, wan, crdt, etc.): if a block references only dropped code, mark [~] DROPPED.
- Legacy Java `hazelcast/extensions/*` is dropped, but Phase 12 repo packages (`packages/s3`, `packages/mongodb`, `packages/turso`) are valid in-scope targets.
- Replaced blocks (tpc-engine, cloud discovery): write TypeScript from scratch, do not convert Java.
- If a block is BLOCKED on unimplemented infrastructure: mark - [ ] **Block X.Y** (BLOCKED: reason)
  and pick the next non-blocked [ ] **Block**.
- If you cannot determine what to do: print one error line and stop. The loop will retry.
ENDOFPROMPT

# Substitute all %%TOKEN%% placeholders (GNU/BSD sed compatible)
if [[ "$(uname -s)" == "Darwin" ]]; then
  sed -i '' \
    -e "s|%%ROOT%%|$ROOT|g" \
    -e "s|%%PLAN%%|$PLAN|g" \
    -e "s|%%BUN_VER%%|$BUN_VER|g" \
    "$PROMPT_FILE"
else
  sed -i \
    -e "s|%%ROOT%%|$ROOT|g" \
    -e "s|%%PLAN%%|$PLAN|g" \
    -e "s|%%BUN_VER%%|$BUN_VER|g" \
    "$PROMPT_FILE"
fi

# ── Main loop ─────────────────────────────────────────────────────────────────
for ITERATION in $(seq 1 $MAX_ITERATIONS); do

  echo ""
  echo "╔══════════════════════════════════════════════════════════════════════╗"
  printf  "║  Helios TDD  ·  Block %-4s / %-4s  ·  %-25s  ║\n" \
          "$ITERATION" "$MAX_ITERATIONS" "$(date '+%H:%M:%S %Y-%m-%d')"
  echo "╚══════════════════════════════════════════════════════════════════════╝"
  echo ""

  claude \
    --dangerously-skip-permissions \
    -p "$(cat "$PROMPT_FILE")" \
  | tee "$RUN_LOG" \
  || {
    EXIT_CODE=$?
    echo ""
    echo "  Block $ITERATION exited with code $EXIT_CODE. Retrying in 15s..."
    sleep 15
    continue
  }

  GATE_LINE="$(grep '^GATE-CHECK:' "$RUN_LOG" | tail -n 1 || true)"
  if [[ -z "$GATE_LINE" ]]; then
    echo ""
    echo "  Block $ITERATION missing GATE-CHECK line. Retrying in 15s..."
    sleep 15
    continue
  fi

  if [[ "$GATE_LINE" =~ required=([0-9]+)[[:space:]]+passed=([0-9]+) ]]; then
    REQUIRED="${BASH_REMATCH[1]}"
    PASSED="${BASH_REMATCH[2]}"
    # required=0 passed=0 is valid for Phase 13 infrastructure-fix blocks
    if (( PASSED < REQUIRED )); then
      echo ""
      echo "  Block $ITERATION gate failure (required=$REQUIRED passed=$PASSED). Retrying in 15s..."
      sleep 15
      continue
    fi
  else
    echo ""
    echo "  Block $ITERATION malformed GATE-CHECK line. Retrying in 15s..."
    sleep 15
    continue
  fi

  echo ""
  echo "  Block $ITERATION complete. Starting next..."
  sleep 2

done

echo ""
echo "════════════════════════════════════════════════════════════════════════"
echo "  Loop finished — $MAX_ITERATIONS blocks processed."
echo "  Run ./loop.sh again to continue from where the plan left off."
echo "════════════════════════════════════════════════════════════════════════"
