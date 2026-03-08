import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { BlitzService } from '@zenystx/helios-blitz/BlitzService';
import { SnapshotStore } from '@zenystx/helios-core/job/snapshot/SnapshotStore';
import type { Kvm } from '@nats-io/kv';

describe('SnapshotStore — NATS KV snapshot persistence', () => {
    let blitz: BlitzService;
    let kvm: Kvm;

    beforeAll(async () => {
        blitz = await BlitzService.start();
        kvm = await blitz.getKvm();
    });

    afterAll(async () => {
        await blitz.shutdown();
    });

    describe('save/load round-trip', () => {
        let store: SnapshotStore;

        afterEach(async () => {
            try { await store.destroy(); } catch { /* bucket may not exist */ }
        });

        it('saves and loads processor state as JSON round-trip', async () => {
            store = new SnapshotStore(kvm, 'job-roundtrip-1');
            const state = { offset: 42, buffer: [1, 2, 3], metadata: { key: 'value' } };

            await store.saveProcessorState('snap-1', 'source-vertex', 0, state);
            const loaded = await store.loadProcessorState('snap-1', 'source-vertex', 0);

            expect(loaded).toEqual(state);
        });

        it('saves and loads binary (Uint8Array) processor state', async () => {
            store = new SnapshotStore(kvm, 'job-roundtrip-2');
            const state = new Uint8Array([10, 20, 30, 40, 50]);

            await store.saveProcessorState('snap-1', 'map-vertex', 1, state);
            const loaded = await store.loadProcessorState('snap-1', 'map-vertex', 1);

            expect(loaded).toBeInstanceOf(Uint8Array);
            expect(new Uint8Array(loaded as Uint8Array)).toEqual(state);
        });

        it('returns null for non-existent processor state', async () => {
            store = new SnapshotStore(kvm, 'job-roundtrip-3');
            const loaded = await store.loadProcessorState('snap-999', 'no-vertex', 0);
            expect(loaded).toBeNull();
        });

        it('overwrites processor state on re-save with same key', async () => {
            store = new SnapshotStore(kvm, 'job-roundtrip-4');

            await store.saveProcessorState('snap-1', 'v1', 0, { version: 1 });
            await store.saveProcessorState('snap-1', 'v1', 0, { version: 2 });
            const loaded = await store.loadProcessorState('snap-1', 'v1', 0);

            expect(loaded).toEqual({ version: 2 });
        });

        it('isolates state across different vertices and processor indices', async () => {
            store = new SnapshotStore(kvm, 'job-roundtrip-5');

            await store.saveProcessorState('snap-1', 'vertexA', 0, { a: 0 });
            await store.saveProcessorState('snap-1', 'vertexA', 1, { a: 1 });
            await store.saveProcessorState('snap-1', 'vertexB', 0, { b: 0 });

            expect(await store.loadProcessorState('snap-1', 'vertexA', 0)).toEqual({ a: 0 });
            expect(await store.loadProcessorState('snap-1', 'vertexA', 1)).toEqual({ a: 1 });
            expect(await store.loadProcessorState('snap-1', 'vertexB', 0)).toEqual({ b: 0 });
        });
    });

    describe('commit and latest snapshot', () => {
        let store: SnapshotStore;

        afterEach(async () => {
            try { await store.destroy(); } catch { /* bucket may not exist */ }
        });

        it('getLatestSnapshotId returns null when no snapshots committed', async () => {
            store = new SnapshotStore(kvm, 'job-commit-1');
            const latest = await store.getLatestSnapshotId();
            expect(latest).toBeNull();
        });

        it('commitSnapshot marks a snapshot and getLatestSnapshotId returns it', async () => {
            store = new SnapshotStore(kvm, 'job-commit-2');
            await store.saveProcessorState('snap-1', 'v1', 0, { x: 1 });
            await store.commitSnapshot('snap-1');

            const latest = await store.getLatestSnapshotId();
            expect(latest).toBe('snap-1');
        });

        it('getLatestSnapshotId returns the most recent committed snapshot', async () => {
            store = new SnapshotStore(kvm, 'job-commit-3');

            await store.saveProcessorState('snap-1', 'v1', 0, { x: 1 });
            await store.commitSnapshot('snap-1');
            await store.saveProcessorState('snap-2', 'v1', 0, { x: 2 });
            await store.commitSnapshot('snap-2');
            await store.saveProcessorState('snap-3', 'v1', 0, { x: 3 });
            await store.commitSnapshot('snap-3');

            const latest = await store.getLatestSnapshotId();
            expect(latest).toBe('snap-3');
        });

        it('uncommitted snapshot data does not affect getLatestSnapshotId', async () => {
            store = new SnapshotStore(kvm, 'job-commit-4');

            await store.saveProcessorState('snap-1', 'v1', 0, { x: 1 });
            await store.commitSnapshot('snap-1');
            // snap-2 saved but NOT committed
            await store.saveProcessorState('snap-2', 'v1', 0, { x: 2 });

            const latest = await store.getLatestSnapshotId();
            expect(latest).toBe('snap-1');
        });
    });

    describe('pruneSnapshots', () => {
        let store: SnapshotStore;

        afterEach(async () => {
            try { await store.destroy(); } catch { /* bucket may not exist */ }
        });

        it('prune keeps last N committed snapshots and deletes older ones', async () => {
            store = new SnapshotStore(kvm, 'job-prune-1');

            // Create and commit 4 snapshots
            for (let i = 1; i <= 4; i++) {
                await store.saveProcessorState(`snap-${i}`, 'v1', 0, { i });
                await store.commitSnapshot(`snap-${i}`);
            }

            // Keep last 2
            await store.pruneSnapshots(2);

            // snap-1 and snap-2 data should be gone
            expect(await store.loadProcessorState('snap-1', 'v1', 0)).toBeNull();
            expect(await store.loadProcessorState('snap-2', 'v1', 0)).toBeNull();
            // snap-3 and snap-4 data should remain
            expect(await store.loadProcessorState('snap-3', 'v1', 0)).toEqual({ i: 3 });
            expect(await store.loadProcessorState('snap-4', 'v1', 0)).toEqual({ i: 4 });
        });

        it('prune is a no-op when fewer than N snapshots exist', async () => {
            store = new SnapshotStore(kvm, 'job-prune-2');

            await store.saveProcessorState('snap-1', 'v1', 0, { i: 1 });
            await store.commitSnapshot('snap-1');

            // Keep last 5 — only 1 exists, nothing pruned
            await store.pruneSnapshots(5);
            expect(await store.loadProcessorState('snap-1', 'v1', 0)).toEqual({ i: 1 });
        });
    });

    describe('destroy', () => {
        it('destroy removes the KV bucket entirely', async () => {
            const store = new SnapshotStore(kvm, 'job-destroy-1');

            await store.saveProcessorState('snap-1', 'v1', 0, { x: 1 });
            await store.commitSnapshot('snap-1');
            await store.destroy();

            // After destroy, creating a new store with same jobId starts fresh
            const store2 = new SnapshotStore(kvm, 'job-destroy-1');
            expect(await store2.getLatestSnapshotId()).toBeNull();
            expect(await store2.loadProcessorState('snap-1', 'v1', 0)).toBeNull();
            await store2.destroy();
        });

        it('destroy is idempotent', async () => {
            const store = new SnapshotStore(kvm, 'job-destroy-2');
            await store.saveProcessorState('snap-1', 'v1', 0, { x: 1 });

            await store.destroy();
            // Second destroy should not throw
            await store.destroy();
        });
    });

    describe('real NATS KV persistence verification', () => {
        it('state persists across separate SnapshotStore instances', async () => {
            const store1 = new SnapshotStore(kvm, 'job-persist-1');
            await store1.saveProcessorState('snap-1', 'v1', 0, { persisted: true });
            await store1.commitSnapshot('snap-1');

            // Create a new SnapshotStore pointing to the same jobId
            const store2 = new SnapshotStore(kvm, 'job-persist-1');
            const loaded = await store2.loadProcessorState('snap-1', 'v1', 0);
            expect(loaded).toEqual({ persisted: true });
            expect(await store2.getLatestSnapshotId()).toBe('snap-1');

            await store2.destroy();
        });
    });
});
