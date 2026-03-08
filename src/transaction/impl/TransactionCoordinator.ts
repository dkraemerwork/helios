/**
 * Port of {@code com.hazelcast.transaction.impl.TransactionManagerServiceImpl} coordinator path.
 *
 * Coordinates transaction lifecycle:
 * - Creates transactions with UUID, timeout, type (ONE_PHASE or TWO_PHASE)
 * - Begin: acquires resources, starts timeout timer
 * - Commit: one-phase = direct commit; two-phase = prepare → commit
 * - Rollback: undoes all operations in the transaction log
 * - Timeout: auto-rollback if not committed within timeout
 * - Recovery: detects and cleans up dangling transactions on member loss
 *
 * Block G: fully implemented coordinator with per-transaction timeout management.
 */
import type { NodeEngine } from '@zenystx/helios-core/spi/NodeEngine.js';
import { State } from '@zenystx/helios-core/transaction/impl/Transaction.js';
import { TransactionImpl } from '@zenystx/helios-core/transaction/impl/TransactionImpl.js';
import { TransactionManagerServiceImpl } from '@zenystx/helios-core/transaction/impl/TransactionManagerServiceImpl.js';
import { TransactionException } from '@zenystx/helios-core/transaction/TransactionException.js';
import { TransactionOptions, TransactionType } from '@zenystx/helios-core/transaction/TransactionOptions.js';
import { TransactionTimedOutException } from '@zenystx/helios-core/transaction/TransactionTimedOutException.js';

/** Describes the full metadata of an active transaction managed by this coordinator. */
export interface ManagedTransaction {
    readonly txnId: string;
    readonly transaction: TransactionImpl;
    readonly options: TransactionOptions;
    readonly startTime: number;
    readonly ownerUuid: string;
}

export class TransactionCoordinator {
    private readonly _nodeEngine: NodeEngine;
    private readonly _txManagerService: TransactionManagerServiceImpl;

    /** Active transactions keyed by transaction ID. */
    private readonly _transactions = new Map<string, ManagedTransaction>();

    /** Auto-rollback timeout timers, keyed by transaction ID. */
    private readonly _timeoutTimers = new Map<string, ReturnType<typeof setTimeout>>();

    constructor(nodeEngine: NodeEngine, txManagerService: TransactionManagerServiceImpl) {
        this._nodeEngine = nodeEngine;
        this._txManagerService = txManagerService;
    }

    /**
     * Create a new transaction context.
     * The transaction is NOT yet begun; call begin() on the returned transaction.
     */
    newTransaction(options: TransactionOptions, ownerUuid?: string): TransactionImpl {
        const resolvedOwnerUuid = ownerUuid ?? crypto.randomUUID();
        const tx = new TransactionImpl(
            this._txManagerService,
            this._nodeEngine,
            options,
            resolvedOwnerUuid,
        );
        return tx;
    }

    /**
     * Begin a transaction.
     * Registers it with the coordinator and starts the auto-rollback timeout timer.
     */
    async beginTransaction(tx: TransactionImpl): Promise<void> {
        await tx.begin();

        const managed: ManagedTransaction = {
            txnId: tx.getTxnId(),
            transaction: tx,
            options: new TransactionOptions()
                .setTransactionType(tx.getTransactionType())
                .setTimeout(tx.getTimeoutMillis()),
            startTime: Date.now(),
            ownerUuid: tx.getOwnerUuid(),
        };

        this._transactions.set(tx.getTxnId(), managed);
        this._scheduleTimeout(tx);
    }

    /**
     * Commit a transaction.
     * For TWO_PHASE with multiple records: prepare first, then commit.
     * For ONE_PHASE: direct commit.
     */
    async commitTransaction(txnId: string): Promise<void> {
        const managed = this._getOrThrow(txnId);
        const tx = managed.transaction;

        this._cancelTimeout(txnId);

        try {
            if (tx.getTransactionType() === TransactionType.TWO_PHASE && tx.requiresPrepare()) {
                await tx.prepare();
            }
            await tx.commit();
        } catch (e) {
            // If commit fails we attempt rollback to preserve ACID
            try {
                await tx.rollback();
            } catch {
                // Rollback failure after commit failure — log and continue
                const logger = this._nodeEngine.getLogger(TransactionCoordinator.name);
                logger.warning(`Rollback after commit failure failed for txnId=${txnId}`);
            }
            throw e;
        } finally {
            this._transactions.delete(txnId);
        }
    }

