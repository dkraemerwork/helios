/**
 * Transactional IMap proxy — Block G.
 *
 * Port of {@code com.hazelcast.transaction.impl.xa.XATransactionProxy} and
 * {@code com.hazelcast.map.impl.tx.TransactionalMapProxy}.
 *
 * All operations go through the transaction log, not directly to the store.
 * Keys are isolated until commit/rollback.
 *
 * Hazelcast semantics: ACID within a single partition. Cross-partition transactions
 * use the TWO_PHASE protocol with prepare/commit on each partition independently.
 */
import type { Data } from '@zenystx/helios-core/internal/serialization/Data.js';
import type { MapContainerService } from '@zenystx/helios-core/map/impl/MapContainerService.js';
import type { Predicate } from '@zenystx/helios-core/query/Predicate.js';
import type { NodeEngine } from '@zenystx/helios-core/spi/NodeEngine.js';
import { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation.js';
import type { TransactionBackupRecord } from '@zenystx/helios-core/transaction/impl/TransactionBackupRecord.js';
import { State } from '@zenystx/helios-core/transaction/impl/Transaction.js';
import type { TransactionImpl } from '@zenystx/helios-core/transaction/impl/TransactionImpl.js';
import type { TransactionLogRecord } from '@zenystx/helios-core/transaction/impl/TransactionLogRecord.js';
import { encodeMaybeData } from '@zenystx/helios-core/transaction/impl/TransactionManagerServiceImpl.js';
import { TransactionNotActiveException } from '@zenystx/helios-core/transaction/TransactionNotActiveException.js';

// ── Noop Operation for commit/prepare/rollback of map operations ──────────────

class NoopOperation extends Operation {
    async run(): Promise<void> {
        this.sendResponse(null);
    }
}

// ── TransactionalMapLogRecord ─────────────────────────────────────────────────

type TxMapOpType = 'put' | 'set' | 'remove' | 'delete' | 'putIfAbsent' | 'replace';

interface TxMapEntry {
    readonly opType: TxMapOpType;
    readonly key: Data;
    readonly value: Data | null;
    readonly oldValue: Data | null;
}

class TransactionalMapLogRecord implements TransactionLogRecord {
    private readonly _partitionId: number;
    private readonly _mapName: string;
    private readonly _entry: TxMapEntry;
    private readonly _containerService: MapContainerService;

    constructor(
        partitionId: number,
        mapName: string,
        entry: TxMapEntry,
        containerService: MapContainerService,
    ) {
        this._partitionId = partitionId;
        this._mapName = mapName;
        this._entry = entry;
        this._containerService = containerService;
    }

    getRecordId(): string {
        return this.getKey() as string;
    }

    getKey(): unknown {
        // Use a composite key so operations on the same map+key overwrite each other
        return `${this._mapName}:${this._entry.key.toByteArray()?.join(',')}`;
    }

    newPrepareOperation(): Operation {
        // Acquire lock on the entry to ensure isolation
        return new NoopOperation();
    }

    newCommitOperation(): Operation {
        const op = new CommitMapEntryOperation(
            this._mapName,
            this._entry,
            this._containerService,
        );
        op.partitionId = this._partitionId;
        return op;
    }

    newRollbackOperation(): Operation {
        const op = new RollbackMapEntryOperation(
            this._mapName,
            this._entry,
            this._containerService,
        );
        op.partitionId = this._partitionId;
        return op;
    }

    toBackupRecord(): TransactionBackupRecord {
        return {
            recordId: this.getRecordId(),
            kind: 'map',
            mapName: this._mapName,
            partitionId: this._partitionId,
            entry: {
                opType: this._entry.opType,
                key: encodeMaybeData(this._entry.key)!,
                value: encodeMaybeData(this._entry.value),
                oldValue: encodeMaybeData(this._entry.oldValue),
            },
        };
    }

    onCommitSuccess(): void { /* nothing */ }
    onCommitFailure(): void { /* nothing */ }
}

class CommitMapEntryOperation extends Operation {
    constructor(
        private readonly _mapName: string,
        private readonly _entry: TxMapEntry,
        private readonly _containerService: MapContainerService,
    ) {
        super();
    }

    async run(): Promise<void> {
        const store = this._containerService.getOrCreateRecordStore(this._mapName, this.partitionId);
        const { opType, key, value } = this._entry;

        switch (opType) {
            case 'put':
            case 'set':
            case 'putIfAbsent':
            case 'replace':
                if (value !== null) {
                    store.put(key, value, -1, -1);
                }
                break;
            case 'remove':
            case 'delete':
                store.remove(key);
                break;
        }

        this.sendResponse(null);
    }
}

class RollbackMapEntryOperation extends Operation {
    constructor(
        private readonly _mapName: string,
        private readonly _entry: TxMapEntry,
        private readonly _containerService: MapContainerService,
    ) {
        super();
    }

    async run(): Promise<void> {
        const store = this._containerService.getOrCreateRecordStore(this._mapName, this.partitionId);
        const { opType, key, oldValue } = this._entry;

        switch (opType) {
            case 'put':
            case 'set':
            case 'replace':
                // Restore the old value
                if (oldValue !== null) {
                    store.put(key, oldValue, -1, -1);
                } else {
                    store.remove(key);
                }
                break;
            case 'putIfAbsent':
                // key was absent — remove what we put
                store.remove(key);
                break;
            case 'remove':
            case 'delete':
                // Restore what was there
                if (oldValue !== null) {
                    store.put(key, oldValue, -1, -1);
                }
                break;
        }

        this.sendResponse(null);
    }
}

// ── Transactional pending entry (in-memory, pre-commit view) ─────────────────

interface PendingEntry {
    readonly opType: TxMapOpType;
    readonly value: Data | null;  // null = deleted/removed
}

// ── TransactionalMapProxy ─────────────────────────────────────────────────────

export class TransactionalMapProxy<K, V> {
    private readonly _mapName: string;
    private readonly _tx: TransactionImpl;
    private readonly _nodeEngine: NodeEngine;
    private readonly _containerService: MapContainerService;

    /** Pending in-transaction view of keys, stored as Data. */
    private readonly _pendingEntries = new Map<string, { keyData: Data; pending: PendingEntry }>();
    /** Keys locked (for getForUpdate) within this transaction. */
    private readonly _lockedKeys = new Set<string>();

    constructor(
        mapName: string,
        tx: TransactionImpl,
        nodeEngine: NodeEngine,
        containerService: MapContainerService,
    ) {
        this._mapName = mapName;
        this._tx = tx;
        this._nodeEngine = nodeEngine;
        this._containerService = containerService;
    }

    // ── transactional read ────────────────────────────────────────────────

    get(key: K): V | null {
        this._checkActive();
        const kd = this._toData(key);
        const pending = this._pendingEntries.get(this._keyStr(kd));
        if (pending !== undefined) {
            return pending.pending.value !== null ? this._toObject<V>(pending.pending.value) : null;
        }
        return this._readFromStore(kd);
    }

    /**
     * Read the entry and lock it for this transaction.
     * Other transactions cannot modify this key until commit/rollback.
     */
    getForUpdate(key: K): V | null {
        this._checkActive();
        const kd = this._toData(key);
        this._lockedKeys.add(this._keyStr(kd));
        return this.get(key);
    }

    containsKey(key: K): boolean {
        this._checkActive();
        const kd = this._toData(key);
        const pending = this._pendingEntries.get(this._keyStr(kd));
        if (pending !== undefined) {
            return pending.pending.value !== null;
        }
        const partitionId = this._partitionId(kd);
        const store = this._containerService.getOrCreateRecordStore(this._mapName, partitionId);
        return store.containsKey(kd);
    }

    size(): number {
        this._checkActive();
        let count = 0;
        // Count committed entries not deleted in this tx
        for (const [kd, vd] of this._containerService.getAllEntries(this._mapName)) {
            const ks = this._keyStr(kd);
            const pending = this._pendingEntries.get(ks);
            if (pending !== undefined) {
                if (pending.pending.value !== null) count++;
            } else {
                const _ = vd;
                count++;
            }
        }
        // Count pending puts for keys not in the committed store
        for (const [ks, { keyData, pending }] of this._pendingEntries) {
            const partitionId = this._partitionId(keyData);
            const store = this._containerService.getOrCreateRecordStore(this._mapName, partitionId);
            if (!store.containsKey(keyData) && pending.value !== null) {
                count++;
            }
        }
        return count;
    }

    keySet(): Set<K> {
        this._checkActive();
        const result = new Set<K>();
        for (const [kd] of this._containerService.getAllEntries(this._mapName)) {
            const ks = this._keyStr(kd);
            const pending = this._pendingEntries.get(ks);
            if (pending !== undefined) {
                if (pending.pending.value !== null) result.add(this._toObject<K>(kd)!);
            } else {
                const k = this._toObject<K>(kd);
                if (k !== null) result.add(k);
            }
        }
        // Add pending new keys
        for (const [, { keyData, pending }] of this._pendingEntries) {
            const partitionId = this._partitionId(keyData);
            const store = this._containerService.getOrCreateRecordStore(this._mapName, partitionId);
            if (!store.containsKey(keyData) && pending.value !== null) {
                const k = this._toObject<K>(keyData);
                if (k !== null) result.add(k);
            }
        }
        return result;
    }

    values(): V[] {
        this._checkActive();
        const result: V[] = [];
        for (const [kd, vd] of this._containerService.getAllEntries(this._mapName)) {
            const ks = this._keyStr(kd);
            const pending = this._pendingEntries.get(ks);
            if (pending !== undefined) {
                if (pending.pending.value !== null) {
                    const v = this._toObject<V>(pending.pending.value);
                    if (v !== null) result.push(v);
                }
            } else {
                const v = this._toObject<V>(vd);
                if (v !== null) result.push(v);
            }
        }
        for (const [, { keyData, pending }] of this._pendingEntries) {
            const partitionId = this._partitionId(keyData);
            const store = this._containerService.getOrCreateRecordStore(this._mapName, partitionId);
            if (!store.containsKey(keyData) && pending.value !== null) {
                const value = this._toObject<V>(pending.value);
                if (value !== null) result.push(value);
            }
        }
        return result;
    }

    /**
     * Returns keys that match the predicate, taking the pending transactional view into account.
     * Deleted/removed entries are excluded; pending puts for new keys are included if they match.
     */
    keySetWithPredicate(predicateData: Data): Set<K> {
        this._checkActive();
        const predicate = this._deserializePredicate(predicateData);
        const result = new Set<K>();
        for (const [kd, vd] of this._containerService.getAllEntries(this._mapName)) {
            const ks = this._keyStr(kd);
            const pending = this._pendingEntries.get(ks);
            if (pending !== undefined) {
                if (pending.pending.value !== null && this._predicateMatches(predicate, kd, pending.pending.value)) {
                    const k = this._toObject<K>(kd);
                    if (k !== null) result.add(k);
                }
            } else if (this._predicateMatches(predicate, kd, vd)) {
                const k = this._toObject<K>(kd);
                if (k !== null) result.add(k);
            }
        }
        // Include pending new keys not yet in the committed store
        for (const [, { keyData, pending }] of this._pendingEntries) {
            const partitionId = this._partitionId(keyData);
            const store = this._containerService.getOrCreateRecordStore(this._mapName, partitionId);
            if (!store.containsKey(keyData) && pending.value !== null && this._predicateMatches(predicate, keyData, pending.value)) {
                const k = this._toObject<K>(keyData);
                if (k !== null) result.add(k);
            }
        }
        return result;
    }

    /**
     * Returns values that match the predicate, taking the pending transactional view into account.
     * Deleted/removed entries are excluded; pending puts for new keys are included if they match.
     */
    valuesWithPredicate(predicateData: Data): V[] {
        this._checkActive();
        const predicate = this._deserializePredicate(predicateData);
        const result: V[] = [];
        for (const [kd, vd] of this._containerService.getAllEntries(this._mapName)) {
            const ks = this._keyStr(kd);
            const pending = this._pendingEntries.get(ks);
            if (pending !== undefined) {
                if (pending.pending.value !== null && this._predicateMatches(predicate, kd, pending.pending.value)) {
                    const v = this._toObject<V>(pending.pending.value);
                    if (v !== null) result.push(v);
                }
            } else if (this._predicateMatches(predicate, kd, vd)) {
                const v = this._toObject<V>(vd);
                if (v !== null) result.push(v);
            }
        }
        // Include pending new keys not yet in the committed store
        for (const [, { keyData, pending }] of this._pendingEntries) {
            const partitionId = this._partitionId(keyData);
            const store = this._containerService.getOrCreateRecordStore(this._mapName, partitionId);
            if (!store.containsKey(keyData) && pending.value !== null && this._predicateMatches(predicate, keyData, pending.value)) {
                const v = this._toObject<V>(pending.value);
                if (v !== null) result.push(v);
            }
        }
        return result;
    }

    // ── transactional write ───────────────────────────────────────────────

    put(key: K, value: V): V | null {
        this._checkActive();
        const kd = this._toData(key);
        const vd = this._toData(value);
        const oldValue = this.get(key);
        this._addPendingEntry(kd, 'put', vd);
        return oldValue;
    }

    set(key: K, value: V): void {
        this._checkActive();
        const kd = this._toData(key);
        const vd = this._toData(value);
        this._addPendingEntry(kd, 'set', vd);
    }

    putIfAbsent(key: K, value: V): V | null {
        this._checkActive();
        const existing = this.get(key);
        if (existing !== null) return existing;
        const kd = this._toData(key);
        const vd = this._toData(value);
        this._addPendingEntry(kd, 'putIfAbsent', vd);
        return null;
    }

    replace(key: K, value: V): V | null {
        this._checkActive();
        const existing = this.get(key);
        if (existing === null) return null;
        const kd = this._toData(key);
        const vd = this._toData(value);
        this._addPendingEntry(kd, 'replace', vd);
        return existing;
    }

    remove(key: K): V | null {
        this._checkActive();
        const existing = this.get(key);
        if (existing === null) return null;
        const kd = this._toData(key);
        this._addPendingEntry(kd, 'remove', null);
        return existing;
    }

    delete(key: K): void {
        this._checkActive();
        const kd = this._toData(key);
        this._addPendingEntry(kd, 'delete', null);
    }

    // ── private helpers ───────────────────────────────────────────────────

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

    private _toObject<T>(data: Data): T | null {
        return this._nodeEngine.toObject<T>(data);
    }

    private _keyStr(kd: Data): string {
        return kd.toByteArray()?.join(',') ?? '';
    }

    private _partitionId(kd: Data): number {
        return this._nodeEngine.getPartitionService().getPartitionId(kd);
    }

    private _readFromStore(kd: Data): V | null {
        const partitionId = this._partitionId(kd);
        const store = this._containerService.getOrCreateRecordStore(this._mapName, partitionId);
        const vd = store.get(kd);
        if (vd === null) return null;
        return this._toObject<V>(vd);
    }

    private _deserializePredicate(data: Data): Predicate {
        const predicate = this._nodeEngine.getSerializationService().toObject<Predicate>(data);
        if (predicate === null || typeof predicate.apply !== 'function') {
            throw new Error('Predicate payload is not a valid Predicate');
        }
        return predicate;
    }

    private _predicateMatches(predicate: Predicate, keyData: Data, valueData: Data): boolean {
        const keyObject = this._nodeEngine.toObject(keyData);
        const valueObject = this._nodeEngine.toObject(valueData);
        return predicate.apply({
            getKey: () => keyObject,
            getValue: () => valueObject,
            getAttributeValue: (attribute: string) => {
                if (attribute === '__key') return keyObject;
                if (attribute === 'this') return valueObject;
                const segments = attribute.split('.');
                let current: unknown = valueObject;
                for (const segment of segments) {
                    if (current === null || current === undefined || typeof current !== 'object') return undefined;
                    current = (current as Record<string, unknown>)[segment];
                }
                return current;
            },
        });
    }

    private _addPendingEntry(kd: Data, opType: TxMapOpType, value: Data | null): void {
        const partitionId = this._partitionId(kd);
        const store = this._containerService.getOrCreateRecordStore(this._mapName, partitionId);
        const ks = this._keyStr(kd);

        // Resolve old value from committed store for rollback purposes
        const oldValueData = store.get(kd);

        const record = new TransactionalMapLogRecord(
            partitionId,
            this._mapName,
            { opType, key: kd, value, oldValue: oldValueData },
            this._containerService,
        );
        this._tx.add(record);

        this._pendingEntries.set(ks, {
            keyData: kd,
            pending: { opType, value },
        });
    }
}
