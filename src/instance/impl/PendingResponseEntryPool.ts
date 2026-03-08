const MAX_POOLED_ENTRIES = 1024;

export interface PendingResponseEntry {
    callId: number;
    resolve: ((value: unknown) => void) | null;
    reject: ((error: Error) => void) | null;
    targetMemberId: string;
    createdAt: number;
    lastActivityAt: number;
    timeoutMs: number;
    deadlineAt: number;
    backupAckTimeoutMs: number;
    backupAckDeadlineAt: number;
    requiredBackupCount: number;
    receivedBackupCount: number;
    pendingResponse: unknown;
    acknowledgedBackupMemberIds: Set<string> | null;
    pendingBackupMemberIds: Set<string> | null;
}

export class PendingResponseEntryPool {
    private readonly _pool: PendingResponseEntry[] = [];

    take(
        callId: number,
        resolve: (value: unknown) => void,
        reject: (error: Error) => void,
        targetMemberId: string,
        timeoutMs: number,
        createdAt: number = Date.now(),
        requiredBackupCount: number = 0,
        backupAckTimeoutMs: number = timeoutMs,
    ): PendingResponseEntry {
        const entry = this._pool.pop() ?? {
            callId: 0,
            resolve: null,
            reject: null,
            targetMemberId: '',
            createdAt: 0,
            lastActivityAt: 0,
            timeoutMs: 0,
            deadlineAt: 0,
            backupAckTimeoutMs: 0,
            backupAckDeadlineAt: 0,
            requiredBackupCount: 0,
            receivedBackupCount: 0,
            pendingResponse: undefined,
            acknowledgedBackupMemberIds: null,
            pendingBackupMemberIds: null,
        };
        entry.callId = callId;
        entry.resolve = resolve;
        entry.reject = reject;
        entry.targetMemberId = targetMemberId;
        entry.createdAt = createdAt;
        entry.lastActivityAt = createdAt;
        entry.timeoutMs = timeoutMs;
        entry.deadlineAt = createdAt + timeoutMs;
        entry.backupAckTimeoutMs = backupAckTimeoutMs;
        entry.backupAckDeadlineAt = 0;
        entry.requiredBackupCount = requiredBackupCount;
        entry.receivedBackupCount = 0;
        entry.pendingResponse = undefined;
        entry.acknowledgedBackupMemberIds ??= new Set<string>();
        entry.acknowledgedBackupMemberIds.clear();
        entry.pendingBackupMemberIds ??= new Set<string>();
        entry.pendingBackupMemberIds.clear();
        return entry;
    }

    release(entry: PendingResponseEntry | null | undefined): void {
        if (entry == null) {
            return;
        }
        entry.callId = 0;
        entry.resolve = null;
        entry.reject = null;
        entry.targetMemberId = '';
        entry.createdAt = 0;
        entry.lastActivityAt = 0;
        entry.timeoutMs = 0;
        entry.deadlineAt = 0;
        entry.backupAckTimeoutMs = 0;
        entry.backupAckDeadlineAt = 0;
        entry.requiredBackupCount = 0;
        entry.receivedBackupCount = 0;
        entry.pendingResponse = undefined;
        entry.acknowledgedBackupMemberIds?.clear();
        entry.pendingBackupMemberIds?.clear();
        if (this._pool.length < MAX_POOLED_ENTRIES) {
            this._pool.push(entry);
        }
    }

    clear(): void {
        this._pool.length = 0;
    }
}
