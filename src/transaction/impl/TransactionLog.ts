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
    private readonly _recordOrder: string[] = [];

    constructor(records?: Iterable<TransactionLogRecord>) {
        if (records !== undefined) {
            for (const record of records) {
                this.add(record);
            }
        }
    }

    add(record: TransactionLogRecord): void {
        const key = record.getKey() ?? {};
        const existing = this._recordMap.get(key);
        if (existing !== undefined) {
            this._removeRecordId(existing.getRecordId());
        }
        this._recordMap.set(key, record);
        this._recordOrder.push(record.getRecordId());
    }

    get(key: unknown): TransactionLogRecord | null {
        return this._recordMap.get(key) ?? null;
    }

    getRecords(): IterableIterator<TransactionLogRecord> {
        return this._recordMap.values();
    }

    remove(key: unknown): void {
        const existing = this._recordMap.get(key);
        if (existing !== undefined) {
            this._removeRecordId(existing.getRecordId());
        }
        this._recordMap.delete(key);
    }

    size(): number {
        return this._recordMap.size;
    }

    toBackupRecords(): TransactionBackupRecord[] {
        const recordsById = new Map<string, TransactionLogRecord>();
        for (const record of this._recordMap.values()) {
            recordsById.set(record.getRecordId(), record);
        }

        const records: TransactionBackupRecord[] = [];
        for (const recordId of this._recordOrder) {
            const record = recordsById.get(recordId);
            if (record !== undefined) {
                records.push(record.toBackupRecord());
            }
        }
        return records;
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

    private _removeRecordId(recordId: string): void {
        const index = this._recordOrder.indexOf(recordId);
        if (index !== -1) {
            this._recordOrder.splice(index, 1);
        }
    }
}
