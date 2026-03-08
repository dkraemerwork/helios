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
import { State } from '@zenystx/helios-core/transaction/impl/Transaction.js';
import type { TransactionImpl } from '@zenystx/helios-core/transaction/impl/TransactionImpl.js';
import type { TransactionLogRecord } from '@zenystx/helios-core/transaction/impl/TransactionLogRecord.js';
import { TransactionNotActiveException } from '@zenystx/helios-core/transaction/TransactionNotActiveException.js';

type MultiMapOpType = 'put' | 'remove' | 'removeAll';

class NoopMultiMapOperation extends Operation {
    async run(): Promise<void> { this.sendResponse(null); }
}

class CommitMultiMapOperation<K, V> extends Operation {
    private readonly _mmOpType: MultiMapOpType;
    private readonly _mmKeyData: Data;
    private readonly _mmValueData: Data | null;
    private readonly _mmBackend: MultiMap<K, V>;
    private readonly _mmNodeEngine: NodeEngine;

    constructor(
        opType: MultiMapOpType,
        keyData: Data,
        valueData: Data | null,
        backend: MultiMap<K, V>,
        nodeEngine: NodeEngine,
    ) {
        super();
        this._mmOpType = opType;
        this._mmKeyData = keyData;
        this._mmValueData = valueData;
        this._mmBackend = backend;
        this._mmNodeEngine = nodeEngine;
    }

    async run(): Promise<void> {
        const key = this._mmNodeEngine.toObject<K>(this._mmKeyData);
        if (key === null) { this.sendResponse(null); return; }

        switch (this._mmOpType) {
            case 'put':
                if (this._mmValueData !== null) {
                    const value = this._mmNodeEngine.toObject<V>(this._mmValueData);
                    if (value !== null) this._mmBackend.put(key, value);
                }
                break;
            case 'remove':
                if (this._mmValueData !== null) {
                    const value = this._mmNodeEngine.toObject<V>(this._mmValueData);
                    if (value !== null) this._mmBackend.remove(key, value);
                }
                break;
            case 'removeAll':
                this._mmBackend.removeAll(key);
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
    private readonly _backend: MultiMap<K, V>;
    private readonly _nodeEngine: NodeEngine;

    constructor(
        recordId: string,
        opType: MultiMapOpType,
        keyData: Data,
        valueData: Data | null,
        backend: MultiMap<K, V>,
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
    newPrepareOperation(): Operation { return new NoopMultiMapOperation(); }
    newCommitOperation(): Operation {
        return new CommitMultiMapOperation(
            this._opType,
            this._keyData,
            this._valueData,
            this._backend,
            this._nodeEngine,
        );
    }
    newRollbackOperation(): Operation { return new NoopMultiMapOperation(); }
    onCommitSuccess(): void { /* nothing */ }
    onCommitFailure(): void { /* nothing */ }
}

export class TransactionalMultiMapProxy<K, V> {
    private readonly _multiMapName: string;
    private readonly _tx: TransactionImpl;
    private readonly _nodeEngine: NodeEngine;
    private readonly _backend: MultiMap<K, V>;

    /** Pending puts: key-string → array of pending values. */
    private readonly _pendingPuts = new Map<string, { keyData: Data; values: V[] }>();
    /** Pending removes by (key, value) pair. */
    private readonly _pendingRemoves = new Map<string, { keyData: Data; valueData: Data }[]>();
    /** Pending removeAll: key-strings with all values removed. */
    private readonly _pendingRemoveAlls = new Set<string>();

    constructor(
        multiMapName: string,
        tx: TransactionImpl,
        nodeEngine: NodeEngine,
        backend: MultiMap<K, V>,
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
        entry.values.push(value);
        this._pendingRemoveAlls.delete(ks);

        const record = new TransactionalMultiMapLogRecord(
            `${this._multiMapName}:put:${ks}:${crypto.randomUUID()}`,
            'put',
            kd,
            vd,
            this._backend,
            this._nodeEngine,
        );
        this._tx.add(record);
        return true;
    }

    get(key: K): V[] {
        this._checkActive();
        const kd = this._toData(key);
        const ks = this._keyStr(kd);

        if (this._pendingRemoveAlls.has(ks)) {
            return [...(this._pendingPuts.get(ks)?.values ?? [])];
        }

        const committed: V[] = [];
        const committedCollection = this._backend.get(key);
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

        return [...filtered, ...(pendingEntry?.values ?? [])];
    }

    remove(key: K, value: V): boolean {
        this._checkActive();
        const kd = this._toData(key);
        const vd = this._toData(value);
        const ks = this._keyStr(kd);

        // Check if it's in pending puts first
        const pendingEntry = this._pendingPuts.get(ks);
        if (pendingEntry) {
            const idx = pendingEntry.values.findIndex((v) => {
                try { return JSON.stringify(v) === JSON.stringify(value); } catch { return false; }
            });
            if (idx !== -1) {
                pendingEntry.values.splice(idx, 1);
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

    removeAll(key: K): V[] {
        this._checkActive();
        const existing = this.get(key);
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

    valueCount(key: K): number {
        this._checkActive();
        return this.get(key).length;
    }

    size(): number {
        this._checkActive();
        let total = this._backend.size();
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
                    total -= this._backend.valueCount(key);
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
        const d = this._nodeEngine.toData(obj);
        if (d === null) throw new Error('Cannot serialize null');
        return d;
    }

    private _keyStr(data: Data): string {
        return data.toByteArray()?.join(',') ?? '';
    }
}
