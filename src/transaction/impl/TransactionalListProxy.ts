/**
 * Transactional IList proxy — Block G.
 *
 * Port of {@code com.hazelcast.collection.impl.list.tx.TransactionalListProxy}.
 *
 * add, remove, size — all operations go through the transaction log.
 */
import type { Data } from '@zenystx/helios-core/internal/serialization/Data.js';
import { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation.js';
import type { NodeEngine } from '@zenystx/helios-core/spi/NodeEngine.js';
import { State } from '@zenystx/helios-core/transaction/impl/Transaction.js';
import type { TransactionBackupRecord } from '@zenystx/helios-core/transaction/impl/TransactionBackupRecord.js';
import type { TransactionImpl } from '@zenystx/helios-core/transaction/impl/TransactionImpl.js';
import type { TransactionLogRecord } from '@zenystx/helios-core/transaction/impl/TransactionLogRecord.js';
import { encodeMaybeData } from '@zenystx/helios-core/transaction/impl/TransactionManagerServiceImpl.js';
import { TransactionNotActiveException } from '@zenystx/helios-core/transaction/TransactionNotActiveException.js';

type ListOpType = 'add' | 'remove';

type MaybePromise<T> = T | Promise<T>;

interface ListBackend<E> {
    add(element: E, dedupeId?: string): MaybePromise<boolean>;
    remove(element: E, dedupeId?: string): MaybePromise<boolean>;
    size(): MaybePromise<number>;
    toArray(): MaybePromise<E[]>;
}

class NoopListOperation extends Operation {
    async run(): Promise<void> { this.sendResponse(null); }
}

class CommitListOperation<E> extends Operation {
    private readonly _recordId: string;
    private readonly _lOpType: ListOpType;
    private readonly _lValueData: Data;
    private readonly _lBackend: ListBackend<E>;
    private readonly _lNodeEngine: NodeEngine;

    constructor(recordId: string, opType: ListOpType, valueData: Data, backend: ListBackend<E>, nodeEngine: NodeEngine) {
        super();
        this._recordId = recordId;
        this._lOpType = opType;
        this._lValueData = valueData;
        this._lBackend = backend;
        this._lNodeEngine = nodeEngine;
    }

    async run(): Promise<void> {
        const value = this._lValueData as unknown as E;
        switch (this._lOpType) {
            case 'add': await this._lBackend.add(value, this._recordId); break;
            case 'remove': await this._lBackend.remove(value, this._recordId); break;
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
    getRecordId(): string { return this._recordId; }
    newPrepareOperation(): Operation { return new NoopListOperation(); }
    newCommitOperation(): Operation {
        return new CommitListOperation(this._recordId, this._opType, this._valueData, this._backend, this._nodeEngine);
    }
    newRollbackOperation(): Operation { return new NoopListOperation(); }
    toBackupRecord(): TransactionBackupRecord {
        return {
            recordId: this._recordId,
            kind: 'list',
            listName: this._recordId.split(':', 2)[0],
            opType: this._opType,
            valueData: encodeMaybeData(this._valueData)!,
        };
    }
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

    async size(): Promise<number> {
        this._checkActive();
        return await this._backend.size() + this._pendingAdds.length - this._pendingRemoves.length;
    }

    async get(index: number): Promise<E | null> {
        this._checkActive();
        const snapshot = await this._snapshot();
        return snapshot[index] ?? null;
    }

    async set(index: number, element: E): Promise<E | null> {
        this._checkActive();
        const previous = await this.get(index);
        if (previous === null) {
            return null;
        }
        this.remove(previous);
        this.add(element);
        return previous;
    }

    private async _snapshot(): Promise<E[]> {
        const committed = [...await this._backend.toArray()];

        for (const value of this._pendingRemoves) {
            const index = committed.findIndex((entry) => this._equals(entry, value));
            if (index !== -1) {
                committed.splice(index, 1);
            }
        }

        committed.push(...this._pendingAdds);
        return committed;
    }

    private _equals(left: E, right: E): boolean {
        const leftData = this._toData(left);
        const rightData = this._toData(right);
        return leftData.equals(rightData);
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
}
