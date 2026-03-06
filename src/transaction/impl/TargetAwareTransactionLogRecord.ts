/**
 * Port of {@code com.hazelcast.transaction.impl.TargetAwareTransactionLogRecord}.
 *
 * A TransactionLogRecord that targets a specific cluster member Address.
 */
import type { Address } from '@zenystx/helios-core/cluster/Address';
import type { TransactionLogRecord } from '@zenystx/helios-core/transaction/impl/TransactionLogRecord';

export interface TargetAwareTransactionLogRecord extends TransactionLogRecord {
    getTarget(): Address;
}
