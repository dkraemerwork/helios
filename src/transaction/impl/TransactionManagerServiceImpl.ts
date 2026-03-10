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
    getActiveMemberIds(): readonly string[];
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
        readonly type: 'TXN_RECOVERY_STARTED';
        readonly txnId: string;
        readonly recoveryMemberId: string;
        readonly recoveryFenceToken: string;
    }
    | {
        readonly type: 'TXN_RECOVERY_FAILED';
        readonly txnId: string;
        readonly recoveryMemberId: string;
        readonly recoveryFenceToken: string;
    }
    | {
        readonly type: 'TXN_RECOVERED';
        readonly txnId: string;
        readonly recoveryMemberId: string;
        readonly recoveryFenceToken: string;
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
    recoveryFenceToken: string | null;
    recoveryState: 'IDLE' | 'IN_PROGRESS' | 'FAILED' | 'COMPLETED';
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
        this.recoveryFenceToken = null;
        this.recoveryState = 'IDLE';
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
    private readonly _activeRecoveryRuns = new Map<string, Promise<boolean>>();

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
        const backupMemberIds = this._pendingBackupTargets.get(txnId) ?? [];
        const log = new TxBackupLog([], coordinatorMemberId, callerUuid, State.ACTIVE, timeoutMillis, startTime, allowedDuringPassiveState, backupMemberIds);
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

    applyBackupMessage(message: TransactionBackupMessage): boolean {
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
                return true;
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
                return true;
            case 'TXN_STATE': {
                const existing = this.txBackupLogs.get(message.txnId);
                if (existing !== undefined) {
                    existing.state = message.state;
                }
                return true;
            }
            case 'TXN_RECOVERY_STARTED': {
                const existing = this.txBackupLogs.get(message.txnId);
                if (existing !== undefined && this._shouldAcceptRecoveryFence(existing, message.recoveryMemberId, message.recoveryFenceToken)) {
                    existing.recoveryOwnerMemberId = message.recoveryMemberId;
                    existing.recoveryFenceToken = message.recoveryFenceToken;
                    existing.recoveryState = 'IN_PROGRESS';
                    return true;
                }
                return false;
            }
            case 'TXN_RECOVERY_FAILED': {
                const existing = this.txBackupLogs.get(message.txnId);
                if (existing !== undefined && this._matchesRecoveryFence(existing, message.recoveryMemberId, message.recoveryFenceToken)) {
                    this._clearRecoveryFence(existing, 'FAILED');
                    return true;
                }
                return existing === undefined;
            }
            case 'TXN_RECOVERED': {
                const existing = this.txBackupLogs.get(message.txnId);
                if (existing !== undefined && this._matchesRecoveryFence(existing, message.recoveryMemberId, message.recoveryFenceToken)) {
                    existing.recovered = true;
                    existing.recoveryOwnerMemberId = message.recoveryMemberId;
                    existing.recoveryFenceToken = message.recoveryFenceToken;
                    existing.recoveryState = 'COMPLETED';
                    this._rememberRecoveredTxn(message.txnId);
                    return true;
                }
                return existing === undefined;
            }
            case 'TXN_PURGE':
                this.txBackupLogs.delete(message.txnId);
                this._pendingBackupTargets.delete(message.txnId);
                return true;
        }
    }

    getBackupLog(txnId: string): TxBackupLog | null {
        return this.txBackupLogs.get(txnId) ?? null;
    }

    async recoverBackupLogsForCoordinator(coordinatorMemberId: string): Promise<number> {
        if (this._backupExecutor === null) {
            return 0;
        }

        const localMemberId = this._backupTransport?.localMemberId ?? 'local';
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
                log.recoveryState = 'COMPLETED';
            }

            if (log.recovered || log.recoveryState === 'COMPLETED') {
                continue;
            }

            if (log.recoveryState === 'IN_PROGRESS') {
                if (log.recoveryOwnerMemberId === localMemberId) {
                    const activeRun = this._activeRecoveryRuns.get(txnId);
                    if (activeRun !== undefined) {
                        await activeRun;
                    }
                }
                continue;
            }

            if (log.recoveryOwnerMemberId !== null && !this._isMemberActive(log.recoveryOwnerMemberId)) {
                this._clearRecoveryFence(log, 'FAILED');
            }

            if (log.state === State.PREPARED || log.state === State.COMMITTING) {
                const recoveryOwnerMemberId = this._selectRecoveryOwner(log);
                if (recoveryOwnerMemberId !== localMemberId || this._activeRecoveryRuns.has(txnId)) {
                    continue;
                }
                const recoveryRun = this._recoverBackupLog(txnId, log, localMemberId);
                this._activeRecoveryRuns.set(txnId, recoveryRun);
                try {
                    if (await recoveryRun) {
                        recovered++;
                    }
                } finally {
                    this._activeRecoveryRuns.delete(txnId);
                }
            }
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
        this._activeRecoveryRuns.clear();
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
        if (this._isBestEffortRecoveryMessage(message)) {
            return;
        }
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

    private _selectRecoveryOwner(log: TxBackupLog): string | null {
        const localMemberId = this._backupTransport?.localMemberId ?? 'local';
        if (log.backupMemberIds.length === 0) {
            return localMemberId;
        }

        return log.backupMemberIds.includes(localMemberId) ? localMemberId : null;
    }

    private _isMemberActive(memberId: string): boolean {
        if (this._backupTransport === null) {
            return memberId === 'local';
        }
        if (memberId === this._backupTransport.localMemberId) {
            return true;
        }
        return this._backupTransport.getActiveMemberIds().includes(memberId);
    }

    private async _recoverBackupLog(txnId: string, log: TxBackupLog, localMemberId: string): Promise<boolean> {
        const recoveryFenceToken = crypto.randomUUID();
        log.recoveryOwnerMemberId = localMemberId;
        log.recoveryFenceToken = recoveryFenceToken;
        log.recoveryState = 'IN_PROGRESS';

        try {
            await this._replicateToPreparedTargets(txnId, {
                type: 'TXN_RECOVERY_STARTED',
                txnId,
                recoveryMemberId: localMemberId,
                recoveryFenceToken,
            });

            if (!this._matchesRecoveryFence(log, localMemberId, recoveryFenceToken)) {
                return false;
            }

            for (const record of log.records) {
                if (!this._matchesRecoveryFence(log, localMemberId, recoveryFenceToken)) {
                    return false;
                }
                if (this._appliedRecordIdSet.has(record.recordId)) {
                    continue;
                }
                await this._backupExecutor!.commitRecord(record);
                this._rememberAppliedRecord(record.recordId);
            }

            if (!this._matchesRecoveryFence(log, localMemberId, recoveryFenceToken)) {
                return false;
            }

            log.recovered = true;
            log.recoveryState = 'COMPLETED';
            this._rememberRecoveredTxn(txnId);
            await this._replicateToPreparedTargets(txnId, {
                type: 'TXN_RECOVERED',
                txnId,
                recoveryMemberId: localMemberId,
                recoveryFenceToken,
            });
            await this._replicateToPreparedTargets(txnId, {
                type: 'TXN_PURGE',
                txnId,
            });
            this.txBackupLogs.delete(txnId);
            this._pendingBackupTargets.delete(txnId);
            return true;
        } catch (error) {
            if (this._isRecoveryFenceRejectedError(error)) {
                if (this._matchesRecoveryFence(log, localMemberId, recoveryFenceToken)) {
                    this._clearRecoveryFence(log, 'FAILED');
                }
                return false;
            }
            this._clearRecoveryFence(log, 'FAILED');
            try {
                await this._replicateToPreparedTargets(txnId, {
                    type: 'TXN_RECOVERY_FAILED',
                    txnId,
                    recoveryMemberId: localMemberId,
                    recoveryFenceToken,
                });
            } catch {
                // Ignore follow-up fence replication failures and surface the original error.
            }
            throw error;
        }
    }

    private _matchesRecoveryFence(log: TxBackupLog, recoveryMemberId: string, recoveryFenceToken: string): boolean {
        return log.recoveryOwnerMemberId === recoveryMemberId && log.recoveryFenceToken === recoveryFenceToken;
    }

    private _shouldAcceptRecoveryFence(log: TxBackupLog, recoveryMemberId: string, recoveryFenceToken: string): boolean {
        if (this._hasHigherPriorityLocalRecoveryCandidate(log, recoveryMemberId)) {
            return false;
        }
        if (log.recoveryState === 'COMPLETED') {
            return this._matchesRecoveryFence(log, recoveryMemberId, recoveryFenceToken);
        }
        if (log.recoveryOwnerMemberId === null || log.recoveryFenceToken === null) {
            return true;
        }
        if (log.recoveryOwnerMemberId === recoveryMemberId) {
            return true;
        }
        return this._compareRecoveryOwnerPriority(log, recoveryMemberId, log.recoveryOwnerMemberId) < 0;
    }

    private _compareRecoveryOwnerPriority(log: TxBackupLog, leftMemberId: string, rightMemberId: string): number {
        const leftRank = this._getRecoveryOwnerRank(log, leftMemberId);
        const rightRank = this._getRecoveryOwnerRank(log, rightMemberId);
        if (leftRank !== rightRank) {
            return leftRank - rightRank;
        }
        return leftMemberId.localeCompare(rightMemberId);
    }

    private _getRecoveryOwnerRank(log: TxBackupLog, memberId: string): number {
        const rank = log.backupMemberIds.indexOf(memberId);
        return rank === -1 ? Number.MAX_SAFE_INTEGER : rank;
    }

    private _hasHigherPriorityLocalRecoveryCandidate(log: TxBackupLog, recoveryMemberId: string): boolean {
        const localMemberId = this._backupTransport?.localMemberId ?? 'local';
        if (localMemberId === recoveryMemberId) {
            return false;
        }
        return this._compareRecoveryOwnerPriority(log, localMemberId, recoveryMemberId) < 0;
    }

    private _isRecoveryFenceRejectedError(error: unknown): boolean {
        return error instanceof Error && error.message.includes('Transaction backup replication was rejected');
    }

    private _isBestEffortRecoveryMessage(message: TransactionBackupMessage): boolean {
        return message.type === 'TXN_RECOVERY_STARTED'
            || message.type === 'TXN_RECOVERY_FAILED'
            || message.type === 'TXN_RECOVERED';
    }

    private _clearRecoveryFence(log: TxBackupLog, state: 'IDLE' | 'FAILED'): void {
        log.recovered = false;
        log.recoveryOwnerMemberId = null;
        log.recoveryFenceToken = null;
        log.recoveryState = state;
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
    copy.recoveryFenceToken = log.recoveryFenceToken;
    copy.recoveryState = log.recoveryState;
    return copy;
}