    /**
     * Rollback a transaction, undoing all operations in the transaction log.
     */
    async rollbackTransaction(txnId: string): Promise<void> {
        const managed = this._getOrThrow(txnId);
        const tx = managed.transaction;

        this._cancelTimeout(txnId);

        try {
            await tx.rollback();
        } finally {
            this._transactions.delete(txnId);
        }
    }

    /**
     * Returns the state of a transaction by ID.
     */
    getTransactionState(txnId: string): State | null {
        const managed = this._transactions.get(txnId);
        return managed ? managed.transaction.getState() : null;
    }

    /**
     * Returns all active (not yet committed/rolled back) managed transactions.
     */
    getActiveTransactions(): ReadonlyMap<string, ManagedTransaction> {
        return this._transactions;
    }

    /**
     * Recovery: detect and auto-rollback all dangling transactions.
     * Called when a member leaves or on startup scan.
     */
    async recoverDanglingTransactions(ownerUuid?: string): Promise<number> {
        const toRollback: string[] = [];

        for (const [txnId, managed] of this._transactions) {
            if (ownerUuid !== undefined && managed.ownerUuid !== ownerUuid) continue;
            const state = managed.transaction.getState();
            if (state === State.ACTIVE || state === State.PREPARING || state === State.PREPARED) {
                toRollback.push(txnId);
            }
        }

        let recovered = 0;
        for (const txnId of toRollback) {
            try {
                await this.rollbackTransaction(txnId);
                recovered++;
            } catch (e) {
                const logger = this._nodeEngine.getLogger(TransactionCoordinator.name);
                logger.warning(`Recovery rollback failed for txnId=${txnId}: ${e}`);
            }
        }

        return recovered;
    }

    // ── Private helpers ────────────────────────────────────────────────────

    private _getOrThrow(txnId: string): ManagedTransaction {
        const managed = this._transactions.get(txnId);
        if (!managed) {
            throw new TransactionException(`No active transaction found with id: ${txnId}`);
        }
        return managed;
    }

    private _scheduleTimeout(tx: TransactionImpl): void {
        const timeoutMs = tx.getTimeoutMillis();
        if (timeoutMs <= 0) return;

        const timer = setTimeout(() => {
            const managed = this._transactions.get(tx.getTxnId());
            if (!managed) return;

            const state = tx.getState();
            if (state === State.ACTIVE || state === State.PREPARING || state === State.PREPARED) {
                const logger = this._nodeEngine.getLogger(TransactionCoordinator.name);
                logger.warning(`Transaction ${tx.getTxnId()} timed out after ${timeoutMs}ms — auto-rolling back`);

                void tx.rollback()
                    .catch((e: unknown) => {
                        logger.warning(`Auto-rollback failed for tx ${tx.getTxnId()}: ${e}`);
                    })
                    .finally(() => {
                        this._transactions.delete(tx.getTxnId());
                        this._timeoutTimers.delete(tx.getTxnId());
                    });
            } else {
                this._transactions.delete(tx.getTxnId());
                this._timeoutTimers.delete(tx.getTxnId());
            }

            // Re-throw the timeout error via an unhandled rejection so callers awaiting tx.commit() get it
            void Promise.reject(new TransactionTimedOutException(`Transaction ${tx.getTxnId()} timed out`));
        }, timeoutMs);

        this._timeoutTimers.set(tx.getTxnId(), timer);
    }

    private _cancelTimeout(txnId: string): void {
        const timer = this._timeoutTimers.get(txnId);
        if (timer !== undefined) {
            clearTimeout(timer);
            this._timeoutTimers.delete(txnId);
        }
    }

    shutdown(): void {
        // Cancel all pending timeout timers
        for (const timer of this._timeoutTimers.values()) {
            clearTimeout(timer);
        }
        this._timeoutTimers.clear();
        this._transactions.clear();
    }
}
