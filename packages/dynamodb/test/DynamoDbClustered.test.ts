/**
 * Steps 10 & 11 — Clustered owner-only proof + failover/migration tests
 * for DynamoDbMapStore.
 *
 * Proves:
 *  - Clustered write-through correctness with provenance-recording adapters
 *    wrapping DynamoDbMapStore over a shared in-memory mock DynamoDB client
 *  - Owner-only persistence for put, remove, putAll, get (load-on-miss), clear
 *  - Write-behind flush correctness (owner-only batched writes)
 *  - No duplicate physical writes under healthy two-node clusters
 *  - Failover: graceful shutdown flushes write-behind, promoted owner takes over
 *  - Migration: replay-safe convergence after key updates + failover
 *
 * Architecture:
 *  - Two Helios instances in-process connected via TCP
 *  - Each wraps a ProvenanceDynamoDbStore that delegates to a DynamoDbMapStore
 *  - Both DynamoDbMapStores share one in-memory storage Map (simulating a
 *    shared external DynamoDB table)
 */
import { Helios } from '@zenystx/helios-core/Helios';
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import { MapConfig } from '@zenystx/helios-core/config/MapConfig';
import { MapStoreConfig } from '@zenystx/helios-core/config/MapStoreConfig';
import type { HeliosInstanceImpl } from '@zenystx/helios-core/instance/impl/HeliosInstanceImpl';
import { MapKeyStream } from '@zenystx/helios-core/map/MapKeyStream';
import type { MapStore } from '@zenystx/helios-core/map/MapStore';
import { afterEach, describe, expect, it } from 'bun:test';
import { DynamoDbMapStore } from '../src/DynamoDbMapStore.js';

// ═══════════════════════════════════════════════════════════
//  Port management
// ═══════════════════════════════════════════════════════════

const BASE_PORT = 17500;
let portCounter = 0;

function nextPort(): number {
    return BASE_PORT + (portCounter++);
}

// ═══════════════════════════════════════════════════════════
//  Shared in-memory mock DynamoDB client
// ═══════════════════════════════════════════════════════════

interface AttributeValue {
    S?: string;
    N?: string;
}

type DynamoItem = Record<string, AttributeValue>;

function makeSharedInMemoryDynamoClient(
    storage: Map<string, DynamoItem>,
    tableExists: Set<string>,
): { send: (command: any, options?: any) => Promise<any>; destroy: () => void } {
    return {
        send: async (command: any, _options?: any): Promise<any> => {
            const name: string = command.constructor.name;
            const input = command.input;

            switch (name) {
                case 'DescribeTableCommand': {
                    if (!tableExists.has(input.TableName)) {
                        const err = new Error('Table not found');
                        (err as any).name = 'ResourceNotFoundException';
                        throw err;
                    }
                    return { Table: { TableName: input.TableName } };
                }

                case 'CreateTableCommand': {
                    if (tableExists.has(input.TableName)) {
                        const err = new Error('Table already exists');
                        (err as any).name = 'ResourceInUseException';
                        throw err;
                    }
                    tableExists.add(input.TableName);
                    return {};
                }

                case 'PutItemCommand': {
                    const bk = input.Item.bucket_key.S!;
                    const ek = input.Item.entry_key.S!;
                    storage.set(`${bk}||${ek}`, { ...input.Item });
                    return {};
                }

                case 'GetItemCommand': {
                    const bk = input.Key.bucket_key.S!;
                    const ek = input.Key.entry_key.S!;
                    const item = storage.get(`${bk}||${ek}`);
                    return { Item: item ?? undefined };
                }

                case 'DeleteItemCommand': {
                    const bk = input.Key.bucket_key.S!;
                    const ek = input.Key.entry_key.S!;
                    storage.delete(`${bk}||${ek}`);
                    return {};
                }

                case 'BatchWriteItemCommand': {
                    const tableName = Object.keys(input.RequestItems)[0]!;
                    const requests: any[] = input.RequestItems[tableName];
                    for (const req of requests) {
                        if (req.PutRequest) {
                            const item = req.PutRequest.Item;
                            const bk = item.bucket_key.S!;
                            const ek = item.entry_key.S!;
                            storage.set(`${bk}||${ek}`, { ...item });
                        }
                        if (req.DeleteRequest) {
                            const key = req.DeleteRequest.Key;
                            const bk = key.bucket_key.S!;
                            const ek = key.entry_key.S!;
                            storage.delete(`${bk}||${ek}`);
                        }
                    }
                    return { UnprocessedItems: {} };
                }

                case 'BatchGetItemCommand': {
                    const tableName = Object.keys(input.RequestItems)[0]!;
                    const keys: any[] = input.RequestItems[tableName].Keys;
                    const items: DynamoItem[] = [];
                    for (const key of keys) {
                        const bk = key.bucket_key.S!;
                        const ek = key.entry_key.S!;
                        const item = storage.get(`${bk}||${ek}`);
                        if (item) items.push(item);
                    }
                    return { Responses: { [tableName]: items } };
                }

                case 'QueryCommand': {
                    const tableName = input.TableName;
                    const bk =
                        input.ExpressionAttributeValues[':bk']?.S ??
                        input.ExpressionAttributeValues[':bucketKey']?.S;
                    const items: DynamoItem[] = [];
                    for (const [compositeKey, item] of storage) {
                        if (compositeKey.startsWith(`${bk}||`)) {
                            items.push(item);
                        }
                    }
                    return { Items: items };
                }

                default:
                    return {};
            }
        },
        destroy: () => {},
    };
}

