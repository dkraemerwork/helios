/**
 * Port of {@code com.hazelcast.transaction.impl.TransactionLog}.
 *
 * Holds all TransactionLogRecords for a given transaction.
 * Key-aware records are stored in a map (later writes overwrite earlier ones for the same key).
 * Records without a key are stored under unique object keys.
 */
import type { InvocationFuture } from '@zenystx/helios-core/spi/impl/operationservice/InvocationFuture';
import type { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';
import type { NodeEngine } from '@zenystx/helios-core/spi/NodeEngine';
import type { TransactionBackupRecord } from '@zenystx/helios-core/transaction/impl/TransactionBackupRecord';
import type { TargetAwareTransactionLogRecord } from '@zenystx/helios-core/transaction/impl/TargetAwareTransactionLogRecord';
import type { TransactionLogRecord } from '@zenystx/helios-core/transaction/impl/TransactionLogRecord';

export class TransactionLog {
    private readonly _recordMap = new Map<unknown, TransactionLogRecord>();

    constructor(records?: Iterable<TransactionLogRecord>) {
        if (records !== undefined) {
            for (const record of records) {
                this.add(record);
            }
        }
    }

    add(record: TransactionLogRecord): void {
        const key = record.getKey() ?? {};
        this._recordMap.set(key, record);
    }

    get(key: unknown): TransactionLogRecord | null {
        return this._recordMap.get(key) ?? null;
    }

    getRecords(): IterableIterator<TransactionLogRecord> {
        return this._recordMap.values();
    }

    remove(key: unknown): void {
        this._recordMap.delete(key);
    }

    size(): number {
        return this._recordMap.size;
    }

    toBackupRecords(): TransactionBackupRecord[] {
        return Array.from(this._recordMap.values(), (record) => record.toBackupRecord());
    }

    commit(nodeEngine: NodeEngine): InvocationFuture<unknown>[] {
        const futures: InvocationFuture<unknown>[] = [];
        for (const record of this._recordMap.values()) {
            futures.push(this._invoke(nodeEngine, record, record.newCommitOperation()));
        }
        return futures;
    }

    prepare(nodeEngine: NodeEngine): InvocationFuture<unknown>[] {
        const futures: InvocationFuture<unknown>[] = [];
        for (const record of this._recordMap.values()) {
            futures.push(this._invoke(nodeEngine, record, record.newPrepareOperation()));
        }
        return futures;
    }

    rollback(nodeEngine: NodeEngine): InvocationFuture<unknown>[] {
        const futures: InvocationFuture<unknown>[] = [];
        for (const record of this._recordMap.values()) {
            futures.push(this._invoke(nodeEngine, record, record.newRollbackOperation()));
        }
        return futures;
    }

    onCommitSuccess(): void {
        for (const record of this._recordMap.values()) {
            record.onCommitSuccess();
        }
    }

    onCommitFailure(): void {
        for (const record of this._recordMap.values()) {
            record.onCommitFailure();
        }
    }

    private _invoke(nodeEngine: NodeEngine, record: TransactionLogRecord, op: Operation): InvocationFuture<unknown> {
        const operationService = nodeEngine.getOperationService();
        // Check if record is TargetAware (has getTarget method)
        if (this._isTargetAware(record)) {
            const target = record.getTarget();
            return operationService.invokeOnTarget(op.serviceName, op, target);
        }
        return operationService.invokeOnPartition(op.serviceName, op, op.partitionId);
    }

    private _isTargetAware(record: TransactionLogRecord): record is TargetAwareTransactionLogRecord {
        return typeof (record as TargetAwareTransactionLogRecord).getTarget === 'function';
    }
}
