import type { BackupAckMsg, OperationResponseMsg } from '@zenystx/helios-core/cluster/tcp/ClusterMessage';
import { PendingResponseEntryPool, type PendingResponseEntry } from '@zenystx/helios-core/instance/impl/PendingResponseEntryPool';

export interface InvocationMonitorStats {
    duplicateResponsesIgnored: number;
    lateResponsesIgnored: number;
    lateBackupAcksIgnored: number;
    memberLeftFailures: number;
    timeoutFailures: number;
    backupAckTimeoutFailures: number;
}

interface InvocationTerminalState {
    outcome: 'completed' | 'failed';
    completedAt: number;
}

const DEFAULT_TERMINAL_RETENTION_MS = 60_000;

export class InvocationMonitor {
    private readonly _active = new Map<number, PendingResponseEntry>();
    private readonly _terminal = new Map<number, InvocationTerminalState>();
    private readonly _stats: InvocationMonitorStats = {
        duplicateResponsesIgnored: 0,
        lateResponsesIgnored: 0,
        lateBackupAcksIgnored: 0,
        memberLeftFailures: 0,
        timeoutFailures: 0,
        backupAckTimeoutFailures: 0,
    };

    constructor(
        private readonly _pool: PendingResponseEntryPool = new PendingResponseEntryPool(),
        private readonly _terminalRetentionMs: number = DEFAULT_TERMINAL_RETENTION_MS,
    ) {}

    register(options: {
        callId: number;
        resolve: (value: unknown) => void;
        reject: (error: Error) => void;
        targetMemberId: string;
        timeoutMs: number;
        createdAt?: number;
        requiredBackupCount?: number;
        backupAckTimeoutMs?: number;
    }): PendingResponseEntry {
        const entry = this._pool.take(
            options.callId,
            options.resolve,
            options.reject,
            options.targetMemberId,
            options.timeoutMs,
            options.createdAt,
            options.requiredBackupCount,
            options.backupAckTimeoutMs,
        );
        this._active.set(options.callId, entry);
        return entry;
    }

    activeCount(): number {
        return this._active.size;
    }

    getStats(): InvocationMonitorStats {
        return { ...this._stats };
    }

    hasActiveInvocation(callId: number): boolean {
        return this._active.has(callId);
    }

    handleResponse(message: Pick<OperationResponseMsg, 'callId' | 'payload' | 'error' | 'backupAcks' | 'backupMemberIds'>, now: number = Date.now()): boolean {
        const entry = this._active.get(message.callId);
        if (entry === undefined) {
            this._recordIgnoredResponse(message.callId);
            this._pruneTerminal(now);
            return false;
        }
        entry.lastActivityAt = now;
        if (message.error !== null) {
            this._failEntry(entry, new Error(message.error), now);
            return true;
        }

        entry.requiredBackupCount = Math.max(0, message.backupAcks);
        entry.pendingResponse = message.payload;
        entry.pendingBackupMemberIds?.clear();
        let acknowledgedExpectedBackups = 0;
        for (const memberId of message.backupMemberIds) {
            if (entry.acknowledgedBackupMemberIds?.has(memberId)) {
                acknowledgedExpectedBackups += 1;
                continue;
            }
            entry.pendingBackupMemberIds?.add(memberId);
        }
        entry.receivedBackupCount = acknowledgedExpectedBackups;
        if (entry.requiredBackupCount > entry.receivedBackupCount) {
            entry.backupAckDeadlineAt = now + entry.backupAckTimeoutMs;
            return true;
        }

        this._completeEntry(entry, message.payload, now);
        return true;
    }