// ═══════════════════════════════════════════════════════════
//  Provenance recording types
// ═══════════════════════════════════════════════════════════

type OperationKind = 'store' | 'storeAll' | 'delete' | 'deleteAll' | 'load' | 'loadAll' | 'loadAllKeys';

interface ProvenanceRecord {
    memberId: string;
    operationKind: OperationKind;
    keys: string[];
    ts: number;
}

// ═══════════════════════════════════════════════════════════
//  ProvenanceDynamoDbStore — wraps DynamoDbMapStore
// ═══════════════════════════════════════════════════════════

class ProvenanceDynamoDbStore implements MapStore<string, string> {
    readonly records: ProvenanceRecord[] = [];
    private readonly _inner: DynamoDbMapStore<string>;
    private readonly _memberId: string;
    private _instance: HeliosInstanceImpl | null = null;

    constructor(memberId: string, client: any) {
        this._memberId = memberId;
        this._inner = new DynamoDbMapStore<string>(
            {
                endpoint: 'http://mock:8000',
                autoCreateTable: true,
                bucketCount: 4,
            },
            client,
        );
    }

    get memberId(): string {
        return this._memberId;
    }

    setInstance(instance: HeliosInstanceImpl): void {
        this._instance = instance;
    }

    /** Initialize the underlying DynamoDbMapStore (called by Helios lifecycle). */
    async init(properties: Map<string, string>, mapName: string): Promise<void> {
        await this._inner.init(properties, mapName);
    }

    async destroy(): Promise<void> {
        await this._inner.destroy();
    }

    private _record(kind: OperationKind, keys: string[]): void {
        this.records.push({
            memberId: this._memberId,
            operationKind: kind,
            keys,
            ts: Date.now(),
        });
    }

    async store(key: string, value: string): Promise<void> {
        this._record('store', [key]);
        await this._inner.store(key, value);
    }

    async storeAll(entries: Map<string, string>): Promise<void> {
        this._record('storeAll', [...entries.keys()]);
        await this._inner.storeAll(entries);
    }

    async delete(key: string): Promise<void> {
        this._record('delete', [key]);
        await this._inner.delete(key);
    }

    async deleteAll(keys: string[]): Promise<void> {
        this._record('deleteAll', [...keys]);
        await this._inner.deleteAll(keys);
    }

    async load(key: string): Promise<string | null> {
        this._record('load', [key]);
        return this._inner.load(key);
    }

    async loadAll(keys: string[]): Promise<Map<string, string>> {
        this._record('loadAll', [...keys]);
        return this._inner.loadAll(keys);
    }

    async loadAllKeys(): Promise<MapKeyStream<string>> {
        this._record('loadAllKeys', []);
        return this._inner.loadAllKeys();
    }

    // ── Provenance query helpers ──

    reset(): void {
        this.records.length = 0;
    }

    writeRecords(): ProvenanceRecord[] {
        return this.records.filter(
            (r) =>
                r.operationKind === 'store' ||
                r.operationKind === 'storeAll' ||
                r.operationKind === 'delete' ||
                r.operationKind === 'deleteAll',
        );
    }

    totalStoreCount(): number {
        return this.records
            .filter((r) => r.operationKind === 'store' || r.operationKind === 'storeAll')
            .reduce((n, r) => n + r.keys.length, 0);
    }

