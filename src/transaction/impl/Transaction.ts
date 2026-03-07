/**
 * Port of {@code com.hazelcast.transaction.impl.Transaction}.
 *
 * Internal transaction interface representing the lifecycle of a distributed transaction.
 */
import type { TransactionType } from '@zenystx/helios-core/transaction/TransactionOptions';
import type { TransactionLogRecord } from '@zenystx/helios-core/transaction/impl/TransactionLogRecord';

export const enum State {
    NO_TXN      = 'NO_TXN',
    ACTIVE      = 'ACTIVE',
    PREPARING   = 'PREPARING',
    PREPARED    = 'PREPARED',
    COMMITTING  = 'COMMITTING',
    COMMITTED   = 'COMMITTED',
    COMMIT_FAILED = 'COMMIT_FAILED',
    ROLLING_BACK  = 'ROLLING_BACK',
    ROLLED_BACK   = 'ROLLED_BACK',
}

export interface Transaction {
    begin(): Promise<void>;
    prepare(): Promise<void>;
    commit(): Promise<void>;
    rollback(): Promise<void>;

    getTxnId(): string;
    getState(): State;
    getTimeoutMillis(): number;

    add(record: TransactionLogRecord): void;
    remove(key: unknown): void;
    get(key: unknown): TransactionLogRecord | null;

    getOwnerUuid(): string;
    isOriginatedFromClient(): boolean;
    getTransactionType(): TransactionType;
}

// Re-export State as a value too (for use in tests without const enum restriction)
export const TransactionState = {
    NO_TXN:       'NO_TXN'       as State,
    ACTIVE:       'ACTIVE'       as State,
    PREPARING:    'PREPARING'    as State,
    PREPARED:     'PREPARED'     as State,
    COMMITTING:   'COMMITTING'   as State,
    COMMITTED:    'COMMITTED'    as State,
    COMMIT_FAILED:'COMMIT_FAILED'as State,
    ROLLING_BACK: 'ROLLING_BACK' as State,
    ROLLED_BACK:  'ROLLED_BACK'  as State,
};
