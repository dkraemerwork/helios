/**
 * NestJS transaction manager for Helios.
 *
 * Port of {@code com.hazelcast.spring.transaction.HazelcastTransactionManager}
 * and {@code com.hazelcast.spring.transaction.TransactionContextHolder}.
 *
 * Replaces Spring's thread-local TransactionSynchronizationManager with
 * Node.js AsyncLocalStorage for async-safe context binding.
 */

import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { TransactionContext } from '@helios/core/transaction/TransactionContext';
import {
    NoTransactionException,
    TransactionSystemException,
    TransactionSuspensionNotSupportedException,
    CannotCreateTransactionException,
} from './TransactionExceptions';

// ---------------------------------------------------------------------------
// TransactionContextHolder
// ---------------------------------------------------------------------------

/** Wraps a TransactionContext and tracks whether the transaction is active. */
class TransactionContextHolder {
    private _active = false;

    constructor(readonly context: TransactionContext) {}

    isTransactionActive(): boolean {
        return this._active;
    }

    beginTransaction(): void {
        this.context.beginTransaction();
        this._active = true;
    }

    clear(): void {
        this._active = false;
    }
}

// ---------------------------------------------------------------------------
// TransactionContextFactory
// ---------------------------------------------------------------------------

export interface TransactionCreateOptions {
    /** Timeout in seconds. Undefined = use manager default. -1 = no timeout. */
    timeoutSecs?: number;
}

/**
 * Factory that creates a {@link TransactionContext} given optional options.
 * Inject a custom factory to bind Helios transactions to the NestJS DI container.
 */
export interface TransactionContextFactory {
    create(options?: TransactionCreateOptions): TransactionContext;
}

// ---------------------------------------------------------------------------
// Propagation options
// ---------------------------------------------------------------------------

export interface TransactionalRunOptions {
    /** Timeout in seconds. Takes precedence over manager defaultTimeoutSecs. */
    timeout?: number;
    /** Transaction propagation behaviour. Defaults to REQUIRED. */
    propagation?: 'REQUIRED' | 'REQUIRES_NEW';
}

// ---------------------------------------------------------------------------
// Module-level AsyncLocalStorage (shared across all manager instances)
// ---------------------------------------------------------------------------

const _txStorage = new AsyncLocalStorage<TransactionContextHolder>();

// ---------------------------------------------------------------------------
// HeliosTransactionManager
// ---------------------------------------------------------------------------

/**
 * Manages Helios transaction lifecycle within NestJS.
 *
 * Usage (programmatic):
 *   await transactionManager.run(async () => {
 *     const ctx = transactionManager.getTransactionContext();
 *     const map = ctx.getMap('myMap');
 *     map.put('k', 'v');
 *   });
 *
 * Usage (declarative — via \@Transactional() decorator):
 *   \@Transactional()
 *   async myMethod(): Promise<void> { ... }
 */
@Injectable()
export class HeliosTransactionManager {
    /** Default timeout in seconds. -1 means no timeout (use context default). */
    private _defaultTimeoutSecs = -1;

    /** Global singleton — used by the \@Transactional() decorator. */
    private static _current: HeliosTransactionManager | null = null;

    constructor(private readonly _factory: TransactionContextFactory) {}

    // ------------------------------------------------------------------
    // Static API (used by @Transactional decorator)
    // ------------------------------------------------------------------

    /** Register this manager as the globally active one (used by @Transactional). */
    static setCurrent(mgr: HeliosTransactionManager | null): void {
        HeliosTransactionManager._current = mgr;
    }

    /** Retrieve the globally registered manager (used by @Transactional). */
    static getCurrent(): HeliosTransactionManager | null {
        return HeliosTransactionManager._current;
    }

    // ------------------------------------------------------------------
    // Timeout configuration
    // ------------------------------------------------------------------

    /** Set the manager-level default transaction timeout in seconds (-1 = none). */
    setDefaultTimeout(seconds: number): void {
        this._defaultTimeoutSecs = seconds;
    }

    getDefaultTimeout(): number {
        return this._defaultTimeoutSecs;
    }

    // ------------------------------------------------------------------
    // Context access
    // ------------------------------------------------------------------

    /**
     * Returns the TransactionContext bound to the current async execution.
     * @throws NoTransactionException if called outside an active transaction.
     */
    getTransactionContext(): TransactionContext {
        const holder = _txStorage.getStore();
        if (!holder?.isTransactionActive()) {
            throw new NoTransactionException();
        }
        return holder.context;
    }

    /** Returns true if currently inside an active transaction. */
    isInTransaction(): boolean {
        return (_txStorage.getStore()?.isTransactionActive()) ?? false;
    }

    // ------------------------------------------------------------------
    // Programmatic transaction execution
    // ------------------------------------------------------------------

    /**
     * Execute {@code fn} within a transaction.
     *
     * Propagation:
     *   REQUIRED (default) — reuse existing transaction if present, else create new.
     *   REQUIRES_NEW       — throw if already in a transaction (Helios limitation).
     *
     * @param fn      The work to execute transactionally.
     * @param options Optional timeout / propagation overrides.
     */
    async run<T>(
        fn: () => T | Promise<T>,
        options?: TransactionalRunOptions,
    ): Promise<T> {
        const propagation = options?.propagation ?? 'REQUIRED';
        const existingHolder = _txStorage.getStore();
        const inTransaction = existingHolder?.isTransactionActive() ?? false;

        if (propagation === 'REQUIRES_NEW' && inTransaction) {
            throw new TransactionSuspensionNotSupportedException();
        }

        if (propagation === 'REQUIRED' && inTransaction) {
            // Reuse existing transaction — just execute fn without wrapping
            return fn() as Promise<T>;
        }

        // Create a new transaction
        const timeoutSecs = options?.timeout ?? (this._defaultTimeoutSecs !== -1 ? this._defaultTimeoutSecs : undefined);
        let ctx: TransactionContext;
        try {
            ctx = this._factory.create(timeoutSecs !== undefined ? { timeoutSecs } : undefined);
        } catch (err) {
            throw new CannotCreateTransactionException('Could not begin Helios transaction', err);
        }

        const holder = new TransactionContextHolder(ctx);
        holder.beginTransaction();

        return _txStorage.run(holder, async () => {
            try {
                const result = await fn();
                // Commit
                try {
                    ctx.commitTransaction();
                    holder.clear();
                } catch (commitErr) {
                    holder.clear();
                    const cause = commitErr instanceof Error ? commitErr : new Error(String(commitErr));
                    throw new TransactionSystemException(
                        'Could not commit Helios transaction',
                        cause,
                    );
                }
                return result;
            } catch (err) {
                if (!(err instanceof TransactionSystemException)) {
                    // Application or nested exception — rollback
                    try {
                        ctx.rollbackTransaction();
                    } catch {
                        // Suppress rollback errors
                    }
                    holder.clear();
                }
                throw err;
            }
        });
    }
}