    totalDeleteCount(): number {
        return this.records
            .filter((r) => r.operationKind === 'delete' || r.operationKind === 'deleteAll')
            .reduce((n, r) => n + r.keys.length, 0);
    }

    totalLoadCount(): number {
        return this.records
            .filter((r) => r.operationKind === 'load' || r.operationKind === 'loadAll')
            .reduce((n, r) => n + r.keys.length, 0);
    }
}

// ═══════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════

/** Same DJB2 hash as DynamoDbMapStore._bucketForKey */
function djb2Hash(key: string): number {
    let hash = 5381;
    for (let i = 0; i < key.length; i++) {
        hash = ((hash << 5) + hash + key.charCodeAt(i)) >>> 0;
    }
    return hash;
}

async function waitUntil(
    predicate: () => boolean | Promise<boolean>,
    timeoutMs = 5000,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!(await predicate())) {
        if (Date.now() >= deadline) {
            throw new Error(`waitUntil: timed out after ${timeoutMs} ms`);
        }
        await Bun.sleep(20);
    }
}

async function waitForClusterSize(
    instance: HeliosInstanceImpl,
    count: number,
): Promise<void> {
    await waitUntil(() => instance.getCluster().getMembers().length === count);
}

function findKeyOwnedBy(
    instance: HeliosInstanceImpl,
    ownerName: string,
    prefix = 'k',
): string {
    for (let i = 0; i < 1000; i++) {
        const key = `${prefix}-${i}`;
        const pid = instance.getPartitionIdForName(key);
        if (instance.getPartitionOwnerId(pid) === ownerName) return key;
    }
    throw new Error(`Could not find key owned by ${ownerName}`);
}

/**
 * Assert no duplicate physical writes: every written key appears in exactly
 * one store's provenance records (the partition owner's store).
 */
function assertNoDuplicatePhysicalWrites(
    storeA: ProvenanceDynamoDbStore,
    storeB: ProvenanceDynamoDbStore,
): void {
    const writtenByA = new Set<string>();
    const writtenByB = new Set<string>();
    for (const r of storeA.writeRecords()) r.keys.forEach((k) => writtenByA.add(k));
    for (const r of storeB.writeRecords()) r.keys.forEach((k) => writtenByB.add(k));
    for (const k of writtenByA) {
        if (writtenByB.has(k)) {
            throw new Error(`Duplicate physical write: key "${k}" written by both members`);
        }
    }
}

/**
 * Assert provenance: every write record's memberId matches the partition owner
 * for all keys in that record.
 */
function assertProvenanceOwnerOnly(
    storeA: ProvenanceDynamoDbStore,
    storeB: ProvenanceDynamoDbStore,
    instance: HeliosInstanceImpl,
): void {
    for (const r of storeA.writeRecords()) {
        for (const key of r.keys) {
            const pid = instance.getPartitionIdForName(key);
            expect(instance.getPartitionOwnerId(pid)).toBe(r.memberId);
        }
    }
    for (const r of storeB.writeRecords()) {
        for (const key of r.keys) {
            const pid = instance.getPartitionIdForName(key);
            expect(instance.getPartitionOwnerId(pid)).toBe(r.memberId);
        }
    }
}

// ═══════════════════════════════════════════════════════════
//  Cluster factory helpers
// ═══════════════════════════════════════════════════════════

function makeWriteThroughConfig(
    name: string,
    port: number,
    peerPorts: number[],
    mapName: string,
    store: ProvenanceDynamoDbStore,
): HeliosConfig {
    const cfg = new HeliosConfig(name);
    cfg.getNetworkConfig()
        .setPort(port)
        .getJoin()
        .getTcpIpConfig()
        .setEnabled(true);
    for (const pp of peerPorts) {
        cfg.getNetworkConfig().getJoin().getTcpIpConfig().addMember(`localhost:${pp}`);
    }
    const msCfg = new MapStoreConfig();
    msCfg.setEnabled(true);
    msCfg.setImplementation(store);
    const mc = new MapConfig();
    mc.setName(mapName);
    mc.setMapStoreConfig(msCfg);
    cfg.addMapConfig(mc);
    return cfg;
}

