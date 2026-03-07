# Cloudflare R2 MapStore Plan

## Goal

Deliver a production-ready Cloudflare R2-backed MapStore story for Helios that uses R2 for durable
object storage behind `IMap` persistence without inventing unnecessary new core runtime semantics.

This plan starts from an important repo reality:

- Helios already ships `@zenystx/helios-s3`
- Cloudflare R2 presents an S3-compatible object storage API
- therefore, the first question is not "how do we build a brand new R2 adapter?"
- the first question is "how far can the existing S3 MapStore be proven and productized for R2?"

The plan is complete only when Helios can honestly document and test R2 support with clear
operational guidance, without claiming that R2 behaves like a database and without creating a new
adapter package unless the existing S3 path proves insufficient.

## Reference Context

Cloudflare R2 product characteristics relevant to this plan:

- distributed object storage
- S3-compatible API surface
- no egress fees called out as a core product benefit
- good fit for durable blobs/documents and object-style persistence, not relational queries

Repo surfaces relevant to this plan:

- `packages/s3/src/S3MapStore.ts`
- `packages/s3/src/S3Config.ts`
- `packages/s3/test/S3MapStore.test.ts`
- `src/map/MapStore.ts`
- `src/config/MapStoreConfig.ts`
- `src/map/impl/mapstore/MapStoreContext.ts`
- `src/map/impl/mapstore/writebehind/*`
- `README.md:455`

## Current Helios Snapshot

Helios already has an object-storage MapStore implementation in `packages/s3/`.

That implementation already supports:

- object-per-key persistence
- configurable `endpoint`
- configurable `credentials`
- configurable `prefix`
- configurable `suffix`
- default JSON serialization with custom serializer override
- `store`, `storeAll`, `delete`, `deleteAll`, `load`, `loadAll`, and `loadAllKeys`

Because R2 is S3-compatible, Helios does not need a new persistence model to support it.

What is missing today is not a theoretical integration path. What is missing is:

- explicit R2 configuration guidance
- proof that the current S3 adapter behaves correctly against R2
- documentation about R2-specific scaling and operational tradeoffs
- a product decision on whether a dedicated `@zenystx/helios-r2` package is actually warranted

## Product Decisions

### 1. Reuse the S3 MapStore first

The default product direction is:

- do not build a new core adapter first
- prove that `S3MapStore` works against Cloudflare R2
- add a dedicated R2 package only if R2-specific ergonomics or behavior materially justify it

This keeps the repo simpler and fits the actual backend contract.

### 2. R2 is object storage, not query storage

R2 support must be documented with the right expectations.

- object-per-entry persistence is a natural fit
- read-through and write-behind durability are valid use cases
- relational filtering, ad hoc queries, and row-level transactions are out of scope

### 3. Write-behind is the recommended production mode

As with other remote persistence backends, the recommended mode is:

- in-memory Helios map first
- asynchronous object persistence behind it

Write-through remains important for correctness and simpler early proof, but should not be the main
performance recommendation for remote object storage.

### 4. R2 support is proof-based, not marketing-based

Helios must not claim R2 support only because R2 says "S3-compatible".

- support means tested CRUD behavior
- support means tested pagination for key enumeration
- support means tested delete batching
- support means honest docs on object-store limitations

### 5. A dedicated package is optional, not assumed

If the existing S3 package fully covers R2 needs, the right outcome may be:

- add docs
- add compatibility tests
- add examples
- do not publish `@zenystx/helios-r2`

If a dedicated package is later added, it should be a thin ergonomic wrapper around the same object
storage behavior, not a forked runtime model.

## Implementable Target

R2 support is considered complete only when all of the following are true:

1. Helios can persist map entries to R2 through the existing S3-compatible path.
2. `store`, `storeAll`, `delete`, `deleteAll`, `load`, `loadAll`, and `loadAllKeys` all work
   correctly against R2.
3. write-through correctness is proven.
4. write-behind correctness is proven.
5. object key naming and map scoping are explicit and documented.
6. `loadAllKeys()` pagination behavior is validated against R2 semantics.
7. delete batching is validated against R2 semantics.
8. clustered owner-only external write semantics remain the same as any other Helios MapStore.
9. docs explain when R2 is a better fit than D1 and when it is not.
10. the repo has made an explicit keep-or-skip decision on a dedicated R2 package.

## Recommended Storage Model

The default persistence model for R2 should remain object-per-entry.

Recommended object naming:

- bucket: user-configured
- prefix: default to `${mapName}/`
- suffix: default to `.json`

Example object keys:

- `products/widget-123.json`
- `sessions/user-42.json`

This maps naturally to the existing `S3MapStore` implementation.

## Step-by-Step Execution Plan

### Step 1: Freeze the product stance

Write down the product decision before coding.

- R2 support starts as an S3-compatibility effort
- object-per-entry persistence is the default storage model
- write-behind is the recommended runtime mode
- no relational-query claims are made
- no dedicated package is assumed yet

Acceptance:

- this document, examples, and README language all describe the same support model

### Step 2: Prove the existing S3 adapter is structurally sufficient

Review `packages/s3/src/S3MapStore.ts` and map each method to R2 expectations.

- endpoint override support exists
- credentials wiring exists
- object listing pagination exists
- delete chunking exists
- serializer contract exists
- map-level prefix scoping already exists via factory support

Acceptance:

