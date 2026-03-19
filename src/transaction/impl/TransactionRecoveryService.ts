/**
 * Port of {@code com.hazelcast.transaction.impl.TransactionRecoveryService}.
 *
 * Maintains replicated transaction logs received from peer coordinator members.
 * On member crash, detects orphaned PREPARED transactions and rolls them back
 * after the configured recovery timeout.
 *
 * Background sweep runs every SWEEP_INTERVAL_MS to force-rollback transactions
 * that have exceeded their timeout.
 */
import type { ILogger } from '@zenystx/helios-core/logging/Logger.js';
import type { NodeEngine } from '@zenystx/helios-core/spi/NodeEngine.js';
import { State } from '@zenystx/helios-core/transaction/impl/Transaction.js';
import type { TransactionCoordinator } from '@zenystx/helios-core/transaction/impl/TransactionCoordinator.js';
import type { TransactionManagerServiceImpl } from '@zenystx/helios-core/transaction/impl/TransactionManagerServiceImpl.js';

/** Minimum data stored for each replicated backup log. */
export interface ReplicatedTransactionLog {
    readonly txnId: string;
    readonly coordinatorMemberId: string;
    readonly callerUuid: string;
    readonly startTime: number;
    readonly timeoutMillis: number;
    state: State;
}

const SWEEP_INTERVAL_MS = 30_000;

export class TransactionRecoveryService {
    private readonly _logger: ILogger;
    private readonly _txManagerService: TransactionManagerServiceImpl;
    private readonly _coordinator: TransactionCoordinator;

    /** Replicated backup logs received from remote coordinators, keyed by txnId. */
    private readonly _replicatedLogs = new Map<string, ReplicatedTransactionLog>();

    private _sweepTimer: ReturnType<typeof setInterval> | null = null;

    constructor(
        nodeEngine: NodeEngine,
        txManagerService: TransactionManagerServiceImpl,
        coordinator: TransactionCoordinator,
    ) {
        this._logger = nodeEngine.getLogger(TransactionRecoveryService.name);
        this._txManagerService = txManagerService;
        this._coordinator = coordinator;
    }

    /**
     * Start the background sweep timer.
     * Should be called once during node startup.
     */
    start(): void {
        if (this._sweepTimer !== null) return;
        this._sweepTimer = setInterval(() => {
            void this._sweep();
        }, SWEEP_INTERVAL_MS);
    }

    /**
     * Stop the background sweep timer.
     * Should be called during node shutdown.
     */
    shutdown(): void {
        if (this._sweepTimer !== null) {
            clearInterval(this._sweepTimer);
            this._sweepTimer = null;
        }
        this._replicatedLogs.clear();
    }

    /**
     * Register a replicated transaction log received from a remote coordinator.
     * Called when a TXN_BEGIN or TXN_PREPARE backup message arrives.
     */
    registerReplicatedLog(log: ReplicatedTransactionLog): void {
        this._replicatedLogs.set(log.txnId, log);
    }

    /**
     * Update the state of a replicated log.
     * Called when a TXN_STATE backup message arrives.
     */
    updateReplicatedLogState(txnId: string, state: State): void {
        const log = this._replicatedLogs.get(txnId);
        if (log !== undefined) {
            log.state = state;
        }
    }

    /**
     * Remove a replicated transaction log once the transaction has completed.
     * Called when a TXN_PURGE backup message arrives.
     */
    removeReplicatedLog(txnId: string): void {
        this._replicatedLogs.delete(txnId);
    }