function makeWriteBehindConfig(
    name: string,
    port: number,
    peerPorts: number[],
    mapName: string,
    store: ProvenanceDynamoDbStore,
    delaySeconds = 1,
    batchSize = 1,
    coalescing = false,
): HeliosConfig {
    const cfg = new HeliosConfig(name);
    cfg.getNetworkConfig()
        .setPort(port)
        .getJoin()
        .getTcpIpConfig()
        .setEnabled(true);
    for (const pp of peerPorts) {
        cfg.getNetworkConfig().getJoin().getTcpIpConfig().addMember(`localhost:${pp}`);
    }
    const msCfg = new MapStoreConfig();
    msCfg.setEnabled(true);
    msCfg.setImplementation(store);
    msCfg.setWriteDelaySeconds(delaySeconds);
    msCfg.setWriteBatchSize(batchSize);
    msCfg.setWriteCoalescing(coalescing);
    const mc = new MapConfig();
    mc.setName(mapName);
    mc.setMapStoreConfig(msCfg);
    cfg.addMapConfig(mc);
    return cfg;
}

async function startTwoNodeWriteThrough(
    instances: HeliosInstanceImpl[],
    mapName: string,
    storeA: ProvenanceDynamoDbStore,
    storeB: ProvenanceDynamoDbStore,
): Promise<[HeliosInstanceImpl, HeliosInstanceImpl]> {
    const portA = nextPort();
    const portB = nextPort();
    const a = await Helios.newInstance(
        makeWriteThroughConfig('dynA', portA, [], mapName, storeA),
    );
    instances.push(a);
    storeA.setInstance(a);
    const b = await Helios.newInstance(
        makeWriteThroughConfig('dynB', portB, [portA], mapName, storeB),
    );
    instances.push(b);
    storeB.setInstance(b);
    await waitForClusterSize(a, 2);
    await waitForClusterSize(b, 2);
    return [a, b];
}

async function startTwoNodeWriteBehind(
    instances: HeliosInstanceImpl[],
    mapName: string,
    storeA: ProvenanceDynamoDbStore,
    storeB: ProvenanceDynamoDbStore,
    delaySeconds = 1,
    batchSize = 1,
    coalescing = false,
): Promise<[HeliosInstanceImpl, HeliosInstanceImpl]> {
    const portA = nextPort();
    const portB = nextPort();
    const a = await Helios.newInstance(
        makeWriteBehindConfig('dynA', portA, [], mapName, storeA, delaySeconds, batchSize, coalescing),
    );
    instances.push(a);
    storeA.setInstance(a);
    const b = await Helios.newInstance(
        makeWriteBehindConfig('dynB', portB, [portA], mapName, storeB, delaySeconds, batchSize, coalescing),
    );
    instances.push(b);
    storeB.setInstance(b);
    await waitForClusterSize(a, 2);
    await waitForClusterSize(b, 2);
    return [a, b];
}

// ═══════════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════════