- there is a written compatibility checklist showing which R2 requirements are already covered

### Step 3: Define the official R2 configuration recipe

Document the exact config shape users should apply when targeting R2.

At minimum, define:

- bucket
- endpoint
- credentials
- optional prefix/suffix
- optional serializer
- recommended `MapStoreConfig` values for write delay and batch sizing

Acceptance:

- a user can configure R2 from docs alone without reverse-engineering S3 options

### Step 4: Add compatibility-focused adapter tests

Extend the S3 package test surface to cover the behaviors that matter most for R2.

- endpoint-driven client creation
- pagination through `loadAllKeys`
- delete chunking limits
- prefix and suffix mapping
- custom serializer behavior
- not-found behavior on object reads

These tests may still be mock-based at this stage, but they must target the R2 compatibility story,
not generic S3 only.

Acceptance:

- the current S3 package has explicit tests that describe R2-compatible use

### Step 5: Add a real R2 integration proof

Mocks are not enough to claim support.

Add an integration test path that runs against a real R2-compatible target.

Preferred order:

1. real Cloudflare R2 environment if CI/runtime secrets allow
2. otherwise a gated external acceptance test that can be run manually
3. optionally a local S3-compatible emulator for dev convenience, but not as the sole proof basis

Coverage must include:

- store/load/delete
- list pagination behavior
- delete batching
- write-behind flush correctness

Acceptance:

- at least one real-environment acceptance path proves the adapter works beyond mocks

### Step 6: Validate write-behind behavior specifically for object storage

R2 is a remote object store, so write-behind should be treated as a first-class performance path.

- verify `storeAll` behavior under burst writes
- verify repeated overwrites converge correctly
- verify delete-after-put and put-after-delete sequences behave correctly when flushed later
- document that remote object storage latency is hidden better by write-behind than write-through

Acceptance:

- write-behind tests show correct persisted outcomes under bursty mutation patterns

### Step 7: Validate clustered semantics without inventing R2-specific rules

R2 does not change Helios's cluster contract.

- only partition owners may issue external persistence calls
- backups must not write to R2 while acting as backups
- failover semantics remain at-least-once at the adapter boundary

If the existing clustered proof harness can be reused, use it. The point is to prove that R2 does
not accidentally reintroduce duplicate external writes through object-store integration.

Acceptance:

- clustered proof shows owner-only external writes for an R2-backed map

### Step 8: Decide whether a dedicated R2 package adds enough value

After proof exists, make an explicit product choice.

Keep only `@zenystx/helios-s3` if:

- config ergonomics are acceptable
- docs are clear
- no R2-only runtime behavior is needed

Create `@zenystx/helios-r2` only if there is real value such as:

- simpler `accountId` / endpoint derivation
- R2-specific defaults
- R2-specific docs/examples that would otherwise clutter S3 docs

If created, the R2 package should likely wrap or delegate to the S3 adapter rather than duplicate it.

Acceptance:

- repo has a documented keep-or-skip package decision with reasons

### Step 9: Add examples and operational docs

Create docs/examples that reflect actual support.

- native example showing an R2-backed map
- configuration example using write-behind
- comparison guidance: R2 vs D1 vs S3
- operational notes on object listing cost, object-count growth, and when `loadAllKeys()` may become
  expensive

Acceptance:

- users can choose R2 intentionally and know its tradeoffs before deploying

### Step 10: Update package and root documentation conservatively

If support is proven, update repo docs.

- mention R2 support through `@zenystx/helios-s3`, or through a dedicated package if one was added
- do not claim relational querying, exactly-once persistence, or database-like semantics
- explain that R2 is best for blob/document-style persistence and durable object storage patterns

Acceptance:

- root docs state only what the repo can actually test and support

## Test Plan

### Adapter compatibility tests

- endpoint config wiring
- object-key prefix/suffix mapping
- store/load/delete correctness
- serializer override behavior
- paginated `loadAllKeys`
- chunked `deleteAll`
- not-found object reads returning `null`

### Runtime integration tests

- Helios `IMap` write-through behavior against R2-compatible storage
- Helios `IMap` write-behind flush behavior
- restart recovery
- lazy load-on-miss
- optional eager preload for bounded datasets

### Clustered proof tests

- owner-only object writes
- backup no-write behavior
- failover with pending write-behind state
- replay-safe repeated persistence side effects

## R2 vs D1 Guidance

Docs for this plan should explain the difference clearly:

- choose R2 when values are naturally objects/blobs/documents and you want cheap durable object
  storage with S3-compatible access
- choose D1 when you need SQL lookups, relational filtering, or row-shaped persistence
- choose R2 when object-per-key persistence is natural and large values are expected
- choose D1 when listing/querying by fields matters more than blob storage economics

## Recommended First Milestone

The first milestone should be intentionally small:

1. prove `S3MapStore` compatibility with R2 config assumptions
2. add explicit R2 documentation
3. add one real-environment proof path
4. publish guidance on write-behind defaults

Do not start by creating a new package unless the proof work shows the existing package is not a
good fit.

## Done Criteria

This plan is done only when:

- Helios has a tested and documented R2 support story
- that story is either "use `@zenystx/helios-s3` with these settings" or a justified thin R2 wrapper
- write-through and write-behind both work
- clustered owner-only persistence semantics remain intact
- docs explain object-store tradeoffs honestly
- no new package exists unless it clearly improves the product
