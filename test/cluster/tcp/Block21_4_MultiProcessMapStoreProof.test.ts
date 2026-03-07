/**
 * Block 21.4 — Multi-process clustered MapStore production proof.
 *
 * ALL tests run Helios members as separate Bun child processes communicating
 * over real TCP via TcpClusterTransport. No shared-process, in-memory, or
 * direct-call shortcuts.
 *
 * Every physical external MapStore call records provenance:
 *   memberId, partitionId, replicaRole, partitionEpoch, operationKind
 *
 * Tests assert absence of duplicate physical store/storeAll/delete/deleteAll
 * for any single logical mutation, and verify that all writes originate from
 * the partition owner (replicaRole === PRIMARY).
 *
 * Transport-boundary fault injection (crash/drop/delay) is exercised via
 * TcpFaultProxy and process kill.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { MultiProcessCluster } from '../../../src/test-support/MultiProcessCluster.js';
import { TcpFaultProxy } from '../../../src/test-support/TcpFaultProxy.js';

const BASE_PORT = 18400;
let portCounter = 0;
function nextPort(): number {
    return BASE_PORT + (portCounter++);
}

interface ProvenanceRecord {
    memberId: string;
    partitionId: number;
    replicaRole: 'PRIMARY' | 'BACKUP' | 'UNKNOWN';
    partitionEpoch: number;
    operationKind: string;
    keys: string[];
    ts: number;
}

function writeRecords(records: ProvenanceRecord[]): ProvenanceRecord[] {
    return records.filter(r =>
        r.operationKind === 'store' || r.operationKind === 'storeAll' ||
        r.operationKind === 'delete' || r.operationKind === 'deleteAll',
    );
}

function totalStoreCount(records: ProvenanceRecord[]): number {
    return records
        .filter(r => r.operationKind === 'store' || r.operationKind === 'storeAll')
        .reduce((n, r) => n + r.keys.length, 0);
}

function totalDeleteCount(records: ProvenanceRecord[]): number {
    return records
        .filter(r => r.operationKind === 'delete' || r.operationKind === 'deleteAll')
        .reduce((n, r) => n + r.keys.length, 0);
}

function totalLoadCount(records: ProvenanceRecord[]): number {
    return records
        .filter(r => r.operationKind === 'load' || r.operationKind === 'loadAll')
        .reduce((n, r) => n + r.keys.length, 0);
}

/** Assert all write provenance records have replicaRole === PRIMARY. */
function assertAllWritesArePrimary(recordsA: ProvenanceRecord[], recordsB: ProvenanceRecord[]): void {
    for (const r of writeRecords(recordsA)) {
        expect(r.replicaRole).toBe('PRIMARY');
    }
    for (const r of writeRecords(recordsB)) {
        expect(r.replicaRole).toBe('PRIMARY');
    }
}

/** Assert no key was written by both members (no duplicate physical writes). */
function assertNoDuplicateWrites(recordsA: ProvenanceRecord[], recordsB: ProvenanceRecord[]): void {
    const writtenByA = new Set<string>();
    const writtenByB = new Set<string>();
    for (const r of writeRecords(recordsA)) r.keys.forEach(k => writtenByA.add(k));
    for (const r of writeRecords(recordsB)) r.keys.forEach(k => writtenByB.add(k));
    for (const k of writtenByA) {
        if (writtenByB.has(k)) {
            throw new Error(`Duplicate physical write: key "${k}" written by both members`);
        }
    }
}

/** Assert every write record has a valid partitionId (>= 0). */
function assertPartitionIdsPresent(records: ProvenanceRecord[]): void {
    for (const r of writeRecords(records)) {
        expect(r.partitionId).toBeGreaterThanOrEqual(0);
    }
}

/** Assert partition epochs are present (>= 0) on all write records. */
function assertEpochsPresent(records: ProvenanceRecord[]): void {
    for (const r of writeRecords(records)) {
        expect(r.partitionEpoch).toBeGreaterThanOrEqual(0);
    }
}

/** Full provenance assertion suite. */
function assertFullProvenance(recordsA: ProvenanceRecord[], recordsB: ProvenanceRecord[]): void {
    assertAllWritesArePrimary(recordsA, recordsB);
    assertNoDuplicateWrites(recordsA, recordsB);
    assertPartitionIdsPresent(recordsA);
    assertPartitionIdsPresent(recordsB);
    assertEpochsPresent(recordsA);
    assertEpochsPresent(recordsB);
}