    handleBackupAck(message: Pick<BackupAckMsg, 'callId' | 'senderId'>, now: number = Date.now()): boolean {
        const entry = this._active.get(message.callId);
        if (entry === undefined) {
            this._stats.lateBackupAcksIgnored += 1;
            this._pruneTerminal(now);
            return false;
        }
        entry.lastActivityAt = now;
        if (entry.acknowledgedBackupMemberIds?.has(message.senderId) !== true) {
            entry.acknowledgedBackupMemberIds?.add(message.senderId);
            entry.receivedBackupCount += 1;
            entry.pendingBackupMemberIds?.delete(message.senderId);
        }
        if (entry.pendingResponse !== undefined && entry.receivedBackupCount >= entry.requiredBackupCount) {
            this._completeEntry(entry, entry.pendingResponse, now);
        }
        return true;
    }

    failInvocation(callId: number, error: Error, now: number = Date.now()): boolean {
        const entry = this._active.get(callId);
        if (entry === undefined) {
            this._pruneTerminal(now);
            return false;
        }
        this._failEntry(entry, error, now);
        return true;
    }

    failInvocationsForMember(memberId: string, now: number = Date.now()): number {
        let failedCount = 0;
        for (const entry of Array.from(this._active.values())) {
            if (entry.targetMemberId !== memberId) {
                if (entry.pendingBackupMemberIds?.has(memberId) !== true) {
                    continue;
                }
                failedCount += 1;
                this._stats.memberLeftFailures += 1;
                this._failEntry(
                    entry,
                    new Error(`Backup member ${memberId} left before acknowledgement completed (callId=${entry.callId})`),
                    now,
                );
                continue;
            }
            failedCount += 1;
            this._stats.memberLeftFailures += 1;
            this._failEntry(
                entry,
                new Error(`Target member ${memberId} left before invocation completed (callId=${entry.callId})`),
                now,
            );
        }
        this._pruneTerminal(now);
        return failedCount;
    }

    sweep(now: number = Date.now()): void {
        for (const entry of Array.from(this._active.values())) {
            if (
                entry.pendingResponse !== undefined
                && entry.requiredBackupCount > entry.receivedBackupCount
                && entry.backupAckDeadlineAt > 0
                && now >= entry.backupAckDeadlineAt
            ) {
                this._stats.backupAckTimeoutFailures += 1;
                this._failEntry(
                    entry,
                    new Error(
                        `Backup ack timed out (callId=${entry.callId}, required=${entry.requiredBackupCount}, received=${entry.receivedBackupCount})`,
                    ),
                    now,
                );
                continue;
            }
            if (now < entry.deadlineAt) {
                continue;
            }
            this._stats.timeoutFailures += 1;
            this._failEntry(
                entry,
                new Error(`Operation timed out (callId=${entry.callId})`),
                now,
            );
        }
        this._pruneTerminal(now);
    }

    reset(cause: Error, now: number = Date.now()): void {
        for (const entry of Array.from(this._active.values())) {
            this._failEntry(entry, cause, now);
        }
        this._pruneTerminal(now);
    }

    private _recordIgnoredResponse(callId: number): void {
        const terminal = this._terminal.get(callId);
        if (terminal === undefined) {
            this._stats.lateResponsesIgnored += 1;
            return;
        }
        if (terminal.outcome === 'completed') {
            this._stats.duplicateResponsesIgnored += 1;
            return;
        }
        this._stats.lateResponsesIgnored += 1;
    }

    private _completeEntry(entry: PendingResponseEntry, value: unknown, now: number): void {
        this._active.delete(entry.callId);
        this._terminal.set(entry.callId, { outcome: 'completed', completedAt: now });
        entry.resolve?.(value);
        this._pool.release(entry);
    }

    private _failEntry(entry: PendingResponseEntry, error: Error, now: number): void {
        this._active.delete(entry.callId);
        this._terminal.set(entry.callId, { outcome: 'failed', completedAt: now });
        entry.reject?.(error);
        this._pool.release(entry);
    }

    private _pruneTerminal(now: number): void {
        for (const [callId, terminal] of this._terminal) {
            if (now - terminal.completedAt < this._terminalRetentionMs) {
                continue;
            }
            this._terminal.delete(callId);
        }
    }
}
