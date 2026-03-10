/**
 * Port of {@code com.hazelcast.transaction.impl.TransactionManagerServiceImpl}.
 *
 * Manages transaction backup logs for the two-phase commit protocol and, when a
 * transport is configured, replicates the log lifecycle to backup members.
 */
import type { EncodedData } from '@zenystx/helios-core/cluster/tcp/DataWireCodec';
import type { Counter } from '@zenystx/helios-core/internal/util/counters/Counter';
import { MwCounter } from '@zenystx/helios-core/internal/util/counters/MwCounter';
import type { NodeEngine } from '@zenystx/helios-core/spi/NodeEngine';
import { State } from '@zenystx/helios-core/transaction/impl/Transaction';
import type { TransactionBackupRecord } from '@zenystx/helios-core/transaction/impl/TransactionBackupRecord';
import type { TransactionManagerServiceLike } from '@zenystx/helios-core/transaction/impl/TransactionImpl';
import { TransactionException } from '@zenystx/helios-core/transaction/TransactionException';

export const SERVICE_NAME = 'hz:core:txManagerService';

export interface TransactionBackupTransport {
    readonly localMemberId: string;
    getBackupMemberIds(count: number): string[];
    replicate(message: TransactionBackupMessage, targets: readonly string[]): Promise<void>;
}

export interface TransactionBackupExecutor {
    commitRecord(record: TransactionBackupRecord): Promise<void>;
}

export type TransactionBackupMessage =
    | {
        readonly type: 'TXN_BEGIN';
        readonly txnId: string;
        readonly coordinatorMemberId: string;
        readonly callerUuid: string;
        readonly timeoutMillis: number;
        readonly startTime: number;
        readonly allowedDuringPassiveState: boolean;
    }
    | {
        readonly type: 'TXN_PREPARE';
        readonly txnId: string;
        readonly coordinatorMemberId: string;
        readonly callerUuid: string;
        readonly timeoutMillis: number;
        readonly startTime: number;
        readonly allowedDuringPassiveState: boolean;
        readonly records: TransactionBackupRecord[];
    }
    | {
        readonly type: 'TXN_STATE';
        readonly txnId: string;
        readonly state: State.COMMITTING | State.COMMITTED | State.ROLLING_BACK | State.ROLLED_BACK | State.COMMIT_FAILED;
    }
    | {
        readonly type: 'TXN_PURGE';
        readonly txnId: string;
    };

/**
 * Backup log entry stored on backup members.
 */
export class TxBackupLog {
    state: State;

    constructor(
        public readonly records: TransactionBackupRecord[],
        public readonly coordinatorMemberId: string,
        public readonly callerUuid: string,
        initialState: State,
        public readonly timeoutMillis: number,
        public readonly startTime: number,
        public readonly allowedDuringPassiveState: boolean,
    ) {
        this.state = initialState;
    }

    toString(): string {
        return `TxBackupLog{records=${this.records.length}, coordinatorMemberId='${this.coordinatorMemberId}', callerUuid='${this.callerUuid}', state=${this.state}}`;
    }
}

export class TransactionManagerServiceImpl implements TransactionManagerServiceLike {
    static readonly SERVICE_NAME = SERVICE_NAME;

    readonly txBackupLogs = new Map<string, TxBackupLog>();

    startCount: Counter = MwCounter.newMwCounter();
    commitCount: Counter = MwCounter.newMwCounter();
    rollbackCount: Counter = MwCounter.newMwCounter();

    private readonly _nodeEngine: NodeEngine;
    private _backupTransport: TransactionBackupTransport | null;
    private _backupExecutor: TransactionBackupExecutor | null;
    private readonly _pendingBackupTargets = new Map<string, string[]>();

    constructor(
        nodeEngine: NodeEngine,
        backupTransport: TransactionBackupTransport | null = null,
        backupExecutor: TransactionBackupExecutor | null = null,
    ) {
        this._nodeEngine = nodeEngine;
        this._backupTransport = backupTransport;
        this._backupExecutor = backupExecutor;
    }

