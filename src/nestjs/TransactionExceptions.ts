/**
 * Transaction-related NestJS/Spring-analogous exceptions for Helios.
 *
 * Ports of:
 *   org.springframework.transaction.NoTransactionException
 *   org.springframework.transaction.TransactionSystemException
 *   org.springframework.transaction.TransactionSuspensionNotSupportedException
 *   org.springframework.transaction.CannotCreateTransactionException
 */

/**
 * Thrown when a transaction context is required but none is active.
 * Port of {@code org.springframework.transaction.NoTransactionException}.
 */
export class NoTransactionException extends Error {
    constructor(message = 'No TransactionContext with actual transaction available for current thread') {
        super(message);
        this.name = 'NoTransactionException';
    }
}

/**
 * Wraps an error thrown during transaction commit or rollback.
 * Port of {@code org.springframework.transaction.TransactionSystemException}.
 */
export class TransactionSystemException extends Error {
    readonly cause: Error | undefined;

    constructor(message: string, cause?: Error) {
        super(message);
        this.name = 'TransactionSystemException';
        this.cause = cause;
    }
}

/**
 * Thrown when REQUIRES_NEW propagation is used but Helios does not support
 * transaction suspension (nested transactions are not supported).
 * Port of {@code org.springframework.transaction.TransactionSuspensionNotSupportedException}.
 */
export class TransactionSuspensionNotSupportedException extends Error {
    constructor(message = 'Transaction suspension not supported — Helios does not support nested transactions') {
        super(message);
        this.name = 'TransactionSuspensionNotSupportedException';
    }
}

/**
 * Thrown when a new transaction cannot be created (e.g., context factory throws).
 * Port of {@code org.springframework.transaction.CannotCreateTransactionException}.
 */
export class CannotCreateTransactionException extends Error {
    readonly cause: Error | undefined;

    constructor(message: string, cause?: unknown) {
        super(message);
        this.name = 'CannotCreateTransactionException';
        this.cause = cause instanceof Error ? cause : undefined;
    }
}