describe('DynamoDbMapStore — clustered owner-only proof (Step 10)', () => {
    const instances: HeliosInstanceImpl[] = [];

    afterEach(async () => {
        for (const inst of instances) {
            if (inst.isRunning()) inst.shutdown();
        }
        instances.length = 0;
        await Bun.sleep(30);
    });

    // ───────────────────────────────────────────────────────
    //  10.1 Owner-only write-through
    // ───────────────────────────────────────────────────────

    it('10.1 — owner-only write-through: put routes store() to partition owner only', async () => {
        const storage = new Map<string, DynamoItem>();
        const tables = new Set<string>();
        const clientA = makeSharedInMemoryDynamoClient(storage, tables);
        const clientB = makeSharedInMemoryDynamoClient(storage, tables);
        const sA = new ProvenanceDynamoDbStore('dynA', clientA);
        const sB = new ProvenanceDynamoDbStore('dynB', clientB);
        const [a, b] = await startTwoNodeWriteThrough(instances, 'ddb-wt-put', sA, sB);

        const key = findKeyOwnedBy(a, a.getName(), 'dwt');
        await b.getMap<string, string>('ddb-wt-put').put(key, 'v1');

        expect(sA.totalStoreCount()).toBe(1);
        expect(sB.totalStoreCount()).toBe(0);
        assertNoDuplicatePhysicalWrites(sA, sB);
        assertProvenanceOwnerOnly(sA, sB, a);

        // Value is accessible from shared DynamoDB storage
        const loaded = await sA['_inner'].load(key);
        expect(loaded).toBe('v1');
    });

    // ───────────────────────────────────────────────────────
    //  10.2 Owner-only write-behind
    // ───────────────────────────────────────────────────────

    it('10.2 — owner-only write-behind: after flush, only owner issued storeAll', async () => {
        const storage = new Map<string, DynamoItem>();
        const tables = new Set<string>();
        const clientA = makeSharedInMemoryDynamoClient(storage, tables);
        const clientB = makeSharedInMemoryDynamoClient(storage, tables);
        const sA = new ProvenanceDynamoDbStore('dynA', clientA);
        const sB = new ProvenanceDynamoDbStore('dynB', clientB);
        const [a, b] = await startTwoNodeWriteBehind(instances, 'ddb-wb-put', sA, sB);

        const key = findKeyOwnedBy(a, a.getName(), 'dwb');
        await b.getMap<string, string>('ddb-wb-put').put(key, 'wb-v1');

        await waitUntil(() => sA.totalStoreCount() >= 1, 3000);

        expect(sA.totalStoreCount()).toBeGreaterThanOrEqual(1);
        expect(sB.totalStoreCount()).toBe(0);
        assertProvenanceOwnerOnly(sA, sB, a);
    });

    // ───────────────────────────────────────────────────────
    //  10.3 Owner-only delete
    // ───────────────────────────────────────────────────────

    it('10.3 — owner-only delete: remove() calls delete on owner store only', async () => {
        const storage = new Map<string, DynamoItem>();
        const tables = new Set<string>();
        const clientA = makeSharedInMemoryDynamoClient(storage, tables);
        const clientB = makeSharedInMemoryDynamoClient(storage, tables);
        const sA = new ProvenanceDynamoDbStore('dynA', clientA);
        const sB = new ProvenanceDynamoDbStore('dynB', clientB);
        const [a, b] = await startTwoNodeWriteThrough(instances, 'ddb-wt-rm', sA, sB);

        const key = findKeyOwnedBy(a, a.getName(), 'drm');
        await a.getMap<string, string>('ddb-wt-rm').put(key, 'to-delete');
        sA.reset();
        sB.reset();

        await b.getMap<string, string>('ddb-wt-rm').remove(key);
        expect(sA.totalDeleteCount()).toBe(1);
        expect(sB.totalDeleteCount()).toBe(0);
        assertNoDuplicatePhysicalWrites(sA, sB);
        assertProvenanceOwnerOnly(sA, sB, a);
    });

    // ───────────────────────────────────────────────────────
    //  10.4 Owner-only load-on-miss
    // ───────────────────────────────────────────────────────

    it('10.4 — owner-only load-on-miss: get() on DynamoDB-backed key loads from owner only', async () => {
        const storage = new Map<string, DynamoItem>();
        const tables = new Set<string>();
        const clientA = makeSharedInMemoryDynamoClient(storage, tables);
        const clientB = makeSharedInMemoryDynamoClient(storage, tables);
        const sA = new ProvenanceDynamoDbStore('dynA', clientA);
        const sB = new ProvenanceDynamoDbStore('dynB', clientB);
        const [a, b] = await startTwoNodeWriteThrough(instances, 'ddb-wt-load', sA, sB);

        const key = findKeyOwnedBy(a, a.getName(), 'dld');
        // Seed directly into shared DynamoDB storage (bypassing provenance)
        const mapName = 'ddb-wt-load';
        const bucket = djb2Hash(key) % 4;
        const bucketKey = `${mapName}#${bucket}`;
        storage.set(`${bucketKey}||${key}`, {
            bucket_key: { S: bucketKey },
            entry_key: { S: key },
            entry_value: { S: JSON.stringify('ext-value') },
            updated_at: { N: `${Date.now()}` },
        });
        sA.reset();
        sB.reset();

        const val = await b.getMap<string, string>('ddb-wt-load').get(key);
        expect(val).toBe('ext-value');

        const aLoads = sA.records.filter((r) => r.operationKind === 'load');
        expect(aLoads.length).toBe(1);
        expect(aLoads[0]!.memberId).toBe('dynA');
        expect(sB.records.filter((r) => r.operationKind === 'load').length).toBe(0);
    });

    // ───────────────────────────────────────────────────────
    //  10.5 Clustered clear — no duplicate deletes
    // ───────────────────────────────────────────────────────

    it('10.5 — clustered clear: no duplicate external deletes across stores', async () => {
        const storage = new Map<string, DynamoItem>();
        const tables = new Set<string>();
        const clientA = makeSharedInMemoryDynamoClient(storage, tables);
        const clientB = makeSharedInMemoryDynamoClient(storage, tables);
        const sA = new ProvenanceDynamoDbStore('dynA', clientA);
        const sB = new ProvenanceDynamoDbStore('dynB', clientB);
        const [a, _b] = await startTwoNodeWriteThrough(instances, 'ddb-wt-clr', sA, sB);

        const mapA = a.getMap<string, string>('ddb-wt-clr');
        for (let i = 0; i < 10; i++) await mapA.put(`dclr-${i}`, `v-${i}`);
        sA.reset();
        sB.reset();

        await mapA.clear();
        expect(mapA.size()).toBe(0);

        // Total external deletes should not exceed the number of entries
        const totalDeletes = sA.totalDeleteCount() + sB.totalDeleteCount();
        expect(totalDeletes).toBeLessThanOrEqual(10);

        // No key should appear in delete records of both stores (no duplicate)
        const deletedByA = new Set<string>();
        const deletedByB = new Set<string>();
        for (const r of sA.writeRecords()) {
            if (r.operationKind === 'delete' || r.operationKind === 'deleteAll') {
                r.keys.forEach((k) => deletedByA.add(k));
            }
        }
        for (const r of sB.writeRecords()) {
            if (r.operationKind === 'delete' || r.operationKind === 'deleteAll') {
                r.keys.forEach((k) => deletedByB.add(k));
            }
        }
        for (const k of deletedByA) {
            expect(deletedByB.has(k)).toBe(false);
        }
    });

    // ───────────────────────────────────────────────────────
    //  10.6 putAll — owner-only batched writes
    // ───────────────────────────────────────────────────────

    it('10.6 — putAll routes each key store to its partition owner only', async () => {
        const storage = new Map<string, DynamoItem>();
        const tables = new Set<string>();
        const clientA = makeSharedInMemoryDynamoClient(storage, tables);
        const clientB = makeSharedInMemoryDynamoClient(storage, tables);
        const sA = new ProvenanceDynamoDbStore('dynA', clientA);
        const sB = new ProvenanceDynamoDbStore('dynB', clientB);
        const [a, _b] = await startTwoNodeWriteThrough(instances, 'ddb-wt-pa', sA, sB);

        const entries: [string, string][] = [];
        for (let i = 0; i < 30; i++) entries.push([`dpa-${i}`, `v-${i}`]);

        await a.getMap<string, string>('ddb-wt-pa').putAll(entries);

        const total = sA.totalStoreCount() + sB.totalStoreCount();
        expect(total).toBe(entries.length);
        assertNoDuplicatePhysicalWrites(sA, sB);
        assertProvenanceOwnerOnly(sA, sB, a);

        // Verify values actually landed in shared DynamoDB storage
        for (const [key, value] of entries) {
            const loaded = await sA['_inner'].load(key);
            expect(loaded).toBe(value);
        }
    });
});

