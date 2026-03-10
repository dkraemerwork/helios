/**
 * Transactional MultiMap proxy — Block G.
 *
 * Port of {@code com.hazelcast.multimap.impl.tx.TransactionalMultiMapProxy}.
 *
 * put, get, remove, removeAll, valueCount, size — all operations go through
 * the transaction log. Changes are isolated until commit/rollback.
 */
import type { Data } from '@zenystx/helios-core/internal/serialization/Data.js';
import type { MultiMap } from '@zenystx/helios-core/multimap/MultiMap.js';
import type { NodeEngine } from '@zenystx/helios-core/spi/NodeEngine.js';
import { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation.js';
import type { TransactionBackupRecord } from '@zenystx/helios-core/transaction/impl/TransactionBackupRecord.js';
import { State } from '@zenystx/helios-core/transaction/impl/Transaction.js';
import type { TransactionImpl } from '@zenystx/helios-core/transaction/impl/TransactionImpl.js';
import type { TransactionLogRecord } from '@zenystx/helios-core/transaction/impl/TransactionLogRecord.js';
import { encodeMaybeData } from '@zenystx/helios-core/transaction/impl/TransactionManagerServiceImpl.js';
import { TransactionNotActiveException } from '@zenystx/helios-core/transaction/TransactionNotActiveException.js';

type MultiMapOpType = 'put' | 'remove' | 'removeAll';

type MaybePromise<T> = T | Promise<T>;

interface MultiMapBackend<K, V> {
    put(key: K, value: V, dedupeId?: string): MaybePromise<boolean>;
    get(key: K): MaybePromise<Iterable<V>>;
    remove(key: K, value: V, dedupeId?: string): MaybePromise<boolean>;
    removeAll(key: K, dedupeId?: string): MaybePromise<Iterable<V>>;
    valueCount(key: K): MaybePromise<number>;
    size(): MaybePromise<number>;
}

class NoopMultiMapOperation extends Operation {
    async run(): Promise<void> { this.sendResponse(null); }
}

class CommitMultiMapOperation<K, V> extends Operation {
    private readonly _recordId: string;
    private readonly _mmOpType: MultiMapOpType;
    private readonly _mmKeyData: Data;
    private readonly _mmValueData: Data | null;
    private readonly _mmBackend: MultiMapBackend<K, V>;
    private readonly _mmNodeEngine: NodeEngine;

    constructor(
        recordId: string,
        opType: MultiMapOpType,
        keyData: Data,
        valueData: Data | null,
        backend: MultiMapBackend<K, V>,
        nodeEngine: NodeEngine,
    ) {
        super();
        this._recordId = recordId;
        this._mmOpType = opType;
        this._mmKeyData = keyData;
        this._mmValueData = valueData;
        this._mmBackend = backend;
        this._mmNodeEngine = nodeEngine;
    }

    async run(): Promise<void> {
        const key = this._mmKeyData as unknown as K;

        switch (this._mmOpType) {
            case 'put':
                if (this._mmValueData !== null) {
                    await this._mmBackend.put(key, this._mmValueData as unknown as V, this._recordId);
                }
                break;
            case 'remove':
                if (this._mmValueData !== null) {
                    await this._mmBackend.remove(key, this._mmValueData as unknown as V, this._recordId);
                }
                break;
            case 'removeAll':
                await this._mmBackend.removeAll(key, this._recordId);
                break;
        }

        this.sendResponse(null);
    }
}

class TransactionalMultiMapLogRecord<K, V> implements TransactionLogRecord {
    private readonly _recordId: string;
    private readonly _opType: MultiMapOpType;
    private readonly _keyData: Data;
    private readonly _valueData: Data | null;
    private readonly _backend: MultiMapBackend<K, V>;
    private readonly _nodeEngine: NodeEngine;

    constructor(
        recordId: string,
        opType: MultiMapOpType,
        keyData: Data,
        valueData: Data | null,
        backend: MultiMapBackend<K, V>,
        nodeEngine: NodeEngine,
    ) {
        this._recordId = recordId;
        this._opType = opType;
        this._keyData = keyData;
        this._valueData = valueData;
        this._backend = backend;
        this._nodeEngine = nodeEngine;
    }

    getKey(): unknown { return this._recordId; }
    getRecordId(): string { return this._recordId; }
    newPrepareOperation(): Operation { return new NoopMultiMapOperation(); }
    newCommitOperation(): Operation {
        return new CommitMultiMapOperation(
            this._recordId,
            this._opType,
            this._keyData,
            this._valueData,
            this._backend,
            this._nodeEngine,
        );
    }
    newRollbackOperation(): Operation { return new NoopMultiMapOperation(); }
    toBackupRecord(): TransactionBackupRecord {
        return {
            recordId: this._recordId,
            kind: 'multimap',
            mapName: this._recordId.split(':', 2)[0],
            opType: this._opType,
            keyData: encodeMaybeData(this._keyData)!,
            valueData: encodeMaybeData(this._valueData),
        };
    }
    onCommitSuccess(): void { /* nothing */ }
    onCommitFailure(): void { /* nothing */ }
}

export class TransactionalMultiMapProxy<K, V> {
    private readonly _multiMapName: string;
    private readonly _tx: TransactionImpl;
    private readonly _nodeEngine: NodeEngine;
    private readonly _backend: MultiMapBackend<K, V>;

    /** Pending puts: key-string → array of pending values. */
    private readonly _pendingPuts = new Map<string, {
        keyData: Data;
        values: Array<{ value: V; valueData: Data; recordId: string }>;
    }>();
    /** Pending removes by (key, value) pair. */
    private readonly _pendingRemoves = new Map<string, { keyData: Data; valueData: Data }[]>();
    /** Pending removeAll: key-strings with all values removed. */
    private readonly _pendingRemoveAlls = new Set<string>();

    constructor(
        multiMapName: string,
        tx: TransactionImpl,
        nodeEngine: NodeEngine,
        backend: MultiMapBackend<K, V>,
    ) {
        this._multiMapName = multiMapName;
        this._tx = tx;
        this._nodeEngine = nodeEngine;
        this._backend = backend;
    }

    put(key: K, value: V): boolean {
        this._checkActive();
        const kd = this._toData(key);
        const vd = this._toData(value);
        const ks = this._keyStr(kd);

        let entry = this._pendingPuts.get(ks);
        if (!entry) {
            entry = { keyData: kd, values: [] };
            this._pendingPuts.set(ks, entry);
        }
        const recordId = `${this._multiMapName}:put:${ks}:${crypto.randomUUID()}`;
        entry.values.push({ value, valueData: vd, recordId });
        this._pendingRemoveAlls.delete(ks);

        const record = new TransactionalMultiMapLogRecord(
            recordId,
            'put',
            kd,
            vd,
            this._backend,
            this._nodeEngine,
        );
        this._tx.add(record);
        return true;
    }

    async get(key: K): Promise<V[]> {
        this._checkActive();
        const kd = this._toData(key);
        const ks = this._keyStr(kd);

        if (this._pendingRemoveAlls.has(ks)) {
            return (this._pendingPuts.get(ks)?.values ?? []).map((entry) => entry.value);
        }

        const committed: V[] = [];
        const committedCollection = await this._backend.get(key);
        for (const v of committedCollection) {
            committed.push(v);
        }

        const pendingEntry = this._pendingPuts.get(ks);
        const pendingRemoves = this._pendingRemoves.get(ks) ?? [];

        // Filter out committed values that have pending removes
        const filtered = committed.filter((v) => {
            const vd = this._toData(v);
            const vStr = this._keyStr(vd);
            return !pendingRemoves.some((r) => this._keyStr(r.valueData) === vStr);
        });

        return [...filtered, ...((pendingEntry?.values ?? []).map((entry) => entry.value))];
    }

    remove(key: K, value: V): boolean {
        this._checkActive();
        const kd = this._toData(key);
        const vd = this._toData(value);
        const ks = this._keyStr(kd);

        // Check if it's in pending puts first
        const pendingEntry = this._pendingPuts.get(ks);
        if (pendingEntry) {
            const idx = pendingEntry.values.findIndex((entry) => {
                try { return JSON.stringify(entry.value) === JSON.stringify(value); } catch { return false; }
            });
            if (idx !== -1) {
                const [removedPending] = pendingEntry.values.splice(idx, 1);
                this._tx.remove(removedPending.recordId);
                if (pendingEntry.values.length === 0) {
                    this._pendingPuts.delete(ks);
                }
                return true;
            }
        }

        // Remove from committed store at commit time
        let removes = this._pendingRemoves.get(ks);
        if (!removes) {
            removes = [];
            this._pendingRemoves.set(ks, removes);
        }
        removes.push({ keyData: kd, valueData: vd });

        const record = new TransactionalMultiMapLogRecord(
            `${this._multiMapName}:remove:${ks}:${crypto.randomUUID()}`,
            'remove',
            kd,
            vd,
            this._backend,
            this._nodeEngine,
        );
        this._tx.add(record);
        return true;
    }

    async removeAll(key: K): Promise<V[]> {
        this._checkActive();
        const existing = await this.get(key);
        const kd = this._toData(key);
        const ks = this._keyStr(kd);

        this._pendingPuts.delete(ks);
        this._pendingRemoves.delete(ks);
        this._pendingRemoveAlls.add(ks);

        const record = new TransactionalMultiMapLogRecord(
            `${this._multiMapName}:removeAll:${ks}`,
            'removeAll',
            kd,
            null,
            this._backend,
            this._nodeEngine,
        );
        this._tx.add(record);
        return existing;
    }

    async valueCount(key: K): Promise<number> {
        this._checkActive();
        return (await this.get(key)).length;
    }

    async size(): Promise<number> {
        this._checkActive();
        let total = await this._backend.size();
        for (const [, entry] of this._pendingPuts) {
            total += entry.values.length;
        }
        for (const [, removes] of this._pendingRemoves) {
            total -= removes.length;
        }
        for (const ks of this._pendingRemoveAlls) {
            // Already subtracted pending adds above; only count committed entries
            const kd = this._pendingPuts.get(ks)?.keyData ?? null;
            if (kd !== null) {
                // committed entries for this key
                const key = this._nodeEngine.toObject<K>(kd);
                if (key !== null) {
                    total -= await this._backend.valueCount(key);
                }
            }
        }
        return Math.max(0, total);
    }

    private _checkActive(): void {
        if (this._tx.getState() !== State.ACTIVE) {
            throw new TransactionNotActiveException('Transaction is not active');
        }
    }

    private _toData(obj: unknown): Data {
        if (
            obj !== null
            && typeof obj === 'object'
            && typeof (obj as { toByteArray?: unknown }).toByteArray === 'function'
            && typeof (obj as { equals?: unknown }).equals === 'function'
        ) {
            return obj as Data;
        }
        const d = this._nodeEngine.toData(obj);
        if (d === null) throw new Error('Cannot serialize null');
        return d;
    }

    private _keyStr(data: Data): string {
        return data.toByteArray()?.join(',') ?? '';
    }
}
