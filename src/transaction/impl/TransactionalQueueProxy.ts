/**
 * Transactional IQueue proxy — Block G.
 *
 * Port of {@code com.hazelcast.collection.impl.queue.tx.TransactionalQueueProxy}.
 *
 * offer, poll, peek, size — all operations go through the transaction log.
 * The queue's committed state is not modified until commit.
 */
import type { Data } from '@zenystx/helios-core/internal/serialization/Data.js';
import type { NodeEngine } from '@zenystx/helios-core/spi/NodeEngine.js';
import { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation.js';
import type { TransactionBackupRecord } from '@zenystx/helios-core/transaction/impl/TransactionBackupRecord.js';
import { State } from '@zenystx/helios-core/transaction/impl/Transaction.js';
import type { TransactionImpl } from '@zenystx/helios-core/transaction/impl/TransactionImpl.js';
import type { TransactionLogRecord } from '@zenystx/helios-core/transaction/impl/TransactionLogRecord.js';
import { encodeMaybeData } from '@zenystx/helios-core/transaction/impl/TransactionManagerServiceImpl.js';
import { TransactionNotActiveException } from '@zenystx/helios-core/transaction/TransactionNotActiveException.js';

type QueueOpType = 'offer' | 'poll';

type MaybePromise<T> = T | Promise<T>;

/** Delegate queue operations the transaction log record commits/rolls back against. */
interface QueueBackend<E> {
    offer(element: E): MaybePromise<boolean>;
    poll(): MaybePromise<E | null>;
    peek(): MaybePromise<E | null>;
    size(): MaybePromise<number>;
    toArray(): MaybePromise<E[]>;
}

// ── Noop operation for prepare ────────────────────────────────────────────────

class NoopQueueOperation extends Operation {
    async run(): Promise<void> {
        this.sendResponse(null);
    }
}

// ── TransactionalQueueLogRecord ───────────────────────────────────────────────

class TransactionalQueueLogRecord<E> implements TransactionLogRecord {
    private readonly _recordId: string;
    private readonly _opType: QueueOpType;
    private readonly _valueData: Data | null;
    private readonly _backend: QueueBackend<E>;
    private readonly _nodeEngine: NodeEngine;

    constructor(
        recordId: string,
        opType: QueueOpType,
        valueData: Data | null,
        backend: QueueBackend<E>,
        nodeEngine: NodeEngine,
    ) {
        this._recordId = recordId;
        this._opType = opType;
        this._valueData = valueData;
        this._backend = backend;
        this._nodeEngine = nodeEngine;
    }

    getKey(): unknown {
        return this._recordId;
    }

    newPrepareOperation(): Operation {
        return new NoopQueueOperation();
    }

    newCommitOperation(): Operation {
        const op = new CommitQueueOperation<E>(
            this._opType,
            this._valueData,
            this._backend,
            this._nodeEngine,
        );
        return op;
    }

    newRollbackOperation(): Operation {
        return new NoopQueueOperation();
    }

    toBackupRecord(): TransactionBackupRecord {
        return {
            kind: 'queue',
            queueName: this._recordId.split(':', 2)[0],
            opType: this._opType,
            valueData: encodeMaybeData(this._valueData),
        };
    }

    onCommitSuccess(): void { /* nothing */ }
    onCommitFailure(): void { /* nothing */ }
}

class CommitQueueOperation<E> extends Operation {
    private readonly _qOpType: QueueOpType;
    private readonly _qValueData: Data | null;
    private readonly _qBackend: QueueBackend<E>;
    private readonly _qNodeEngine: NodeEngine;

    constructor(
        opType: QueueOpType,
        valueData: Data | null,
        backend: QueueBackend<E>,
        nodeEngine: NodeEngine,
    ) {
        super();
        this._qOpType = opType;
        this._qValueData = valueData;
        this._qBackend = backend;
        this._qNodeEngine = nodeEngine;
    }

    async run(): Promise<void> {
        switch (this._qOpType) {
            case 'offer':
                if (this._qValueData !== null) {
                    await this._qBackend.offer(this._qValueData as unknown as E);
                }
                break;
            case 'poll':
                await this._qBackend.poll();
                break;
        }
        this.sendResponse(null);
    }
}

// ── TransactionalQueueProxy ───────────────────────────────────────────────────

export class TransactionalQueueProxy<E> {
    private readonly _queueName: string;
    private readonly _tx: TransactionImpl;
    private readonly _nodeEngine: NodeEngine;
    private readonly _backend: QueueBackend<E>;

    /** Pending offers (not yet committed) ordered by insertion time. */
    private readonly _pendingOffers: Data[] = [];
    /** Count of pending polls (deferred from the committed queue head). */
    private _pendingPolls = 0;

    constructor(
        queueName: string,
        tx: TransactionImpl,
        nodeEngine: NodeEngine,
        backend: QueueBackend<E>,
    ) {
        this._queueName = queueName;
        this._tx = tx;
        this._nodeEngine = nodeEngine;
        this._backend = backend;
    }

    offer(element: E): boolean {
        this._checkActive();
        const vd = this._toData(element);
        this._pendingOffers.push(vd);
        const record = new TransactionalQueueLogRecord(
            `${this._queueName}:offer:${crypto.randomUUID()}`,
            'offer',
            vd,
            this._backend,
            this._nodeEngine,
        );
        this._tx.add(record);
        return true;
    }

    async poll(): Promise<E | null> {
        this._checkActive();
        // Take from pending offers first (LIFO in transaction scope = FIFO since offers prepend-to-tail)
        if (this._pendingOffers.length > 0) {
            const vd = this._pendingOffers.shift()!;
            return this._nodeEngine.toObject<E>(vd);
        }

        // Deferred poll from committed queue — mark it in the log
        const peeked = await this._peekCommitted();
        if (peeked === null) return null;

        this._pendingPolls++;
        const record = new TransactionalQueueLogRecord(
            `${this._queueName}:poll:${crypto.randomUUID()}`,
            'poll',
            null,
            this._backend,
            this._nodeEngine,
        );
        this._tx.add(record);
        return peeked;
    }

    async peek(): Promise<E | null> {
        this._checkActive();
        // Peek at pending offers first
        if (this._pendingOffers.length > 0) {
            return this._nodeEngine.toObject<E>(this._pendingOffers[0]);
        }

        return this._peekCommitted();
    }

    async size(): Promise<number> {
        this._checkActive();
        return await this._backend.size() - this._pendingPolls + this._pendingOffers.length;
    }

    private _checkActive(): void {
        if (this._tx.getState() !== State.ACTIVE) {
            throw new TransactionNotActiveException('Transaction is not active');
        }
    }

    private async _peekCommitted(): Promise<E | null> {
        const committedItems = await this._backend.toArray();
        return committedItems[this._pendingPolls] ?? null;
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
