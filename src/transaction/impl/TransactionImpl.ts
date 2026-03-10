/**
 * Port of {@code com.hazelcast.transaction.impl.TransactionImpl}.
 *
 * Core transaction implementation supporting ONE_PHASE and TWO_PHASE commit protocols.
 *
 * In TypeScript (single-threaded Bun), thread-access checks are omitted.
 * Java's blocking waitWithDeadline() is replaced by Promise.all().
 */
import type { Counter } from '@zenystx/helios-core/internal/util/counters/Counter';
import type { NodeEngine } from '@zenystx/helios-core/spi/NodeEngine';
import type { Transaction } from '@zenystx/helios-core/transaction/impl/Transaction';
import type { TransactionBackupRecord } from '@zenystx/helios-core/transaction/impl/TransactionBackupRecord';
import { State } from '@zenystx/helios-core/transaction/impl/Transaction';
import { TransactionLog } from '@zenystx/helios-core/transaction/impl/TransactionLog';
import type { TransactionLogRecord } from '@zenystx/helios-core/transaction/impl/TransactionLogRecord';
import { TransactionException } from '@zenystx/helios-core/transaction/TransactionException';
import { TransactionNotActiveException } from '@zenystx/helios-core/transaction/TransactionNotActiveException';
import { TransactionOptions, TransactionType } from '@zenystx/helios-core/transaction/TransactionOptions';
import { TransactionTimedOutException } from '@zenystx/helios-core/transaction/TransactionTimedOutException';

/** Minimal interface that TransactionImpl needs from the manager service. */
export interface TransactionManagerServiceLike {
    startCount: Counter;
    commitCount: Counter;
    rollbackCount: Counter;
    pickBackupLogAddresses(durability: number): string[];
    rememberBackupTargets(txnId: string, targets: readonly string[]): Promise<void>;
    createBackupLog(callerUuid: string, txnId: string, timeoutMillis: number, startTime: number, allowedDuringPassiveState: boolean): Promise<void>;
    createAllowedDuringPassiveStateBackupLog(callerUuid: string, txnId: string): Promise<void>;
    replicaBackupLog(records: TransactionBackupRecord[], callerUuid: string, txnId: string, timeoutMillis: number, startTime: number): Promise<void>;
    markCommitting(txnId: string): Promise<void>;
    markCommitted(txnId: string): Promise<void>;
    markCommitFailed(txnId: string): Promise<void>;
    rollbackBackupLog(txnId: string): Promise<void>;
    markRolledBack(txnId: string): Promise<void>;
    purgeBackupLog(txnId: string): Promise<void>;
}

// Module-level flag to prevent nested transactions (mimics Java ThreadLocal).
// Only active when checkThreadAccess = true (txOwnerUuid was null at construction).
let _transactionActive = false;

export class TransactionImpl implements Transaction {
    private readonly _transactionManagerService: TransactionManagerServiceLike;
    private readonly _nodeEngine: NodeEngine;
    private readonly _txnId: string;
    private readonly _durability: number;
    private readonly _transactionType: TransactionType;
    private readonly _txOwnerUuid: string;
    private readonly _transactionLog: TransactionLog;
    /** When true, enforces single-transaction-per-context check (txOwnerUuid was null). */
    private readonly _checkThreadAccess: boolean;

    private _state: State = State.NO_TXN;
    private _startTime = 0;
    private _timeoutMillis: number;
    private _backupLogsCreated = false;
    private _originatedFromClient: boolean;

    constructor(
        transactionManagerService: TransactionManagerServiceLike,
        nodeEngine: NodeEngine,
        options: TransactionOptions,
        txOwnerUuid: string | null,
        originatedFromClient = false,
    ) {
        this._transactionLog = new TransactionLog();
        this._transactionManagerService = transactionManagerService;
        this._nodeEngine = nodeEngine;
        this._txnId = crypto.randomUUID();
        this._timeoutMillis = options.getTimeoutMillis();
        this._transactionType = options.getTransactionType();
        this._durability = this._transactionType === TransactionType.ONE_PHASE ? 0 : options.getDurability();
        this._checkThreadAccess = txOwnerUuid === null;
        this._txOwnerUuid = txOwnerUuid ?? crypto.randomUUID();
        this._originatedFromClient = originatedFromClient;
    }

    getTxnId(): string { return this._txnId; }
    getOwnerUuid(): string { return this._txOwnerUuid; }
    isOriginatedFromClient(): boolean { return this._originatedFromClient; }
    getState(): State { return this._state; }
    getTimeoutMillis(): number { return this._timeoutMillis; }
    getTransactionType(): TransactionType { return this._transactionType; }

    protected getTransactionLog(): TransactionLog { return this._transactionLog; }

    add(record: TransactionLogRecord): void {
        if (this._state !== State.ACTIVE) {
            throw new TransactionNotActiveException('Transaction is not active!');
        }
        this._transactionLog.add(record);
    }

    get(key: unknown): TransactionLogRecord | null {
        return this._transactionLog.get(key);
    }

    remove(key: unknown): void {
        this._transactionLog.remove(key);
    }

