import { PendingResponseEntryPool } from '@zenystx/helios-core/instance/impl/PendingResponseEntryPool';
import { describe, expect, test } from 'bun:test';

describe('PendingResponseEntryPool', () => {
    test('reuses pooled entries and clears callback references on release', () => {
        const pool = new PendingResponseEntryPool();
        const resolve = () => {};
        const reject = () => {};
        const entry = pool.take(7, resolve, reject, 'member-a', 25, 100, 2, 15);

        pool.release(entry);

        expect(entry.callId).toBe(0);
        expect(entry.resolve).toBeNull();
        expect(entry.reject).toBeNull();
        expect(entry.targetMemberId).toBe('');
        expect(entry.createdAt).toBe(0);
        expect(entry.lastActivityAt).toBe(0);
        expect(entry.timeoutMs).toBe(0);
        expect(entry.deadlineAt).toBe(0);
        expect(entry.backupAckTimeoutMs).toBe(0);
        expect(entry.backupAckDeadlineAt).toBe(0);
        expect(entry.requiredBackupCount).toBe(0);
        expect(entry.receivedBackupCount).toBe(0);
        expect(entry.pendingResponse).toBeUndefined();
        expect(entry.acknowledgedBackupMemberIds?.size).toBe(0);
        expect(entry.pendingBackupMemberIds?.size).toBe(0);

        const reused = pool.take(8, resolve, reject, 'member-b', 50, 200, 1, 30);
        expect(reused).toBe(entry);
        expect(reused.callId).toBe(8);
        expect(reused.targetMemberId).toBe('member-b');
        expect(reused.createdAt).toBe(200);
        expect(reused.lastActivityAt).toBe(200);
        expect(reused.timeoutMs).toBe(50);
        expect(reused.deadlineAt).toBe(250);
        expect(reused.backupAckTimeoutMs).toBe(30);
        expect(reused.requiredBackupCount).toBe(1);
    });
});
