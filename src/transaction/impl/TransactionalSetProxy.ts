/**
 * Transactional ISet proxy — Block G.
 *
 * Port of {@code com.hazelcast.collection.impl.set.tx.TransactionalSetProxy}.
 *
 * add, remove, size — all operations go through the transaction log.
 */
import type { Data } from '@zenystx/helios-core/internal/serialization/Data.js';
import type { NodeEngine } from '@zenystx/helios-core/spi/NodeEngine.js';
import { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation.js';
import { State } from '@zenystx/helios-core/transaction/impl/Transaction.js';
import type { TransactionImpl } from '@zenystx/helios-core/transaction/impl/TransactionImpl.js';
import type { TransactionLogRecord } from '@zenystx/helios-core/transaction/impl/TransactionLogRecord.js';
import { TransactionNotActiveException } from '@zenystx/helios-core/transaction/TransactionNotActiveException.js';

type SetOpType = 'add' | 'remove';

interface SetBackend<E> {
    add(element: E): boolean;
    remove(element: E): boolean;
    size(): number;
    contains(element: E): boolean;
}

class NoopSetOperation extends Operation {
    async run(): Promise<void> { this.sendResponse(null); }
}

class CommitSetOperation<E> extends Operation {
    private readonly _sOpType: SetOpType;
    private readonly _sValueData: Data;
    private readonly _sBackend: SetBackend<E>;
    private readonly _sNodeEngine: NodeEngine;

    constructor(opType: SetOpType, valueData: Data, backend: SetBackend<E>, nodeEngine: NodeEngine) {
        super();
        this._sOpType = opType;
        this._sValueData = valueData;
        this._sBackend = backend;
        this._sNodeEngine = nodeEngine;
    }

    async run(): Promise<void> {
        const value = this._sNodeEngine.toObject<E>(this._sValueData);
        if (value !== null) {
            switch (this._sOpType) {
                case 'add': this._sBackend.add(value); break;
                case 'remove': this._sBackend.remove(value); break;
            }
        }
        this.sendResponse(null);
    }
}

class TransactionalSetLogRecord<E> implements TransactionLogRecord {
    private readonly _recordId: string;
    private readonly _opType: SetOpType;
    private readonly _valueData: Data;
    private readonly _backend: SetBackend<E>;
    private readonly _nodeEngine: NodeEngine;

    constructor(recordId: string, opType: SetOpType, valueData: Data, backend: SetBackend<E>, nodeEngine: NodeEngine) {
        this._recordId = recordId;
        this._opType = opType;
        this._valueData = valueData;
        this._backend = backend;
        this._nodeEngine = nodeEngine;
    }

    getKey(): unknown { return this._recordId; }
    newPrepareOperation(): Operation { return new NoopSetOperation(); }
    newCommitOperation(): Operation {
        return new CommitSetOperation(this._opType, this._valueData, this._backend, this._nodeEngine);
    }
    newRollbackOperation(): Operation { return new NoopSetOperation(); }
    onCommitSuccess(): void { /* nothing */ }
    onCommitFailure(): void { /* nothing */ }
}

export class TransactionalSetProxy<E> {
    private readonly _setName: string;
    private readonly _tx: TransactionImpl;
    private readonly _nodeEngine: NodeEngine;
    private readonly _backend: SetBackend<E>;

    /** Pending adds not yet committed. */
    private readonly _pendingAdds = new Set<string>();  // serialized keys
    private readonly _pendingAddValues = new Map<string, E>();
    /** Pending removes not yet committed. */
    private readonly _pendingRemoves = new Set<string>();

    constructor(setName: string, tx: TransactionImpl, nodeEngine: NodeEngine, backend: SetBackend<E>) {
        this._setName = setName;
        this._tx = tx;
        this._nodeEngine = nodeEngine;
        this._backend = backend;
    }

    add(element: E): boolean {
        this._checkActive();
        const vd = this._toData(element);
        const ks = this._keyStr(vd);

        // Already pending as add — no-op (set semantics)
        if (this._pendingAdds.has(ks)) return false;
        // Was pending remove — re-add it
        this._pendingRemoves.delete(ks);

        this._pendingAdds.add(ks);
        this._pendingAddValues.set(ks, element);

        const record = new TransactionalSetLogRecord(
            `${this._setName}:add:${ks}`,
            'add',
            vd,
            this._backend,
            this._nodeEngine,
        );
        this._tx.add(record);
        return true;
    }

    remove(element: E): boolean {
        this._checkActive();
        const vd = this._toData(element);
        const ks = this._keyStr(vd);

        if (this._pendingAdds.has(ks)) {
            this._pendingAdds.delete(ks);
            this._pendingAddValues.delete(ks);
            return true;
        }

        this._pendingRemoves.add(ks);
        const record = new TransactionalSetLogRecord(
            `${this._setName}:remove:${ks}`,
            'remove',
            vd,
            this._backend,
            this._nodeEngine,
        );
        this._tx.add(record);
        return true;
    }

    size(): number {
        this._checkActive();
        return this._backend.size() + this._pendingAdds.size - this._pendingRemoves.size;
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