    async begin(): Promise<void> {
        if (this._state === State.ACTIVE) {
            throw new Error('Transaction is already active');
        }
        if (this._checkThreadAccess && _transactionActive) {
            throw new Error('Nested transactions are not allowed!');
        }
        this._startTime = Date.now();
        // May throw — callers catch and rethrow
        const backupTargets = this._transactionManagerService.pickBackupLogAddresses(this._durability);
        await this._transactionManagerService.rememberBackupTargets(this._txnId, backupTargets);
        this._setTransactionFlag(true);
        this._state = State.ACTIVE;
        if (backupTargets.length > 0) {
            await this._transactionManagerService.createBackupLog(
                this._txOwnerUuid,
                this._txnId,
                this._timeoutMillis,
                this._startTime,
                false,
            );
            this._backupLogsCreated = true;
        }
        this._transactionManagerService.startCount.inc();
    }

    private _setTransactionFlag(active: boolean): void {
        if (this._checkThreadAccess) {
            _transactionActive = active;
        }
    }

    async prepare(): Promise<void> {
        if (this._state !== State.ACTIVE) {
            throw new TransactionNotActiveException('Transaction is not active');
        }
        this._checkTimeout();
        try {
            this._state = State.PREPARING;
            const futures = this._transactionLog.prepare(this._nodeEngine);
            await this._waitAll(futures);
            if (this._backupLogsCreated) {
                await this._transactionManagerService.replicaBackupLog(
                    this._transactionLog.toBackupRecords(),
                    this._txOwnerUuid,
                    this._txnId,
                    this._timeoutMillis,
                    this._startTime,
                );
            }
            this._state = State.PREPARED;
        } catch (e) {
            throw this._rethrowAsTransactionException(e);
        }
    }

    requiresPrepare(): boolean {
        if (this._transactionType === TransactionType.ONE_PHASE) {
            return false;
        }
        return this._transactionLog.size() > 1;
    }

    async commit(): Promise<void> {
        try {
            if (this._transactionType === TransactionType.TWO_PHASE) {
                if (this._transactionLog.size() > 1) {
                    if (this._state !== State.PREPARED) {
                        throw new Error('Transaction is not prepared');
                    }
                } else {
                    if (this._state !== State.PREPARED && this._state !== State.ACTIVE) {
                        throw new Error('Transaction is not prepared or active');
                    }
                }
            } else if (this._transactionType === TransactionType.ONE_PHASE && this._state !== State.ACTIVE) {
                throw new Error('Transaction is not active');
            }

            this._checkTimeout();
            try {
                this._state = State.COMMITTING;
                if (this._backupLogsCreated) {
                    await this._transactionManagerService.markCommitting(this._txnId);
                }
                const futures = this._transactionLog.commit(this._nodeEngine);
                await this._waitAll(futures);
                this._state = State.COMMITTED;
                if (this._backupLogsCreated) {
                    await this._transactionManagerService.markCommitted(this._txnId);
                }
                this._transactionManagerService.commitCount.inc();
                this._transactionLog.onCommitSuccess();
            } catch (e) {
                this._state = State.COMMIT_FAILED;
                if (this._backupLogsCreated) {
                    await this._transactionManagerService.markCommitFailed(this._txnId);
                }
                this._transactionLog.onCommitFailure();
                throw this._rethrowAsTransactionException(e);
            } finally {
                if (this._backupLogsCreated) {
                    await this._transactionManagerService.purgeBackupLog(this._txnId);
                }
            }
        } finally {
            this._setTransactionFlag(false);
        }
    }

    async rollback(): Promise<void> {
        try {
            if (this._state === State.NO_TXN || this._state === State.ROLLED_BACK) {
                throw new Error('Transaction is not active');
            }
            this._state = State.ROLLING_BACK;
            try {
                if (this._backupLogsCreated) {
                    await this._transactionManagerService.rollbackBackupLog(this._txnId);
                }
                const futures = this._transactionLog.rollback(this._nodeEngine);
                await this._waitAllIgnoreErrors(futures);
            } catch (e) {
                throw e;
            } finally {
                this._state = State.ROLLED_BACK;
                if (this._backupLogsCreated) {
                    await this._transactionManagerService.markRolledBack(this._txnId);
                    await this._transactionManagerService.purgeBackupLog(this._txnId);
                }
                this._transactionManagerService.rollbackCount.inc();
            }
        } finally {
            this._setTransactionFlag(false);
        }
    }

    toString(): string {
        return `Transaction{txnId='${this._txnId}', state=${this._state}, txType=${this._transactionType}, timeoutMillis=${this._timeoutMillis}}`;
    }

    // ── private helpers ──────────────────────────────────────────────────────

    private _checkTimeout(): void {
        if (this._startTime + this._timeoutMillis < Date.now()) {
            throw new TransactionTimedOutException('Transaction is timed-out!');
        }
    }

    private async _waitAll(futures: { get(): Promise<unknown> }[]): Promise<void> {
        // RETHROW_TRANSACTION_EXCEPTION semantics: rethrow TransactionException, wrap others
        try {
            await Promise.all(futures.map(f => f.get()));
        } catch (e) {
            throw this._rethrowAsTransactionException(e);
        }
    }

    private async _waitAllIgnoreErrors(futures: { get(): Promise<unknown> }[]): Promise<void> {
        await Promise.allSettled(futures.map(f => f.get()));
    }

    private _rethrowAsTransactionException(e: unknown): TransactionException {
        if (e instanceof TransactionException) return e;
        return new TransactionException(e instanceof Error ? e.message : String(e));
    }
}
