# DynamoDB MapStore — Production Readiness Checklist

## Package Quality
- [x] Package builds cleanly (`bun run build`)
- [x] Package typechecks (`bun run typecheck`)
- [x] Unit tests pass (46 tests)
- [x] Edge-case coverage (empty batches, serializer failures, map isolation, etc.)

## Adapter Correctness
- [x] store / storeAll / delete / deleteAll / load / loadAll / loadAllKeys implemented
- [x] clear() — map-scoped bucket sweep
- [x] Default JSON serialization + custom serializer support
- [x] Bounded retry with exponential backoff and jitter
- [x] Request timeout via AbortController
- [x] Streaming loadAllKeys() — async generator, no buffered accumulation

## Runtime Integration
- [x] Write-through works through Helios runtime
- [x] Write-behind works through Helios runtime
- [x] Shutdown flush semantics tested
- [x] Restart recovery tested
- [x] LAZY load-on-miss tested
- [x] EAGER preload tested

## Clustered Proof
- [x] Owner-only external writes proven
- [x] Backup no-write behavior proven
- [x] Owner-only load-on-miss proven
- [x] Clustered clear — no duplicate external deletes
- [x] putAll — owner-only batched writes

## Failover/Migration
- [x] Shutdown flushes pending write-behind entries
- [x] Owner promotion after failure
- [x] Graceful shutdown handoff
- [x] Replay-safe convergence

## Observability
- [x] Metrics interface (DynamoDbMapStoreMetrics)
- [x] Operation timing, retry tracking, error reporting

## Documentation
- [x] Package README with setup, schema, config reference
- [x] Production notes and known limitations
- [x] Root README updated

## Known Limitations
- [ ] Real Scylla/Alternator integration tests require live endpoint (env-gated)
- [ ] No exactly-once external persistence
- [ ] No split-brain merge correctness
- [ ] No partial-update / CAS semantics
- [ ] bucketCount immutability not enforced via persisted metadata (trust-based)