    configureReplication(
        backupTransport: TransactionBackupTransport | null,
        backupExecutor: TransactionBackupExecutor | null,
    ): void {
        this._backupTransport = backupTransport;
        this._backupExecutor = backupExecutor;
    }

    pickBackupLogAddresses(durability: number): string[] {
        if (durability <= 0 || this._backupTransport === null) {
            return [];
        }
        return this._backupTransport.getBackupMemberIds(durability);
    }

    rememberBackupTargets(txnId: string, targets: readonly string[]): void {
        if (targets.length === 0) {
            this._pendingBackupTargets.delete(txnId);
            return;
        }
        this._pendingBackupTargets.set(txnId, [...targets]);
    }

    getClusterName(): string {
        return 'helios';
    }

    async createBackupLog(
        callerUuid: string,
        txnId: string,
        timeoutMillis = -1,
        startTime = -1,
        allowedDuringPassiveState = false,
    ): Promise<void> {
        const coordinatorMemberId = this._backupTransport?.localMemberId ?? 'local';
        const log = new TxBackupLog([], coordinatorMemberId, callerUuid, State.ACTIVE, timeoutMillis, startTime, allowedDuringPassiveState);
        if (this.txBackupLogs.has(txnId)) {
            throw new TransactionException('TxLog already exists!');
        }
        this.txBackupLogs.set(txnId, log);
        await this._replicateToPreparedTargets(txnId, {
            type: 'TXN_BEGIN',
            txnId,
            coordinatorMemberId,
            callerUuid,
            timeoutMillis,
            startTime,
            allowedDuringPassiveState,
        });
    }

    async createAllowedDuringPassiveStateBackupLog(callerUuid: string, txnId: string): Promise<void> {
        await this.createBackupLog(callerUuid, txnId, -1, -1, true);
    }

    async replicaBackupLog(
        records: TransactionBackupRecord[],
        callerUuid: string,
        txnId: string,
        timeoutMillis: number,
        startTime: number,
    ): Promise<void> {
        const beginLog = this.txBackupLogs.get(txnId);
        if (beginLog == null) {
            throw new TransactionException('Could not find begin tx log!');
        }
        if (beginLog.state !== State.ACTIVE && beginLog.state !== State.PREPARING && beginLog.state !== State.PREPARED) {
            throw new TransactionException('TxLog already exists!');
        }
        const newLog = new TxBackupLog(
            records,
            beginLog.coordinatorMemberId,
            callerUuid,
            State.PREPARED,
            timeoutMillis,
            startTime,
            beginLog.allowedDuringPassiveState,
        );
        this.txBackupLogs.set(txnId, newLog);
        await this._replicateToPreparedTargets(txnId, {
            type: 'TXN_PREPARE',
            txnId,
            coordinatorMemberId: beginLog.coordinatorMemberId,
            callerUuid,
            timeoutMillis,
            startTime,
            allowedDuringPassiveState: beginLog.allowedDuringPassiveState,
            records,
        });
    }

    async markCommitting(txnId: string): Promise<void> {
        this._setState(txnId, State.COMMITTING);
        await this._replicateState(txnId, State.COMMITTING);
    }

    async markCommitted(txnId: string): Promise<void> {
        this._setState(txnId, State.COMMITTED);
        await this._replicateState(txnId, State.COMMITTED);
    }

    async markCommitFailed(txnId: string): Promise<void> {
        this._setState(txnId, State.COMMIT_FAILED);
        await this._replicateState(txnId, State.COMMIT_FAILED);
    }

    async rollbackBackupLog(txnId: string): Promise<void> {
        const log = this.txBackupLogs.get(txnId);
        if (log == null) {
            this._nodeEngine.getLogger(TransactionManagerServiceImpl.name).warning(
                `No tx backup log is found, tx -> ${txnId}`,
            );
            return;
        }
        log.state = State.ROLLING_BACK;
        await this._replicateState(txnId, State.ROLLING_BACK);
    }

