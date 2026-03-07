# Clustered MapStore — Durability Scope, Failover Semantics, and Adapter Eligibility

## Durability Scope

### At-Least-Once at the Adapter Boundary

Clustered MapStore provides **at-least-once** durability at the adapter boundary:

- **Healthy cluster**: exactly one external `store`/`delete` per logical mutation. No duplicate
  writes occur because only the partition owner calls the external adapter.
- **Crash/failover**: a promoted backup may replay pending write-behind entries that the crashed
  owner already partially flushed. This means the adapter may see the same `store` call more than
  once after a crash.
- **Graceful shutdown**: the departing owner flushes all pending write-behind work before shutdown
  completes. No silent write loss occurs during graceful member departure.

### What Is NOT Guaranteed

- **Exactly-once external persistence** — not claimed. Crash during write-behind flush can cause
  at-least-once replay after failover.
- **Split-brain merge correctness** — not implemented. If the cluster partitions, both sides may
  write independently.
- **WAN replication** — not supported for MapStore.
- **Cross-cluster write coordination** — out of scope.

## Ownership Rules

### Partition Owner Is the Only External Writer

- The partition owner for a key's partition is the sole member that calls `store()`, `storeAll()`,
  `delete()`, `deleteAll()`, `load()`, `loadAll()`, and `loadAllKeys()` on the external MapStore
  adapter.
- Backup replicas receive in-memory state through replication but **never** call the external
  adapter while acting as backups.
- Non-owner members route mutations to the partition owner through the operation service.

### Write-Through vs Write-Behind

| Mode | Behavior |
|------|----------|
| **Write-through** (default, `writeDelaySeconds=0`) | External `store`/`delete` happens synchronously during the owner-side mutation. The `put`/`remove` call does not return until the external write completes. |
| **Write-behind** (`writeDelaySeconds>0`) | Mutations are queued and flushed asynchronously by the owner. Batch size and coalescing are configurable. |

### Load Behavior

| Mode | Behavior |
|------|----------|
| **LAZY** (default) | On cache miss, the partition owner calls `load()` from the external adapter. Non-owner misses route to the owner. |
| **EAGER** | On map creation, a coordinated load enumerates keys once per map and loads data onto partition owners. Backups receive data through replication. |

## Failover Semantics

### Owner Crash

1. Surviving backup is promoted to owner for the crashed member's partitions.
2. Promoted owner inherits replicated write-behind queue metadata (if write-behind is configured).
3. Promoted owner resumes pending write-behind work.
4. At-least-once: some entries may be re-flushed if the original owner partially completed a flush
   before crashing.

### Graceful Shutdown

1. Departing owner flushes all pending write-behind entries before shutdown completes.
2. Partition ownership migrates to surviving members through normal migration.
3. No silent write loss occurs during graceful shutdown.

### Migration

1. `MapContainerService` participates as a `MigrationAwareService`.
2. Map data and write-behind queue state are replicated during partition migration.
3. Destination member becomes authoritative only after migration finalization.
4. Source member demotes or clears old owner state after migration completes.

## Adapter Eligibility

### Proof-Based Cluster Safety

An adapter is considered cluster-safe **only** after it passes the clustered proof suite:

1. **CountingMapStore proof** — deterministic counting adapter proves zero duplicate writes under
   healthy two-node write-through and write-behind flows.
2. **Real adapter proof** — the adapter must pass a clustered integration suite proving:
   - Owner-only external writes (no backup writes)
   - Correct load-on-miss routing through partition owner
   - putAll/getAll bulk routing through owners
   - No duplicate documents/records under healthy cluster operations

### Currently Supported Adapters

| Adapter | Single-Node | Clustered | Notes |
|---------|-------------|-----------|-------|
| CountingMapStore (test) | ✅ | ✅ | Deterministic proof adapter |
| MongoDB (`@zenystx/helios-mongodb`) | ✅ | ✅ (gated) | Requires `HELIOS_MONGODB_TEST_URI` |

### Adapter Requirements

To qualify for clustered MapStore support, an adapter must:

1. Implement `MapStore<K, V>` with all required methods
2. Be idempotent for `store()` calls (at-least-once may replay)
3. Pass the single-node MapStore proof suite
4. Pass the clustered MapStore proof suite

### Adding a New Clustered Adapter

1. Implement `MapStore<K, V>` and optional `MapLoaderLifecycleSupport`
2. Pass single-node tests (Block 19 pattern)
3. Create a clustered integration test following the pattern in
   `packages/mongodb/test/MongoClusteredMapStore.test.ts`
4. Document the adapter's clustered support in this file

## Proof Commands

### Counting-store clustered proof

```bash
bun test test/cluster/tcp/ClusteredMapStoreProofTest.test.ts
```

### MongoDB clustered proof (requires MongoDB)

```bash
HELIOS_MONGODB_TEST_URI=mongodb://127.0.0.1:27017 bun test packages/mongodb/test/MongoClusteredMapStore.test.ts
```

### Full clustered MapStore gate

```bash
bun test test/cluster/tcp/PartitionScopedMapStoreTest.test.ts test/cluster/tcp/MapStoreMigrationTest.test.ts test/cluster/tcp/ClusteredMapStoreProofTest.test.ts
```
