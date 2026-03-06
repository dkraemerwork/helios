/**
 * Port of {@code com.hazelcast.transaction.TransactionNotActiveException}.
 *
 * Thrown when an operation is attempted on a transaction that is not in ACTIVE state.
 */
import { TransactionException } from '@zenystx/core/transaction/TransactionException';

export class TransactionNotActiveException extends TransactionException {
    constructor(message = '') {
        super(message);
        this.name = 'TransactionNotActiveException';
    }
}