    /**
     * Recover orphaned transactions whose coordinator member has crashed.
     * For each PREPARED transaction belonging to `crashedMemberId`, attempts
     * to roll back the transaction via the local coordinator or backup log
     * recovery path in the manager service.
     *
     * @returns Number of transactions successfully recovered.
     */
    async recoverOrphanedTransactions(crashedMemberId: string): Promise<number> {
        const orphaned: string[] = [];
        for (const [txnId, log] of this._replicatedLogs) {
            if (log.coordinatorMemberId !== crashedMemberId) continue;
            if (log.state === State.COMMITTED || log.state === State.ROLLED_BACK || log.state === State.COMMIT_FAILED) {
                this._replicatedLogs.delete(txnId);
                continue;
            }
            orphaned.push(txnId);
        }

        let recovered = 0;
        for (const txnId of orphaned) {
            try {
                this._logger.warning(`Recovering orphaned transaction ${txnId} from crashed coordinator ${crashedMemberId}`);
                const count = await this._txManagerService.recoverBackupLogsForCoordinator(crashedMemberId);
                recovered += count;
                this._replicatedLogs.delete(txnId);
            } catch (e) {
                this._logger.warning(`Recovery failed for orphaned transaction ${txnId}: ${e}`);
            }
        }

        // Also attempt coordinator-level recovery for any active transactions from the crashed member
        const coordinatorRecovered = await this._coordinator.recoverDanglingTransactions(crashedMemberId);
        recovered += coordinatorRecovered;

        if (recovered > 0) {
            this._logger.info(`Recovered ${recovered} orphaned transactions from crashed coordinator ${crashedMemberId}`);
        }

        return recovered;
    }

    /**
     * Snapshot of all currently tracked replicated logs (for diagnostics).
     */
    getReplicatedLogs(): ReadonlyMap<string, ReplicatedTransactionLog> {
        return this._replicatedLogs;
    }

    // ── Private ────────────────────────────────────────────────────────────────

    /**
     * Periodic sweep: force-rollback any transaction that has exceeded its timeout.
     * This guards against coordinators that are alive but have stalled transactions.
     */
    private async _sweep(): Promise<void> {
        const now = Date.now();
        const timedOut: string[] = [];

        for (const [txnId, log] of this._replicatedLogs) {
            if (log.state === State.COMMITTED || log.state === State.ROLLED_BACK || log.state === State.COMMIT_FAILED) {
                this._replicatedLogs.delete(txnId);
                continue;
            }
            if (log.timeoutMillis > 0 && now > log.startTime + log.timeoutMillis) {
                timedOut.push(txnId);
            }
        }

        for (const txnId of timedOut) {
            const log = this._replicatedLogs.get(txnId);
            if (log === undefined) continue;
            this._logger.warning(
                `Sweeping timed-out replicated transaction ${txnId} (coordinator=${log.coordinatorMemberId}, elapsed=${Date.now() - log.startTime}ms)`,
            );
            try {
                await this._txManagerService.recoverBackupLogsForCoordinator(log.coordinatorMemberId);
                this._replicatedLogs.delete(txnId);
            } catch (e) {
                this._logger.warning(`Sweep recovery failed for transaction ${txnId}: ${e}`);
            }
        }

        // Also sweep active coordinator-local transactions
        await this._sweepActiveTransactions(now);
    }

    /**
     * Sweep coordinator-managed active transactions for timeout.
     * The coordinator's per-transaction `setTimeout` handles the primary timeout,
     * but this provides a secondary safety net for cases where the timer is missed.
     */
    private async _sweepActiveTransactions(now: number): Promise<void> {
        for (const [txnId, managed] of this._coordinator.getActiveTransactions()) {
            const tx = managed.transaction;
            const timeoutMillis = tx.getTimeoutMillis();
            if (timeoutMillis <= 0) continue;
            if (now <= managed.startTime + timeoutMillis) continue;

            const state = tx.getState();
            if (state !== State.ACTIVE && state !== State.PREPARING && state !== State.PREPARED) continue;

            this._logger.warning(
                `Secondary sweep: rolling back timed-out transaction ${txnId} (elapsed=${now - managed.startTime}ms)`,
            );
            try {
                await this._coordinator.rollbackTransaction(txnId);
            } catch (e) {
                this._logger.warning(`Secondary sweep rollback failed for transaction ${txnId}: ${e}`);
            }
        }
    }
}