describe('DynamoDbMapStore — failover & migration (Step 11)', () => {
    const instances: HeliosInstanceImpl[] = [];

    afterEach(async () => {
        for (const inst of instances) {
            if (inst.isRunning()) inst.shutdown();
        }
        instances.length = 0;
        await Bun.sleep(30);
    });

    // ───────────────────────────────────────────────────────
    //  11.1 Shutdown with write-behind pending
    // ───────────────────────────────────────────────────────

    it('11.1 — graceful shutdown flushes pending write-behind entries', async () => {
        const storage = new Map<string, DynamoItem>();
        const tables = new Set<string>();
        const clientA = makeSharedInMemoryDynamoClient(storage, tables);
        const clientB = makeSharedInMemoryDynamoClient(storage, tables);
        const sA = new ProvenanceDynamoDbStore('dynA', clientA);
        const sB = new ProvenanceDynamoDbStore('dynB', clientB);
        const [a, b] = await startTwoNodeWriteBehind(instances, 'ddb-wb-sd', sA, sB, 5);

        const keyOwnedByA = findKeyOwnedBy(a, a.getName(), 'wbsd');
        const mapA = a.getMap<string, string>('ddb-wb-sd');

        await mapA.put(keyOwnedByA, 'pending-value');

        // Before delay expires, no external write yet
        expect(sA.totalStoreCount()).toBe(0);

        // Graceful shutdown flushes
        await (a as any).shutdownAsync();

        // Pending write should have been flushed by A's shutdown
        expect(sA.totalStoreCount()).toBeGreaterThanOrEqual(1);
    });

    // ───────────────────────────────────────────────────────
    //  11.2 Owner promotion after shutdown
    // ───────────────────────────────────────────────────────

    it('11.2 — remaining node becomes owner for all partitions after shutdown', async () => {
        const storage = new Map<string, DynamoItem>();
        const tables = new Set<string>();
        const clientA = makeSharedInMemoryDynamoClient(storage, tables);
        const clientB = makeSharedInMemoryDynamoClient(storage, tables);
        const sA = new ProvenanceDynamoDbStore('dynA', clientA);
        const sB = new ProvenanceDynamoDbStore('dynB', clientB);
        const [a, b] = await startTwoNodeWriteThrough(instances, 'ddb-promo', sA, sB);

        // Write keys owned by A
        const keys: string[] = [];
        for (let i = 0; i < 10; i++) {
            const key = findKeyOwnedBy(a, a.getName(), `prom-${i}`);
            await a.getMap<string, string>('ddb-promo').put(key, `v-${i}`);
            keys.push(key);
        }
        sA.reset();
        sB.reset();

        // Shut down A — B promotes to owner of everything
        a.shutdown();
        await waitForClusterSize(b, 1);

        // Subsequent puts go through B's external store
        const mapB = b.getMap<string, string>('ddb-promo');
        for (const key of keys) {
            await mapB.put(key, 'promoted-value');
        }

        expect(sB.totalStoreCount()).toBe(keys.length);
        expect(sA.totalStoreCount()).toBe(0);
    });

    // ───────────────────────────────────────────────────────
    //  11.3 Graceful shutdown handoff — no data loss
    // ───────────────────────────────────────────────────────

    it('11.3 — write-behind entries are flushed during shutdown, no data loss', async () => {
        const storage = new Map<string, DynamoItem>();
        const tables = new Set<string>();
        const clientA = makeSharedInMemoryDynamoClient(storage, tables);
        const clientB = makeSharedInMemoryDynamoClient(storage, tables);
        const sA = new ProvenanceDynamoDbStore('dynA', clientA);
        const sB = new ProvenanceDynamoDbStore('dynB', clientB);
        const [a, b] = await startTwoNodeWriteBehind(instances, 'ddb-wb-handoff', sA, sB, 10);

        const mapA = a.getMap<string, string>('ddb-wb-handoff');
        const keys: string[] = [];
        for (let i = 0; i < 5; i++) {
            const key = findKeyOwnedBy(a, a.getName(), `wbho-${i}`);
            await mapA.put(key, `val-${i}`);
            keys.push(key);
        }

        // No writes yet (10s delay)
        expect(sA.totalStoreCount()).toBe(0);

        // Graceful shutdown flushes all pending
        await (a as any).shutdownAsync();

        expect(sA.totalStoreCount()).toBeGreaterThanOrEqual(5);

        // Verify data is readable from shared storage after flush
        for (let i = 0; i < keys.length; i++) {
            // The data should be in the shared storage map because clientA writes to it
            const key = keys[i]!;
            const loaded = await sA['_inner'].load(key);
            expect(loaded).toBe(`val-${i}`);
        }
    });

    // ───────────────────────────────────────────────────────
    //  11.4 Replay-safe convergence
    // ───────────────────────────────────────────────────────

    it('11.4 — replay-safe convergence: new owner converges to latest value after failover', async () => {
        const storage = new Map<string, DynamoItem>();
        const tables = new Set<string>();
        const clientA = makeSharedInMemoryDynamoClient(storage, tables);
        const clientB = makeSharedInMemoryDynamoClient(storage, tables);
        const sA = new ProvenanceDynamoDbStore('dynA', clientA);
        const sB = new ProvenanceDynamoDbStore('dynB', clientB);
        const [a, b] = await startTwoNodeWriteThrough(instances, 'ddb-replay', sA, sB);

        const key = findKeyOwnedBy(a, a.getName(), 'rpl');

        // Update the same key twice through the cluster
        await a.getMap<string, string>('ddb-replay').put(key, 'first');
        await a.getMap<string, string>('ddb-replay').put(key, 'second');

        // Shut down A — B becomes owner
        a.shutdown();
        await waitForClusterSize(b, 1);

        // The new owner should see the latest value (from in-memory replication)
        const mapB = b.getMap<string, string>('ddb-replay');
        const val = await mapB.get(key);
        expect(val).toBe('second');

        // If we write through B now, B's store records the write
        sB.reset();
        await mapB.put(key, 'third');
        expect(sB.totalStoreCount()).toBe(1);

        // Shared DynamoDB storage has the latest value
        const loaded = await sB['_inner'].load(key);
        expect(loaded).toBe('third');
    });

    // ───────────────────────────────────────────────────────
    //  11.5 Bidirectional ownership — both nodes serve as
    //       DynamoDB writers pre-failover
    // ───────────────────────────────────────────────────────

    it('11.5 — bidirectional ownership: both nodes write to shared DynamoDB, post-failover sole owner', async () => {
        const storage = new Map<string, DynamoItem>();
        const tables = new Set<string>();
        const clientA = makeSharedInMemoryDynamoClient(storage, tables);
        const clientB = makeSharedInMemoryDynamoClient(storage, tables);
        const sA = new ProvenanceDynamoDbStore('dynA', clientA);
        const sB = new ProvenanceDynamoDbStore('dynB', clientB);
        const [a, b] = await startTwoNodeWriteThrough(instances, 'ddb-bidir', sA, sB);

        const mapA = a.getMap<string, string>('ddb-bidir');
        const keyA = findKeyOwnedBy(a, a.getName(), 'bdA');
        const keyB = findKeyOwnedBy(a, b.getName(), 'bdB');

        await mapA.put(keyA, 'val-A');
        await mapA.put(keyB, 'val-B');

        // A's store wrote keyA, B's store wrote keyB
        expect(sA.records.some((r) => r.keys.includes(keyA))).toBe(true);
        expect(sB.records.some((r) => r.keys.includes(keyB))).toBe(true);
        assertNoDuplicatePhysicalWrites(sA, sB);
        assertProvenanceOwnerOnly(sA, sB, a);

        // Both values in shared DynamoDB
        const loadedA = await sA['_inner'].load(keyA);
        const loadedB = await sB['_inner'].load(keyB);
        expect(loadedA).toBe('val-A');
        expect(loadedB).toBe('val-B');

        // Shut down A — B becomes sole owner
        a.shutdown();
        await waitForClusterSize(b, 1);
        sA.reset();
        sB.reset();

        const mapB = b.getMap<string, string>('ddb-bidir');
        await mapB.put(keyA, 'promoted-A');
        await mapB.put(keyB, 'promoted-B');

        // All writes now go through B
        expect(sB.totalStoreCount()).toBe(2);
        expect(sA.totalStoreCount()).toBe(0);
    });

    // ───────────────────────────────────────────────────────
    //  11.6 Write-behind failover: shutdown + promotion
    //       converges write-behind pending data
    // ───────────────────────────────────────────────────────

    it('11.6 — write-behind failover: promoted node continues with no duplicate writes', async () => {
        const storage = new Map<string, DynamoItem>();
        const tables = new Set<string>();
        const clientA = makeSharedInMemoryDynamoClient(storage, tables);
        const clientB = makeSharedInMemoryDynamoClient(storage, tables);
        const sA = new ProvenanceDynamoDbStore('dynA', clientA);
        const sB = new ProvenanceDynamoDbStore('dynB', clientB);
        const [a, b] = await startTwoNodeWriteBehind(instances, 'ddb-wb-fo', sA, sB, 2);

        const keyOwnedByA = findKeyOwnedBy(a, a.getName(), 'wbfo');
        await a.getMap<string, string>('ddb-wb-fo').put(keyOwnedByA, 'pre-failover');

        // Graceful shutdown flushes pending
        await (a as any).shutdownAsync();
        await waitForClusterSize(b, 1);

        expect(sA.totalStoreCount()).toBeGreaterThanOrEqual(1);

        // B can now write to the same key as the promoted owner
        sB.reset();
        const mapB = b.getMap<string, string>('ddb-wb-fo');
        await mapB.put(keyOwnedByA, 'post-failover');

        await waitUntil(() => sB.totalStoreCount() >= 1, 3000);
        expect(sB.totalStoreCount()).toBeGreaterThanOrEqual(1);

        // Shared storage has latest value
        const loaded = await sB['_inner'].load(keyOwnedByA);
        expect(loaded).toBe('post-failover');
    });
});
