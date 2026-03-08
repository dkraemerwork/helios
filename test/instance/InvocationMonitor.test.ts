import { InvocationMonitor } from '@zenystx/helios-core/instance/impl/InvocationMonitor';
import { describe, expect, test } from 'bun:test';

describe('InvocationMonitor', () => {
    test('times out through the sweeper and ignores a late response', () => {
        const monitor = new InvocationMonitor(undefined, 10_000);
        const outcomes: string[] = [];

        monitor.register({
            callId: 1,
            resolve: () => outcomes.push('resolved'),
            reject: (error) => outcomes.push(error.message),
            targetMemberId: 'member-a',
            timeoutMs: 50,
            createdAt: 100,
        });

        monitor.sweep(151);
        monitor.handleResponse({ callId: 1, backupAcks: 0, backupMemberIds: [], payload: 'late', error: null }, 152);

        expect(outcomes).toEqual(['Operation timed out (callId=1)']);
        expect(monitor.getStats().lateResponsesIgnored).toBe(1);
        expect(monitor.activeCount()).toBe(0);
    });

    test('ignores duplicate responses after successful completion', () => {
        const monitor = new InvocationMonitor(undefined, 10_000);
        const outcomes: unknown[] = [];

        monitor.register({
            callId: 2,
            resolve: (value) => outcomes.push(value),
            reject: (error) => outcomes.push(error.message),
            targetMemberId: 'member-a',
            timeoutMs: 50,
            createdAt: 100,
        });

        monitor.handleResponse({ callId: 2, backupAcks: 0, backupMemberIds: [], payload: 'ok', error: null }, 120);
        monitor.handleResponse({ callId: 2, backupAcks: 0, backupMemberIds: [], payload: 'dup', error: null }, 121);

        expect(outcomes).toEqual(['ok']);
        expect(monitor.getStats().duplicateResponsesIgnored).toBe(1);
    });

    test('fails member-targeted invocations immediately and ignores late backup acks', () => {
        const monitor = new InvocationMonitor(undefined, 10_000);
        const outcomes: string[] = [];

        monitor.register({
            callId: 3,
            resolve: () => outcomes.push('resolved'),
            reject: (error) => outcomes.push(error.message),
            targetMemberId: 'member-b',
            timeoutMs: 500,
            createdAt: 100,
        });

        monitor.failInvocationsForMember('member-b', 140);
        monitor.handleBackupAck({ callId: 3, senderId: 'backup-b' }, 141);

        expect(outcomes).toEqual(['Target member member-b left before invocation completed (callId=3)']);
        expect(monitor.getStats().memberLeftFailures).toBe(1);
        expect(monitor.getStats().lateBackupAcksIgnored).toBe(1);
    });

    test('waits for sync backup acks before completing and tolerates early ack arrival', () => {
        const monitor = new InvocationMonitor(undefined, 10_000);
        const outcomes: unknown[] = [];

        monitor.register({
            callId: 4,
            resolve: (value) => outcomes.push(value),
            reject: (error) => outcomes.push(error.message),
            targetMemberId: 'member-a',
            timeoutMs: 100,
            backupAckTimeoutMs: 40,
            createdAt: 100,
        });

        monitor.handleBackupAck({ callId: 4, senderId: 'backup-1' }, 105);
        monitor.handleResponse({
            callId: 4,
            backupAcks: 2,
            backupMemberIds: ['backup-1', 'backup-2'],
            payload: 'ok',
            error: null,
        }, 110);
        expect(outcomes).toEqual([]);

        monitor.handleBackupAck({ callId: 4, senderId: 'backup-2' }, 120);
        expect(outcomes).toEqual(['ok']);
    });

    test('ignores unexpected early backup acks until the expected backup acknowledges', () => {
        const monitor = new InvocationMonitor(undefined, 10_000);
        const outcomes: unknown[] = [];

        monitor.register({
            callId: 7,
            resolve: (value) => outcomes.push(value),
            reject: (error) => outcomes.push(error.message),
            targetMemberId: 'member-a',
            timeoutMs: 100,
            backupAckTimeoutMs: 40,
            createdAt: 100,
        });

        monitor.handleBackupAck({ callId: 7, senderId: 'unexpected-backup' }, 105);
        monitor.handleResponse({
            callId: 7,
            backupAcks: 1,
            backupMemberIds: ['backup-1'],
            payload: 'ok',
            error: null,
        }, 110);
        expect(outcomes).toEqual([]);

        monitor.handleBackupAck({ callId: 7, senderId: 'backup-1' }, 120);
        expect(outcomes).toEqual(['ok']);
    });

    test('fails on backup ack timeout with explicit error', () => {
        const monitor = new InvocationMonitor(undefined, 10_000);
        const outcomes: string[] = [];

        monitor.register({
            callId: 5,
            resolve: () => outcomes.push('resolved'),
            reject: (error) => outcomes.push(error.message),
            targetMemberId: 'member-a',
            timeoutMs: 100,
            backupAckTimeoutMs: 25,
            createdAt: 100,
        });

        monitor.handleResponse({
            callId: 5,
            backupAcks: 1,
            backupMemberIds: ['backup-1'],
            payload: 'ok',
            error: null,
        }, 110);
        monitor.sweep(136);

        expect(outcomes).toEqual(['Backup ack timed out (callId=5, required=1, received=0)']);
        expect(monitor.getStats().backupAckTimeoutFailures).toBe(1);
    });

    test('fails promptly when a pending backup member leaves before ack', () => {
        const monitor = new InvocationMonitor(undefined, 10_000);
        const outcomes: string[] = [];

        monitor.register({
            callId: 6,
            resolve: () => outcomes.push('resolved'),
            reject: (error) => outcomes.push(error.message),
            targetMemberId: 'member-a',
            timeoutMs: 100,
            backupAckTimeoutMs: 50,
            createdAt: 100,
        });

        monitor.handleResponse({
            callId: 6,
            backupAcks: 1,
            backupMemberIds: ['backup-1'],
            payload: 'ok',
            error: null,
        }, 110);
        monitor.failInvocationsForMember('backup-1', 115);

        expect(outcomes).toEqual(['Backup member backup-1 left before acknowledgement completed (callId=6)']);
    });
});
