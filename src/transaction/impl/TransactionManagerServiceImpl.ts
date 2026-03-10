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

const RECOVERED_TXN_CACHE_LIMIT = 4_096;
const APPLIED_RECORD_CACHE_LIMIT = 16_384;

export interface TransactionBackupTransport {
    readonly localMemberId: string;
    getBackupMemberIds(count: number): string[];
    validateBackupMembers(targets: readonly string[]): Promise<string[]>;
    replicate(message: TransactionBackupMessage, targets: readonly string[]): Promise<string[]>;
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
        readonly backupMemberIds: readonly string[];
    }
    | {
        readonly type: 'TXN_PREPARE';
        readonly txnId: string;
        readonly coordinatorMemberId: string;
        readonly callerUuid: string;
        readonly timeoutMillis: number;
        readonly startTime: number;
        readonly allowedDuringPassiveState: boolean;
        readonly backupMemberIds: readonly string[];
        readonly records: TransactionBackupRecord[];
    }
    | {
        readonly type: 'TXN_STATE';
        readonly txnId: string;
        readonly state: State.COMMITTING | State.COMMITTED | State.ROLLING_BACK | State.ROLLED_BACK | State.COMMIT_FAILED;
    }
    | {
        readonly type: 'TXN_RECOVERED';
        readonly txnId: string;
        readonly recoveryMemberId: string;
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
    recoveryOwnerMemberId: string | null;
    recovered: boolean;

    constructor(
        public readonly records: TransactionBackupRecord[],
        public readonly coordinatorMemberId: string,
        public readonly callerUuid: string,
        initialState: State,
        public readonly timeoutMillis: number,
        public readonly startTime: number,
        public readonly allowedDuringPassiveState: boolean,
        public readonly backupMemberIds: readonly string[] = [],
    ) {
        this.state = initialState;
        this.recoveryOwnerMemberId = null;
        this.recovered = false;
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
    private readonly _recoveredTxnIds: string[] = [];
    private readonly _recoveredTxnIdSet = new Set<string>();
    private readonly _appliedRecordIds: string[] = [];
    private readonly _appliedRecordIdSet = new Set<string>();

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

    async rememberBackupTargets(txnId: string, targets: readonly string[]): Promise<void> {
        if (targets.length === 0) {
            this._pendingBackupTargets.delete(txnId);
            return;
        }
        if (this._backupTransport === null) {
            throw new TransactionException('Transaction durability requires configured backup transport');
        }
        const validatedTargets = await this._backupTransport.validateBackupMembers(targets);
        if (validatedTargets.length !== targets.length) {
            throw new TransactionException(
                `Transaction durability requires ${targets.length} confirmed backups but only ${validatedTargets.length} are available`,
            );
        }
        this._pendingBackupTargets.set(txnId, [...validatedTargets]);
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
        const backupMemberIds = this._pendingBackupTargets.get(txnId) ?? [];
        await this._replicateToPreparedTargets(txnId, {
            type: 'TXN_BEGIN',
            txnId,
            coordinatorMemberId,
            callerUuid,
            timeoutMillis,
            startTime,
            allowedDuringPassiveState,
            backupMemberIds,
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
            beginLog.backupMemberIds,
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
            backupMemberIds: beginLog.backupMemberIds,
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
                        message.backupMemberIds,
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
                        message.backupMemberIds,
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
            case 'TXN_RECOVERED': {
                const existing = this.txBackupLogs.get(message.txnId);
                if (existing !== undefined) {
                    existing.recovered = true;
                    existing.recoveryOwnerMemberId = message.recoveryMemberId;
                }
                this._rememberRecoveredTxn(message.txnId);
                return;
            }
            case 'TXN_PURGE':
                this.txBackupLogs.delete(message.txnId);
                this._pendingBackupTargets.delete(message.txnId);
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

            if (log.state === State.COMMITTED || log.state === State.ROLLED_BACK || log.state === State.COMMIT_FAILED) {
                this.txBackupLogs.delete(txnId);
                this._pendingBackupTargets.delete(txnId);
                continue;
            }

            if (this._recoveredTxnIdSet.has(txnId) && !log.recovered) {
                log.recovered = true;
            }

            if (log.recovered && log.recoveryOwnerMemberId !== this._backupTransport?.localMemberId) {
                continue;
            }

            if (log.state === State.PREPARED || log.state === State.COMMITTING) {
                const localMemberId = this._backupTransport?.localMemberId ?? 'local';
                await this._replicateToPreparedTargets(txnId, {
                    type: 'TXN_RECOVERED',
                    txnId,
                    recoveryMemberId: localMemberId,
                });
                log.recovered = true;
                log.recoveryOwnerMemberId = localMemberId;
                for (const record of log.records) {
                    if (this._appliedRecordIdSet.has(record.recordId)) {
                        continue;
                    }
                    await this._backupExecutor.commitRecord(record);
                    this._rememberAppliedRecord(record.recordId);
                }
                this._rememberRecoveredTxn(txnId);
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
        this._recoveredTxnIds.length = 0;
        this._recoveredTxnIdSet.clear();
        this._appliedRecordIds.length = 0;
        this._appliedRecordIdSet.clear();
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
        const logTargets = this.txBackupLogs.get(txnId)?.backupMemberIds ?? [];
        const targets = logTargets.length > 0 ? [...logTargets] : (this._pendingBackupTargets.get(txnId) ?? []);
        if (targets.length === 0 || this._backupTransport === null) {
            return;
        }
        const acknowledgedTargets = await this._backupTransport.replicate(message, targets);
        if (acknowledgedTargets.length !== targets.length) {
            throw new TransactionException(
                `Transaction durability replication incomplete for ${txnId}: required=${targets.length}, confirmed=${acknowledgedTargets.length}`,
            );
        }
    }

    private _rememberRecoveredTxn(txnId: string): void {
        if (this._recoveredTxnIdSet.has(txnId)) {
            return;
        }
        this._recoveredTxnIdSet.add(txnId);
        this._recoveredTxnIds.push(txnId);
        while (this._recoveredTxnIds.length > RECOVERED_TXN_CACHE_LIMIT) {
            const oldest = this._recoveredTxnIds.shift();
            if (oldest !== undefined) {
                this._recoveredTxnIdSet.delete(oldest);
            }
        }
    }

    private _rememberAppliedRecord(recordId: string): void {
        if (this._appliedRecordIdSet.has(recordId)) {
            return;
        }
        this._appliedRecordIdSet.add(recordId);
        this._appliedRecordIds.push(recordId);
        while (this._appliedRecordIds.length > APPLIED_RECORD_CACHE_LIMIT) {
            const oldest = this._appliedRecordIds.shift();
            if (oldest !== undefined) {
                this._appliedRecordIdSet.delete(oldest);
            }
        }
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

export function snapshotTxBackupLog(log: TxBackupLog): TxBackupLog {
    const copy = new TxBackupLog(
        [...log.records],
        log.coordinatorMemberId,
        log.callerUuid,
        log.state,
        log.timeoutMillis,
        log.startTime,
        log.allowedDuringPassiveState,
        log.backupMemberIds,
    );
    copy.recovered = log.recovered;
    copy.recoveryOwnerMemberId = log.recoveryOwnerMemberId;
    return copy;
}
