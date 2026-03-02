/**
 * Port of {@code com.hazelcast.transaction.TransactionException}.
 *
 * Thrown when a transaction-level error occurs (conflict, timeout, etc.).
 */
export class TransactionException extends Error {
    constructor(message = '') {
        super(message);
        this.name = 'TransactionException';
    }
}
