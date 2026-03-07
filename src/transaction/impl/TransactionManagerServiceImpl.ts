/**
 * Port of {@code com.hazelcast.transaction.impl.TransactionManagerServiceImpl}.
 *
 * Manages backup transaction logs for the two-phase commit protocol.
 * In the current single-node phase, backup replication is deferred;
 * only the in-memory backup log tracking is implemented.
 */
import type { Counter } from '@zenystx/helios-core/internal/util/counters/Counter';
import { MwCounter } from '@zenystx/helios-core/internal/util/counters/MwCounter';
import type { NodeEngine } from '@zenystx/helios-core/spi/NodeEngine';
import { State } from '@zenystx/helios-core/transaction/impl/Transaction';
import type { TransactionManagerServiceLike } from '@zenystx/helios-core/transaction/impl/TransactionImpl';
import type { TransactionLogRecord } from '@zenystx/helios-core/transaction/impl/TransactionLogRecord';
import { TransactionException } from '@zenystx/helios-core/transaction/TransactionException';

export const SERVICE_NAME = 'hz:core:txManagerService';

/**
 * Backup log entry stored on backup members.
 */
export class TxBackupLog {
    state: State;

    constructor(
        public readonly records: TransactionLogRecord[],
        public readonly callerUuid: string,
        initialState: State,
        public readonly timeoutMillis: number,
        public readonly startTime: number,
        public readonly allowedDuringPassiveState: boolean,
    ) {
        this.state = initialState;
    }

    toString(): string {
        return `TxBackupLog{records=${this.records.length}, callerUuid='${this.callerUuid}', state=${this.state}}`;
    }
}

export class TransactionManagerServiceImpl implements TransactionManagerServiceLike {
    static readonly SERVICE_NAME = SERVICE_NAME;

    readonly txBackupLogs = new Map<string, TxBackupLog>();

    startCount:    Counter = MwCounter.newMwCounter();
    commitCount:   Counter = MwCounter.newMwCounter();
    rollbackCount: Counter = MwCounter.newMwCounter();

    private readonly _nodeEngine: NodeEngine;

    constructor(nodeEngine: NodeEngine) {
        this._nodeEngine = nodeEngine;
    }

    /** Pick backup-log addresses (no-op in single-node mode). */
    pickBackupLogAddresses(_durability: number): unknown[] {
        return [];
    }

    getClusterName(): string {
        // In single-node mode, return a default name.
        return 'helios';
    }

    // ── backup log management ─────────────────────────────────────────────

    createBackupLog(callerUuid: string, txnId: string): void {
        const log = new TxBackupLog([], callerUuid, State.ACTIVE, -1, -1, false);
        if (this.txBackupLogs.has(txnId)) {
            throw new TransactionException('TxLog already exists!');
        }
        this.txBackupLogs.set(txnId, log);
    }

    createAllowedDuringPassiveStateBackupLog(callerUuid: string, txnId: string): void {
        const log = new TxBackupLog([], callerUuid, State.ACTIVE, -1, -1, true);
        if (this.txBackupLogs.has(txnId)) {
            throw new TransactionException('TxLog already exists!');
        }
        this.txBackupLogs.set(txnId, log);
    }

    replicaBackupLog(
        records: TransactionLogRecord[],
        callerUuid: string,
        txnId: string,
        timeoutMillis: number,
        startTime: number,
    ): void {
        const beginLog = this.txBackupLogs.get(txnId);
        if (beginLog == null) {
            throw new TransactionException('Could not find begin tx log!');
        }
        if (beginLog.state !== State.ACTIVE) {
            throw new TransactionException('TxLog already exists!');
        }
        const newLog = new TxBackupLog(
            records, callerUuid, State.COMMITTING, timeoutMillis, startTime,
            beginLog.allowedDuringPassiveState,
        );
        this.txBackupLogs.set(txnId, newLog);
    }

    rollbackBackupLog(txnId: string): void {
        const log = this.txBackupLogs.get(txnId);
        if (log == null) {
            this._nodeEngine.getLogger(TransactionManagerServiceImpl.name).warning(
                `No tx backup log is found, tx -> ${txnId}`
            );
            return;
        }
        log.state = State.ROLLING_BACK;
    }

    purgeBackupLog(txnId: string): void {
        this.txBackupLogs.delete(txnId);
    }

    reset(): void {
        this.txBackupLogs.clear();
    }

    shutdown(_terminate: boolean): void {
        this.reset();
    }
}