    async markRolledBack(txnId: string): Promise<void> {
        this._setState(txnId, State.ROLLED_BACK);
        await this._replicateState(txnId, State.ROLLED_BACK);
    }

    async purgeBackupLog(txnId: string): Promise<void> {
        this.txBackupLogs.delete(txnId);
        await this._replicateToPreparedTargets(txnId, {
            type: 'TXN_PURGE',
            txnId,
        });
        this._pendingBackupTargets.delete(txnId);
    }

    applyBackupMessage(message: TransactionBackupMessage): void {
        switch (message.type) {
            case 'TXN_BEGIN':
                this.txBackupLogs.set(
                    message.txnId,
                    new TxBackupLog(
                        [],
                        message.coordinatorMemberId,
                        message.callerUuid,
                        State.ACTIVE,
                        message.timeoutMillis,
                        message.startTime,
                        message.allowedDuringPassiveState,
                    ),
                );
                return;
            case 'TXN_PREPARE':
                this.txBackupLogs.set(
                    message.txnId,
                    new TxBackupLog(
                        message.records,
                        message.coordinatorMemberId,
                        message.callerUuid,
                        State.PREPARED,
                        message.timeoutMillis,
                        message.startTime,
                        message.allowedDuringPassiveState,
                    ),
                );
                return;
            case 'TXN_STATE': {
                const existing = this.txBackupLogs.get(message.txnId);
                if (existing !== undefined) {
                    existing.state = message.state;
                }
                return;
            }
            case 'TXN_PURGE':
                this.txBackupLogs.delete(message.txnId);
                return;
        }
    }

    getBackupLog(txnId: string): TxBackupLog | null {
        return this.txBackupLogs.get(txnId) ?? null;
    }

    async recoverBackupLogsForCoordinator(coordinatorMemberId: string): Promise<number> {
        if (this._backupExecutor === null) {
            return 0;
        }

        let recovered = 0;
        for (const [txnId, log] of [...this.txBackupLogs.entries()]) {
            if (log.coordinatorMemberId !== coordinatorMemberId) {
                continue;
            }

            if (log.state === State.PREPARED || log.state === State.COMMITTING) {
                for (const record of log.records) {
                    await this._backupExecutor.commitRecord(record);
                }
                recovered++;
            }

            this.txBackupLogs.delete(txnId);
            this._pendingBackupTargets.delete(txnId);
        }

        return recovered;
    }

    reset(): void {
        this.txBackupLogs.clear();
        this._pendingBackupTargets.clear();
    }

    shutdown(_terminate: boolean): void {
        this.reset();
    }

    private _setState(txnId: string, state: State): void {
        const log = this.txBackupLogs.get(txnId);
        if (log !== undefined) {
            log.state = state;
        }
    }

    private async _replicateState(
        txnId: string,
        state: State.COMMITTING | State.COMMITTED | State.ROLLING_BACK | State.ROLLED_BACK | State.COMMIT_FAILED,
    ): Promise<void> {
        await this._replicateToPreparedTargets(txnId, {
            type: 'TXN_STATE',
            txnId,
            state,
        });
    }

    private async _replicateToPreparedTargets(txnId: string, message: TransactionBackupMessage): Promise<void> {
        const targets = this._pendingBackupTargets.get(txnId) ?? [];
        if (targets.length === 0 || this._backupTransport === null) {
            return;
        }
        await this._backupTransport.replicate(message, targets);
    }
}

export function encodeMaybeData(data: { toByteArray(): Buffer | null } | null): EncodedData | null {
    if (data === null) {
        return null;
    }
    const bytes = data.toByteArray();
    if (bytes === null) {
        throw new TransactionException('Cannot encode null transaction data');
    }
    return { bytes: Buffer.from(bytes) };
}