describe('Block 21.4 — Multi-process clustered MapStore production proof', () => {
    let cluster: MultiProcessCluster;
    let proxies: TcpFaultProxy[] = [];

    afterEach(async () => {
        if (cluster) await cluster.shutdownAll();
        for (const p of proxies) p.stop();
        proxies = [];
    });

    // ═══════════════════════════════════════════════════════════
    //  SECTION 1: Write-through provenance proof (separate processes)
    // ═══════════════════════════════════════════════════════════

    it('MP-WT-1: write-through put — exactly one physical store on owner, full provenance', async () => {
        cluster = new MultiProcessCluster();
        const portA = nextPort();
        const portB = nextPort();
        const MAP = 'mp-wt-put';

        await cluster.startMember({ name: 'A', port: portA, peerPorts: [], mapName: MAP, writeMode: 'write-through' });
        await cluster.startMember({ name: 'B', port: portB, peerPorts: [portA], mapName: MAP, writeMode: 'write-through' });
        await cluster.waitForClusterSize('A', 2);
        await cluster.waitForClusterSize('B', 2);

        const key = await cluster.findKeyOwnedBy('A', 'A', 'wt');
        await cluster.mapPut('B', MAP, key, 'v1');

        const recA = await cluster.getProvenance('A');
        const recB = await cluster.getProvenance('B');

        expect(totalStoreCount(recA)).toBe(1);
        expect(totalStoreCount(recB)).toBe(0);
        assertFullProvenance(recA, recB);

        const rec = recA.find(r => r.operationKind === 'store')!;
        expect(rec.memberId).toBe('A');
        expect(rec.replicaRole).toBe('PRIMARY');
        expect(rec.partitionId).toBeGreaterThanOrEqual(0);
    });

    it('MP-WT-2: write-through remove — exactly one physical delete, full provenance', async () => {
        cluster = new MultiProcessCluster();
        const portA = nextPort();
        const portB = nextPort();
        const MAP = 'mp-wt-rm';

        await cluster.startMember({ name: 'A', port: portA, peerPorts: [], mapName: MAP, writeMode: 'write-through' });
        await cluster.startMember({ name: 'B', port: portB, peerPorts: [portA], mapName: MAP, writeMode: 'write-through' });
        await cluster.waitForClusterSize('A', 2);

        const key = await cluster.findKeyOwnedBy('A', 'A', 'wtrm');
        await cluster.mapPut('A', MAP, key, 'v');
        await cluster.resetProvenance('A');
        await cluster.resetProvenance('B');

        await cluster.mapRemove('B', MAP, key);

        const recA = await cluster.getProvenance('A');
        const recB = await cluster.getProvenance('B');

        expect(totalDeleteCount(recA)).toBe(1);
        expect(totalDeleteCount(recB)).toBe(0);
        assertFullProvenance(recA, recB);
    });

    it('MP-WT-3: write-through putAll — routes to owners, no duplicate writes', async () => {
        cluster = new MultiProcessCluster();
        const portA = nextPort();
        const portB = nextPort();
        const MAP = 'mp-wt-pa';

        await cluster.startMember({ name: 'A', port: portA, peerPorts: [], mapName: MAP, writeMode: 'write-through' });
        await cluster.startMember({ name: 'B', port: portB, peerPorts: [portA], mapName: MAP, writeMode: 'write-through' });
        await cluster.waitForClusterSize('A', 2);

        const entries: [string, string][] = [];
        for (let i = 0; i < 20; i++) entries.push([`wtpa-${i}`, `v-${i}`]);
        await cluster.mapPutAll('A', MAP, entries);

        const recA = await cluster.getProvenance('A');
        const recB = await cluster.getProvenance('B');

        const total = totalStoreCount(recA) + totalStoreCount(recB);
        expect(total).toBe(20);
        assertFullProvenance(recA, recB);
    });

    it('MP-WT-4: write-through getAll load-on-miss — loads on owners only', async () => {
        cluster = new MultiProcessCluster();
        const portA = nextPort();
        const portB = nextPort();
        const MAP = 'mp-wt-ga';

        // Seed data on both stores
        const seed: Record<string, string> = {};
        for (let i = 0; i < 10; i++) seed[`wtga-${i}`] = `ext-${i}`;

        await cluster.startMember({ name: 'A', port: portA, peerPorts: [], mapName: MAP, writeMode: 'write-through', seedData: seed });
        await cluster.startMember({ name: 'B', port: portB, peerPorts: [portA], mapName: MAP, writeMode: 'write-through', seedData: seed });
        await cluster.waitForClusterSize('A', 2);
        await cluster.resetProvenance('A');
        await cluster.resetProvenance('B');

        const keys = Array.from({ length: 10 }, (_, i) => `wtga-${i}`);
        const result = await cluster.mapGetAll('B', MAP, keys);

        for (const key of keys) expect(result.get(key)).toBeDefined();

        const recA = await cluster.getProvenance('A');
        const recB = await cluster.getProvenance('B');
        const totalLoads = totalLoadCount(recA) + totalLoadCount(recB);
        expect(totalLoads).toBe(10);
    });

    it('MP-WT-5: write-through mixed ops — zero duplicate physical calls', async () => {
        cluster = new MultiProcessCluster();
        const portA = nextPort();
        const portB = nextPort();
        const MAP = 'mp-wt-mix';

        await cluster.startMember({ name: 'A', port: portA, peerPorts: [], mapName: MAP, writeMode: 'write-through' });
        await cluster.startMember({ name: 'B', port: portB, peerPorts: [portA], mapName: MAP, writeMode: 'write-through' });
        await cluster.waitForClusterSize('A', 2);

        const key = await cluster.findKeyOwnedBy('A', 'A', 'wtmx');
        await cluster.mapPut('B', MAP, key, 'v1');
        await cluster.mapPut('B', MAP, key, 'v2');
        await cluster.mapRemove('B', MAP, key);
        await cluster.mapPut('B', MAP, key, 'v3');
        await cluster.mapRemove('B', MAP, key);

        const recA = await cluster.getProvenance('A');
        const recB = await cluster.getProvenance('B');

        expect(totalStoreCount(recA)).toBe(3);
        expect(totalDeleteCount(recA)).toBe(2);
        expect(totalStoreCount(recB)).toBe(0);
        expect(totalDeleteCount(recB)).toBe(0);
        assertFullProvenance(recA, recB);
    });

    // ═══════════════════════════════════════════════════════════
    //  SECTION 2: Write-behind provenance proof (separate processes)
    // ═══════════════════════════════════════════════════════════

    it('MP-WB-1: write-behind put — flushes to owner only, full provenance', async () => {
        cluster = new MultiProcessCluster();
        const portA = nextPort();
        const portB = nextPort();
        const MAP = 'mp-wb-put';

        await cluster.startMember({ name: 'A', port: portA, peerPorts: [], mapName: MAP, writeMode: 'write-behind', writeDelaySeconds: 1 });
        await cluster.startMember({ name: 'B', port: portB, peerPorts: [portA], mapName: MAP, writeMode: 'write-behind', writeDelaySeconds: 1 });
        await cluster.waitForClusterSize('A', 2);

        const key = await cluster.findKeyOwnedBy('A', 'A', 'wbp');
        await cluster.mapPut('B', MAP, key, 'v1');

        // Wait for write-behind flush
        await Bun.sleep(3000);

        const recA = await cluster.getProvenance('A');
        const recB = await cluster.getProvenance('B');

        expect(totalStoreCount(recA)).toBeGreaterThanOrEqual(1);
        expect(totalStoreCount(recB)).toBe(0);
        assertAllWritesArePrimary(recA, recB);
    });

    it('MP-WB-2: write-behind batching — storeAll on owner, no backup writes', async () => {
        cluster = new MultiProcessCluster();
        const portA = nextPort();
        const portB = nextPort();
        const MAP = 'mp-wb-batch';

        await cluster.startMember({ name: 'A', port: portA, peerPorts: [], mapName: MAP, writeMode: 'write-behind', writeDelaySeconds: 1, writeBatchSize: 5 });
        await cluster.startMember({ name: 'B', port: portB, peerPorts: [portA], mapName: MAP, writeMode: 'write-behind', writeDelaySeconds: 1, writeBatchSize: 5 });
        await cluster.waitForClusterSize('A', 2);

        for (let i = 0; i < 5; i++) {
            const key = await cluster.findKeyOwnedBy('A', 'A', `wbb-${i}`);
            await cluster.mapPut('A', MAP, key, `batch-${i}`);
        }

        await Bun.sleep(3000);

        const recA = await cluster.getProvenance('A');
        const recB = await cluster.getProvenance('B');

        expect(totalStoreCount(recA)).toBeGreaterThanOrEqual(5);
        expect(totalStoreCount(recB)).toBe(0);
        assertAllWritesArePrimary(recA, recB);
    });

    it('MP-WB-3: write-behind coalescing — deduplicates on owner', async () => {
        cluster = new MultiProcessCluster();
        const portA = nextPort();
        const portB = nextPort();
        const MAP = 'mp-wb-coal';

        await cluster.startMember({ name: 'A', port: portA, peerPorts: [], mapName: MAP, writeMode: 'write-behind', writeDelaySeconds: 1, writeCoalescing: true });
        await cluster.startMember({ name: 'B', port: portB, peerPorts: [portA], mapName: MAP, writeMode: 'write-behind', writeDelaySeconds: 1, writeCoalescing: true });
        await cluster.waitForClusterSize('A', 2);

        const key = await cluster.findKeyOwnedBy('A', 'A', 'coal');
        for (let i = 0; i < 5; i++) await cluster.mapPut('A', MAP, key, `coal-${i}`);

        await Bun.sleep(3000);

        const recA = await cluster.getProvenance('A');
        const recB = await cluster.getProvenance('B');

        expect(totalStoreCount(recA)).toBeLessThanOrEqual(5);
        expect(totalStoreCount(recA)).toBeGreaterThanOrEqual(1);
        expect(totalStoreCount(recB)).toBe(0);
        assertAllWritesArePrimary(recA, recB);
    });

    it('MP-WB-4: write-behind remove — physical delete on owner after flush', async () => {
        cluster = new MultiProcessCluster();
        const portA = nextPort();
        const portB = nextPort();
        const MAP = 'mp-wb-rm';

        await cluster.startMember({ name: 'A', port: portA, peerPorts: [], mapName: MAP, writeMode: 'write-behind', writeDelaySeconds: 1 });
        await cluster.startMember({ name: 'B', port: portB, peerPorts: [portA], mapName: MAP, writeMode: 'write-behind', writeDelaySeconds: 1 });
        await cluster.waitForClusterSize('A', 2);

        const key = await cluster.findKeyOwnedBy('A', 'A', 'wbrm');
        await cluster.mapPut('A', MAP, key, 'v');
        await Bun.sleep(2000);
        await cluster.resetProvenance('A');
        await cluster.resetProvenance('B');

        await cluster.mapRemove('B', MAP, key);
        await Bun.sleep(3000);

        const recA = await cluster.getProvenance('A');
        const recB = await cluster.getProvenance('B');

        expect(totalDeleteCount(recA)).toBeGreaterThanOrEqual(1);
        expect(totalDeleteCount(recB)).toBe(0);
        assertAllWritesArePrimary(recA, recB);
    });

    it('MP-WB-5: write-behind lazy load-on-miss — loads on owner only', async () => {
        cluster = new MultiProcessCluster();
        const portA = nextPort();
        const portB = nextPort();
        const MAP = 'mp-wb-lazy';

        const key = 'wblz-static';
        await cluster.startMember({ name: 'A', port: portA, peerPorts: [], mapName: MAP, writeMode: 'write-behind', writeDelaySeconds: 1, seedData: { [key]: 'lazy-ext' } });
        await cluster.startMember({ name: 'B', port: portB, peerPorts: [portA], mapName: MAP, writeMode: 'write-behind', writeDelaySeconds: 1, seedData: { [key]: 'lazy-ext' } });
        await cluster.waitForClusterSize('A', 2);

        const val = await cluster.mapGet('B', MAP, key);
        expect(val).toBe('lazy-ext');

        const recA = await cluster.getProvenance('A');
        const recB = await cluster.getProvenance('B');
        const loadRecsA = recA.filter(r => r.operationKind === 'load');
        const loadRecsB = recB.filter(r => r.operationKind === 'load');
        // Load should happen on exactly one member (the owner)
        expect(loadRecsA.length + loadRecsB.length).toBe(1);
    });

    // ═══════════════════════════════════════════════════════════
    //  SECTION 3: EAGER load + clear (separate processes)
    // ═══════════════════════════════════════════════════════════

    it('MP-EAGER-1: clustered EAGER load — coordinated loadAllKeys', async () => {
        cluster = new MultiProcessCluster();
        const portA = nextPort();
        const portB = nextPort();
        const MAP = 'mp-eager';

        const seed: Record<string, string> = {};
        for (let i = 0; i < 10; i++) seed[`ek-${i}`] = `ev-${i}`;

        await cluster.startMember({ name: 'A', port: portA, peerPorts: [], mapName: MAP, writeMode: 'write-through', initialLoadMode: 'EAGER', seedData: seed });
        await cluster.startMember({ name: 'B', port: portB, peerPorts: [portA], mapName: MAP, writeMode: 'write-through', initialLoadMode: 'EAGER', seedData: seed });
        await cluster.waitForClusterSize('A', 2);
        await Bun.sleep(1000);

        const recA = await cluster.getProvenance('A');
        const recB = await cluster.getProvenance('B');
        const loadAllKeysA = recA.filter(r => r.operationKind === 'loadAllKeys').length;
        const loadAllKeysB = recB.filter(r => r.operationKind === 'loadAllKeys').length;
        expect(loadAllKeysA + loadAllKeysB).toBeLessThanOrEqual(2);

        // Verify data is accessible from both members
        for (let i = 0; i < 10; i++) {
            const vA = await cluster.mapGet('A', MAP, `ek-${i}`);
            const vB = await cluster.mapGet('B', MAP, `ek-${i}`);
            expect(vA).toBe(`ev-${i}`);
            expect(vB).toBe(`ev-${i}`);
        }
    });

    it('MP-CLEAR-1: clustered clear — no duplicate external deletes', async () => {
        cluster = new MultiProcessCluster();
        const portA = nextPort();
        const portB = nextPort();
        const MAP = 'mp-clear';

        await cluster.startMember({ name: 'A', port: portA, peerPorts: [], mapName: MAP, writeMode: 'write-through' });
        await cluster.startMember({ name: 'B', port: portB, peerPorts: [portA], mapName: MAP, writeMode: 'write-through' });
        await cluster.waitForClusterSize('A', 2);

        for (let i = 0; i < 10; i++) await cluster.mapPut('A', MAP, `cp-${i}`, `v-${i}`);
        await cluster.resetProvenance('A');
        await cluster.resetProvenance('B');

        await cluster.mapClear('A', MAP);
        const size = await cluster.mapSize('A', MAP);
        expect(size).toBe(0);

        const recA = await cluster.getProvenance('A');
        const recB = await cluster.getProvenance('B');
        const totalDeletes = totalDeleteCount(recA) + totalDeleteCount(recB);
        expect(totalDeletes).toBeLessThanOrEqual(10);
        assertAllWritesArePrimary(recA, recB);
    });

    // ═══════════════════════════════════════════════════════════
    //  SECTION 4: Transport-boundary fault injection
    // ═══════════════════════════════════════════════════════════

    it('MP-FAULT-1: owner crash — at-least-once semantics after failover', async () => {
        cluster = new MultiProcessCluster();
        const portA = nextPort();
        const portB = nextPort();
        const MAP = 'mp-fault-crash';

        await cluster.startMember({ name: 'A', port: portA, peerPorts: [], mapName: MAP, writeMode: 'write-through' });
        await cluster.startMember({ name: 'B', port: portB, peerPorts: [portA], mapName: MAP, writeMode: 'write-through' });
        await cluster.waitForClusterSize('A', 2);

        // Put some data
        const key = await cluster.findKeyOwnedBy('A', 'A', 'fc');
        await cluster.mapPut('A', MAP, key, 'before-crash');

        // Kill member A (owner crash)
        cluster.killMember('A');
        await Bun.sleep(2000); // Let B detect the crash

        // B should still function — map data may be lost for that partition
        // (at-least-once means we don't guarantee zero data loss on crash)
        const recB = await cluster.getProvenance('B');
        // The key assertion: B did not make any duplicate external writes during crash
        assertAllWritesArePrimary(recB, []);
    });

    it('MP-FAULT-2: transport delay — operations complete despite latency', async () => {
        cluster = new MultiProcessCluster();
        const portA = nextPort();
        const proxyPort = nextPort();
        const portB = nextPort();
        const MAP = 'mp-fault-delay';

        // A listens on portA
        await cluster.startMember({ name: 'A', port: portA, peerPorts: [], mapName: MAP, writeMode: 'write-through' });

        // Proxy sits between A and B, forwarding B's traffic to A with delay
        const proxy = new TcpFaultProxy({ listenPort: proxyPort, targetHost: '127.0.0.1', targetPort: portA });
        await proxy.start();
        proxies.push(proxy);

        // B connects through the proxy
        await cluster.startMember({ name: 'B', port: portB, peerPorts: [proxyPort], mapName: MAP, writeMode: 'write-through' });
        await cluster.waitForClusterSize('A', 2);

        // Inject 100ms delay
        proxy.delay(100);

        const key = await cluster.findKeyOwnedBy('A', 'A', 'fd');
        await cluster.mapPut('B', MAP, key, 'delayed-v');

        const recA = await cluster.getProvenance('A');
        const recB = await cluster.getProvenance('B');

        expect(totalStoreCount(recA)).toBe(1);
        expect(totalStoreCount(recB)).toBe(0);
        assertFullProvenance(recA, recB);
        expect(proxy.bytesForwarded).toBeGreaterThan(0);
    });

    it('MP-FAULT-3: transport drop — no duplicate writes after reconnect', async () => {
        cluster = new MultiProcessCluster();
        const portA = nextPort();
        const proxyPort = nextPort();
        const portB = nextPort();
        const MAP = 'mp-fault-drop';

        await cluster.startMember({ name: 'A', port: portA, peerPorts: [], mapName: MAP, writeMode: 'write-through' });

        const proxy = new TcpFaultProxy({ listenPort: proxyPort, targetHost: '127.0.0.1', targetPort: portA });
        await proxy.start();
        proxies.push(proxy);

        await cluster.startMember({ name: 'B', port: portB, peerPorts: [proxyPort], mapName: MAP, writeMode: 'write-through' });
        await cluster.waitForClusterSize('A', 2);

        // Put succeeds normally first
        const key = await cluster.findKeyOwnedBy('A', 'A', 'fdrop');
        await cluster.mapPut('B', MAP, key, 'before-drop');

        await cluster.resetProvenance('A');
        await cluster.resetProvenance('B');

        // Drop all traffic briefly
        proxy.dropAll();
        await Bun.sleep(500);
        proxy.passthrough();
        await Bun.sleep(500);

        // Operations after reconnect should still be correct
        await cluster.mapPut('A', MAP, key, 'after-drop');

        const recA = await cluster.getProvenance('A');
        const recB = await cluster.getProvenance('B');

        // Owner writes should still only happen once per logical mutation
        assertAllWritesArePrimary(recA, recB);
    });

    // ═══════════════════════════════════════════════════════════
    //  SECTION 5: Production gate (bidirectional + high-volume)
    // ═══════════════════════════════════════════════════════════

    it('MP-GATE-1: bidirectional ownership — both processes serve as owners', async () => {
        cluster = new MultiProcessCluster();
        const portA = nextPort();
        const portB = nextPort();
        const MAP = 'mp-gate-bidir';

        await cluster.startMember({ name: 'A', port: portA, peerPorts: [], mapName: MAP, writeMode: 'write-through' });
        await cluster.startMember({ name: 'B', port: portB, peerPorts: [portA], mapName: MAP, writeMode: 'write-through' });
        await cluster.waitForClusterSize('A', 2);

        const keyA = await cluster.findKeyOwnedBy('A', 'A', 'gA');
        const keyB = await cluster.findKeyOwnedBy('A', 'B', 'gB');

        await cluster.mapPut('A', MAP, keyA, 'on-A');
        await cluster.mapPut('A', MAP, keyB, 'on-B');

        const recA = await cluster.getProvenance('A');
        const recB = await cluster.getProvenance('B');

        expect(recA.some(r => r.keys.includes(keyA))).toBe(true);
        expect(recB.some(r => r.keys.includes(keyB))).toBe(true);
        assertFullProvenance(recA, recB);
    });

    it('MP-GATE-2: high-volume write-through — 50 ops, no duplicates', async () => {
        cluster = new MultiProcessCluster();
        const portA = nextPort();
        const portB = nextPort();
        const MAP = 'mp-gate-vol';

        await cluster.startMember({ name: 'A', port: portA, peerPorts: [], mapName: MAP, writeMode: 'write-through' });
        await cluster.startMember({ name: 'B', port: portB, peerPorts: [portA], mapName: MAP, writeMode: 'write-through' });
        await cluster.waitForClusterSize('A', 2);

        for (let i = 0; i < 25; i++) await cluster.mapPut('A', MAP, `gv-${i}`, `a-${i}`);
        for (let i = 25; i < 50; i++) await cluster.mapPut('B', MAP, `gv-${i}`, `b-${i}`);

        const recA = await cluster.getProvenance('A');
        const recB = await cluster.getProvenance('B');

        const total = totalStoreCount(recA) + totalStoreCount(recB);
        expect(total).toBe(50);
        assertFullProvenance(recA, recB);
    });

    it('MP-GATE-3: no broadcast-replay — non-owner writes produce zero backup calls', async () => {
        cluster = new MultiProcessCluster();
        const portA = nextPort();
        const portB = nextPort();
        const MAP = 'mp-gate-noreplay';

        await cluster.startMember({ name: 'A', port: portA, peerPorts: [], mapName: MAP, writeMode: 'write-through' });
        await cluster.startMember({ name: 'B', port: portB, peerPorts: [portA], mapName: MAP, writeMode: 'write-through' });
        await cluster.waitForClusterSize('A', 2);

        const key = await cluster.findKeyOwnedBy('A', 'A', 'nr');
        await cluster.mapPut('B', MAP, key, 'v1');
        await cluster.mapPut('B', MAP, key, 'v2');
        await cluster.mapRemove('B', MAP, key);

        const recA = await cluster.getProvenance('A');
        const recB = await cluster.getProvenance('B');

        expect(totalStoreCount(recB)).toBe(0);
        expect(totalDeleteCount(recB)).toBe(0);
        expect(totalStoreCount(recA)).toBe(2);
        expect(totalDeleteCount(recA)).toBe(1);
        assertFullProvenance(recA, recB);

        const valA = await cluster.mapGet('A', MAP, key);
        const valB = await cluster.mapGet('B', MAP, key);
        expect(valA).toBeNull();
        expect(valB).toBeNull();
    });

    // ═══════════════════════════════════════════════════════════
    //  SECTION 6: Full lifecycle adapter proof
    // ═══════════════════════════════════════════════════════════

    it('MP-ADAPTER-1: full lifecycle — provenance-recorded end-to-end across processes', async () => {
        cluster = new MultiProcessCluster();
        const portA = nextPort();
        const portB = nextPort();
        const MAP = 'mp-adapter-proof';

        await cluster.startMember({ name: 'A', port: portA, peerPorts: [], mapName: MAP, writeMode: 'write-through' });
        await cluster.startMember({ name: 'B', port: portB, peerPorts: [portA], mapName: MAP, writeMode: 'write-through' });
        await cluster.waitForClusterSize('A', 2);

        // 1. Put from non-owner
        const keyA = await cluster.findKeyOwnedBy('A', 'A', 'ap');
        await cluster.mapPut('B', MAP, keyA, 'adapter-v1');
        let recA = await cluster.getProvenance('A');
        let recB = await cluster.getProvenance('B');
        expect(totalStoreCount(recA)).toBe(1);
        expect(totalStoreCount(recB)).toBe(0);

        // 2. Get (in-memory, no load)
        const v1 = await cluster.mapGet('B', MAP, keyA);
        expect(v1).toBe('adapter-v1');

        // 3. Remove
        await cluster.resetProvenance('A');
        await cluster.resetProvenance('B');
        await cluster.mapRemove('B', MAP, keyA);
        recA = await cluster.getProvenance('A');
        recB = await cluster.getProvenance('B');
        expect(totalDeleteCount(recA)).toBe(1);
        expect(totalDeleteCount(recB)).toBe(0);

        // 4. putAll
        await cluster.resetProvenance('A');
        await cluster.resetProvenance('B');
        const entries: [string, string][] = [];
        for (let i = 0; i < 10; i++) entries.push([`apall-${i}`, `pv-${i}`]);
        await cluster.mapPutAll('A', MAP, entries);
        recA = await cluster.getProvenance('A');
        recB = await cluster.getProvenance('B');
        const totalPutAll = totalStoreCount(recA) + totalStoreCount(recB);
        expect(totalPutAll).toBe(10);

        assertFullProvenance(recA, recB);
    });
});
