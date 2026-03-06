/**
 * Port of {@code com.hazelcast.transaction.impl.TransactionLogRecord}.
 *
 * Represents a single change made within a transaction (e.g. a map.put).
 * Key-aware records can be overwritten by later records with the same key.
 */
import type { Operation } from '@zenystx/core/spi/impl/operationservice/Operation';

export interface TransactionLogRecord {
    /**
     * The key that uniquely identifies this record within the TransactionLog.
     * Return null if this record cannot be overwritten.
     */
    getKey(): unknown | null;

    newPrepareOperation(): Operation;
    newCommitOperation(): Operation;
    newRollbackOperation(): Operation;

    onCommitSuccess(): void;
    onCommitFailure(): void;
}
