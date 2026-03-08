/**
 * Transactional IList proxy — Block G.
 *
 * Port of {@code com.hazelcast.collection.impl.list.tx.TransactionalListProxy}.
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

type ListOpType = 'add' | 'remove';

interface ListBackend<E> {
    add(element: E): boolean;
    remove(element: E): boolean;
    size(): number;
    toArray(): E[];
}

class NoopListOperation extends Operation {
    async run(): Promise<void> { this.sendResponse(null); }
}

class CommitListOperation<E> extends Operation {
    private readonly _lOpType: ListOpType;
    private readonly _lValueData: Data;
    private readonly _lBackend: ListBackend<E>;
    private readonly _lNodeEngine: NodeEngine;

    constructor(opType: ListOpType, valueData: Data, backend: ListBackend<E>, nodeEngine: NodeEngine) {
        super();
        this._lOpType = opType;
        this._lValueData = valueData;
        this._lBackend = backend;
        this._lNodeEngine = nodeEngine;
    }

    async run(): Promise<void> {
        const value = this._lNodeEngine.toObject<E>(this._lValueData);
        if (value !== null) {
            switch (this._lOpType) {
                case 'add': this._lBackend.add(value); break;
                case 'remove': this._lBackend.remove(value); break;
            }
        }
        this.sendResponse(null);
    }
}

class TransactionalListLogRecord<E> implements TransactionLogRecord {
    private readonly _recordId: string;
    private readonly _opType: ListOpType;
    private readonly _valueData: Data;
    private readonly _backend: ListBackend<E>;
    private readonly _nodeEngine: NodeEngine;

    constructor(recordId: string, opType: ListOpType, valueData: Data, backend: ListBackend<E>, nodeEngine: NodeEngine) {
        this._recordId = recordId;
        this._opType = opType;
        this._valueData = valueData;
        this._backend = backend;
        this._nodeEngine = nodeEngine;
    }

    getKey(): unknown { return this._recordId; }
    newPrepareOperation(): Operation { return new NoopListOperation(); }
    newCommitOperation(): Operation {
        return new CommitListOperation(this._opType, this._valueData, this._backend, this._nodeEngine);
    }
    newRollbackOperation(): Operation { return new NoopListOperation(); }
    onCommitSuccess(): void { /* nothing */ }
    onCommitFailure(): void { /* nothing */ }
}

export class TransactionalListProxy<E> {
    private readonly _listName: string;
    private readonly _tx: TransactionImpl;
    private readonly _nodeEngine: NodeEngine;
    private readonly _backend: ListBackend<E>;

    /** Pending adds not yet committed. */
    private readonly _pendingAdds: E[] = [];
    /** Pending removes (values to be removed at commit). */
    private readonly _pendingRemoves: E[] = [];

    constructor(listName: string, tx: TransactionImpl, nodeEngine: NodeEngine, backend: ListBackend<E>) {
        this._listName = listName;
        this._tx = tx;
        this._nodeEngine = nodeEngine;
        this._backend = backend;
    }

    add(element: E): boolean {
        this._checkActive();
        const vd = this._toData(element);
        this._pendingAdds.push(element);
        const record = new TransactionalListLogRecord(
            `${this._listName}:add:${crypto.randomUUID()}`,
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
        this._pendingRemoves.push(element);
        const record = new TransactionalListLogRecord(
            `${this._listName}:remove:${crypto.randomUUID()}`,
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
        return this._backend.size() + this._pendingAdds.length - this._pendingRemoves.length;
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
}
