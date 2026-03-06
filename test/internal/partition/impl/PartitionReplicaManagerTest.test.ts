/**
 * Tests for PartitionReplicaManager (Block 16.E1).
 *
 * Port of {@code com.hazelcast.internal.partition.impl.PartitionReplicaManager} behavior.
 * Simplified to per-partition version tracking (not per-namespace) per Finding 21.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { PartitionReplicaManager, REQUIRES_SYNC } from '@zenystx/core/internal/partition/impl/PartitionReplicaManager';
import { MAX_REPLICA_COUNT } from '@zenystx/core/internal/partition/InternalPartition';

describe('PartitionReplicaManager', () => {
    const PARTITION_COUNT = 271;
    const MAX_PARALLEL_REPLICATIONS = 5;
    let manager: PartitionReplicaManager;

    beforeEach(() => {
        manager = new PartitionReplicaManager(PARTITION_COUNT, MAX_PARALLEL_REPLICATIONS);
    });

    // ── incrementPartitionReplicaVersions ──

    test('incrementPartitionReplicaVersions returns array of MAX_REPLICA_COUNT', () => {
        const versions = manager.incrementPartitionReplicaVersions(0, 1);
        expect(versions).toHaveLength(MAX_REPLICA_COUNT);
    });

    test('incrementPartitionReplicaVersions increments backup indices only', () => {
        const versions = manager.incrementPartitionReplicaVersions(0, 2);
        // Index 0 (primary) stays 0, indices 1 and 2 become 1
        expect(versions[0]).toBe(0n);
        expect(versions[1]).toBe(1n);
        expect(versions[2]).toBe(1n);
        // Indices beyond backupCount stay 0
        expect(versions[3]).toBe(0n);
    });

    test('incrementPartitionReplicaVersions accumulates across calls', () => {
        manager.incrementPartitionReplicaVersions(5, 1);
        manager.incrementPartitionReplicaVersions(5, 1);
        const versions = manager.incrementPartitionReplicaVersions(5, 1);
        expect(versions[1]).toBe(3n);
    });

    test('incrementPartitionReplicaVersions for different partitions are independent', () => {
        manager.incrementPartitionReplicaVersions(0, 1);
        manager.incrementPartitionReplicaVersions(0, 1);
        const v0 = manager.incrementPartitionReplicaVersions(0, 1);
        const v1 = manager.incrementPartitionReplicaVersions(1, 1);
        expect(v0[1]).toBe(3n);
        expect(v1[1]).toBe(1n);
    });

    // ── isPartitionReplicaVersionStale ──

    test('isPartitionReplicaVersionStale returns false for matching versions', () => {
        const versions = manager.incrementPartitionReplicaVersions(0, 2);
        expect(manager.isPartitionReplicaVersionStale(0, versions, 1)).toBe(false);
    });

    test('isPartitionReplicaVersionStale returns true for old versions', () => {
        const oldVersions = [...manager.incrementPartitionReplicaVersions(0, 2)];
        // Increment again — now stored versions are ahead
        manager.incrementPartitionReplicaVersions(0, 2);
        expect(manager.isPartitionReplicaVersionStale(0, oldVersions, 1)).toBe(true);
    });

    test('isPartitionReplicaVersionStale returns false for fresh partition', () => {
        const versions = new Array(MAX_REPLICA_COUNT).fill(0n) as bigint[];
        expect(manager.isPartitionReplicaVersionStale(10, versions, 1)).toBe(false);
    });

    // ── updatePartitionReplicaVersions ──

    test('updatePartitionReplicaVersions sets versions from incoming', () => {
        const incoming = new Array(MAX_REPLICA_COUNT).fill(0n) as bigint[];
        incoming[1] = 5n;
        incoming[2] = 3n;
        manager.updatePartitionReplicaVersions(0, incoming, 1);
        // After update, staleness check with same versions should return false
        expect(manager.isPartitionReplicaVersionStale(0, incoming, 1)).toBe(false);
    });

    test('updatePartitionReplicaVersions detects dirty and marks REQUIRES_SYNC', () => {
        // Simulate: backup node has version 5 for replica index 1
        const v1 = new Array(MAX_REPLICA_COUNT).fill(0n) as bigint[];
        v1[1] = 5n;
        manager.updatePartitionReplicaVersions(0, v1, 1);

        // Now an older update arrives (version 3) — this is a "dirty" update
        const v2 = new Array(MAX_REPLICA_COUNT).fill(0n) as bigint[];
        v2[1] = 3n;
        manager.updatePartitionReplicaVersions(0, v2, 1);

        // The partition should now be marked as requiring sync
        expect(manager.isPartitionReplicaVersionDirty(0)).toBe(true);
    });

    // ── markPartitionReplicaAsSyncRequired ──

    test('markPartitionReplicaAsSyncRequired sets REQUIRES_SYNC sentinel', () => {
        manager.markPartitionReplicaAsSyncRequired(0, 1);
        expect(manager.isPartitionReplicaVersionDirty(0)).toBe(true);
    });

    // ── getPartitionReplicaVersions ──

    test('getPartitionReplicaVersions returns current versions', () => {
        manager.incrementPartitionReplicaVersions(3, 2);
        const versions = manager.getPartitionReplicaVersions(3);
        expect(versions[1]).toBe(1n);
        expect(versions[2]).toBe(1n);
    });

    test('getPartitionReplicaVersions returns zeroes for fresh partition', () => {
        const versions = manager.getPartitionReplicaVersions(42);
        expect(versions.every(v => v === 0n)).toBe(true);
    });

    // ── getPartitionReplicaVersionsForSync ──

    test('getPartitionReplicaVersionsForSync resets REQUIRES_SYNC to 0', () => {
        manager.incrementPartitionReplicaVersions(0, 2);
        manager.markPartitionReplicaAsSyncRequired(0, 1);
        const versions = manager.getPartitionReplicaVersionsForSync(0);
        // REQUIRES_SYNC markers should be replaced with 0
        expect(versions[1]).toBe(0n);
        // Non-dirty indices keep their values
        expect(versions[2]).toBe(1n);
    });

    // ── finalizeReplicaSync ──

    test('finalizeReplicaSync clears and sets new versions', () => {
        manager.markPartitionReplicaAsSyncRequired(0, 1);
        const newVersions = new Array(MAX_REPLICA_COUNT).fill(0n) as bigint[];
        newVersions[1] = 10n;
        manager.finalizeReplicaSync(0, 1, newVersions);
        const current = manager.getPartitionReplicaVersions(0);
        expect(current[1]).toBe(10n);
        expect(manager.isPartitionReplicaVersionDirty(0)).toBe(false);
    });

    // ── clearPartitionReplicaVersions ──

    test('clearPartitionReplicaVersions resets all to zero', () => {
        manager.incrementPartitionReplicaVersions(0, 3);
        manager.clearPartitionReplicaVersions(0);
        const versions = manager.getPartitionReplicaVersions(0);
        expect(versions.every(v => v === 0n)).toBe(true);
    });

    // ── sync permit management ──

    test('tryAcquireReplicaSyncPermits respects max parallel', () => {
        const acquired = manager.tryAcquireReplicaSyncPermits(3);
        expect(acquired).toBe(3);
        expect(manager.availableReplicaSyncPermits()).toBe(MAX_PARALLEL_REPLICATIONS - 3);
    });

    test('tryAcquireReplicaSyncPermits caps at available', () => {
        manager.tryAcquireReplicaSyncPermits(4);
        const acquired = manager.tryAcquireReplicaSyncPermits(3);
        expect(acquired).toBe(1); // Only 1 left
    });

    test('releaseReplicaSyncPermits restores permits', () => {
        manager.tryAcquireReplicaSyncPermits(3);
        manager.releaseReplicaSyncPermits(2);
        expect(manager.availableReplicaSyncPermits()).toBe(MAX_PARALLEL_REPLICATIONS - 1);
    });

    // ── reset ──

    test('reset clears all versions and permits', () => {
        manager.incrementPartitionReplicaVersions(0, 2);
        manager.tryAcquireReplicaSyncPermits(3);
        manager.reset();
        const versions = manager.getPartitionReplicaVersions(0);
        expect(versions.every(v => v === 0n)).toBe(true);
        expect(manager.availableReplicaSyncPermits()).toBe(MAX_PARALLEL_REPLICATIONS);
    });
});
