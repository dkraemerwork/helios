/**
 * Port of {@code com.hazelcast.transaction.TransactionTimedOutException}.
 *
 * Thrown when a transaction exceeds its configured timeout.
 */
import { TransactionException } from '@zenystx/helios-core/transaction/TransactionException';

export class TransactionTimedOutException extends TransactionException {
    constructor(causeOrMessage: Error | string = '') {
        const message = causeOrMessage instanceof Error ? causeOrMessage.message : causeOrMessage;
        super(message);
        this.name = 'TransactionTimedOutException';
    }
}
