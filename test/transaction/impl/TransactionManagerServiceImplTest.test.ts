/**
 * Port of {@code com.hazelcast.transaction.impl.TransactionManagerServiceImplTest}.
 *
 * Tests backup log management operations on TransactionManagerServiceImpl.
 */
import { TestNodeEngine } from '@zenystx/helios-core/test-support/TestNodeEngine';
import type { TransactionBackupRecord } from '@zenystx/helios-core/transaction/impl/TransactionBackupRecord';
import { State } from '@zenystx/helios-core/transaction/impl/Transaction';
import { TransactionManagerServiceImpl } from '@zenystx/helios-core/transaction/impl/TransactionManagerServiceImpl';
import { TransactionException } from '@zenystx/helios-core/transaction/TransactionException';
import { beforeEach, describe, expect, it } from 'bun:test';

const TXN = crypto.randomUUID();

describe('TransactionManagerServiceImplTest', () => {
    let txService: TransactionManagerServiceImpl;

    beforeEach(() => {
        const nodeEngine = new TestNodeEngine();
        txService = new TransactionManagerServiceImpl(nodeEngine);
    });

    // ── createBackupLog ─────────────────────────────────────────────────

    it('createBackupLog_whenNotCreated', () => {
        const callerUuid = crypto.randomUUID();
        void txService.createBackupLog(callerUuid, TXN);
        assertTxLogState(TXN, State.ACTIVE);
    });

    it('rememberBackupTargets_requiresConfirmedBackups', async () => {
        txService.configureReplication({
            localMemberId: 'local',
            getBackupMemberIds: () => ['backup-a', 'backup-b'],
            getActiveMemberIds: () => ['local', 'backup-a'],
            validateBackupMembers: async () => ['backup-a'],
            replicate: async () => ['backup-a'],
        }, null);

        await expect(txService.rememberBackupTargets(TXN, ['backup-a', 'backup-b'])).rejects.toThrow(TransactionException);
    });

    it('createBackupLog_whenAlreadyExist', () => {
        const callerUuid = crypto.randomUUID();
        void txService.createBackupLog(callerUuid, TXN);
        expect(() => txService.createBackupLog(callerUuid, TXN)).toThrow(TransactionException);
    });

    // ── replicaBackupLog ────────────────────────────────────────────────

    it('replicaBackupLog_whenNotExist_thenTransactionException', () => {
        const callerUuid = crypto.randomUUID();
        expect(() => txService.replicaBackupLog([], callerUuid, TXN, 1, 1)).toThrow(TransactionException);
    });

    it('replicaBackupLog_whenExist', async () => {
        const callerUuid = crypto.randomUUID();
        await txService.createBackupLog(callerUuid, TXN);
        await txService.replicaBackupLog([], callerUuid, TXN, 1, 1);
        assertTxLogState(TXN, State.PREPARED);
    });

    it('replicaBackupLog_whenNotActive', () => {
        const callerUuid = crypto.randomUUID();
        void txService.createBackupLog(callerUuid, TXN);
        txService.txBackupLogs.get(TXN)!.state = State.ROLLED_BACK;
        expect(() => txService.replicaBackupLog([], callerUuid, TXN, 1, 1)).toThrow(TransactionException);
    });

    // ── rollbackBackupLog ───────────────────────────────────────────────

    it('rollbackBackupLog_whenExist', async () => {
        const callerUuid = crypto.randomUUID();
        await txService.createBackupLog(callerUuid, TXN);
        await txService.rollbackBackupLog(TXN);
        assertTxLogState(TXN, State.ROLLING_BACK);
    });

    it('rollbackBackupLog_whenNotExist_thenIgnored', () => {
        // should not throw
        txService.rollbackBackupLog(TXN);
    });

    // ── purgeBackupLog ──────────────────────────────────────────────────

    it('purgeBackupLog_whenExist_thenRemoved', () => {
        const callerUuid = crypto.randomUUID();
        void txService.createBackupLog(callerUuid, TXN);
        void txService.purgeBackupLog(TXN);
        expect(txService.txBackupLogs.has(TXN)).toBe(false);
    });

    it('purgeBackupLog_whenNotExist_thenIgnored', () => {
        // should not throw
        txService.purgeBackupLog(TXN);
    });

    it('rejects lower-priority recovery fences from divergent members', async () => {
        const replicatedMessages: string[] = [];
        const committedRecords: string[] = [];
        txService.configureReplication({
            localMemberId: 'backup-a',
            getBackupMemberIds: () => ['backup-a', 'backup-b'],
            getActiveMemberIds: () => ['backup-a', 'backup-b'],
            validateBackupMembers: async (targets) => [...targets],
            replicate: async (message, targets) => {
                replicatedMessages.push(`${message.type}:${targets.join(',')}`);
                return [...targets];
            },
        }, {
            commitRecord: async (record) => {
                committedRecords.push(record.recordId);
            },
        });

        txService.applyBackupMessage({
            type: 'TXN_PREPARE',
            txnId: TXN,
            coordinatorMemberId: 'local',
            callerUuid: 'caller',
            timeoutMillis: 1,
            startTime: 1,
            allowedDuringPassiveState: false,
            backupMemberIds: ['backup-a', 'backup-b'],
            records: [makeMapRecord('record-a')],
        });

        expect(txService.applyBackupMessage({
            type: 'TXN_RECOVERY_STARTED',
            txnId: TXN,
            recoveryMemberId: 'backup-b',
            recoveryFenceToken: 'fence-b',
        })).toBe(false);

        expect(await txService.recoverBackupLogsForCoordinator('local')).toBe(1);
        expect(committedRecords).toEqual(['record-a']);
        expect(replicatedMessages.some((message) => message.startsWith('TXN_RECOVERY_STARTED'))).toBe(true);
    });

    it('does not re-enter recovery while the winner is still replaying', async () => {
        const gate: { resolve?: () => void } = {};
        let commitCalls = 0;
        txService.configureReplication({
            localMemberId: 'backup-a',
            getBackupMemberIds: () => ['backup-a'],
            getActiveMemberIds: () => ['backup-a'],
            validateBackupMembers: async (targets) => [...targets],
            replicate: async (_message, targets) => [...targets],
        }, {
            commitRecord: async () => {
                commitCalls++;
                await new Promise<void>((resolve) => {
                    gate.resolve = resolve;
                });
            },
        });

        txService.applyBackupMessage({
            type: 'TXN_PREPARE',
            txnId: TXN,
            coordinatorMemberId: 'local',
            callerUuid: 'caller',
            timeoutMillis: 1,
            startTime: 1,
            allowedDuringPassiveState: false,
            backupMemberIds: ['backup-a'],
            records: [makeMapRecord('record-b')],
        });

        const firstRecovery = txService.recoverBackupLogsForCoordinator('local');
        await waitFor(() => txService.getBackupLog(TXN)?.recoveryState === 'IN_PROGRESS');

        const secondRecovery = txService.recoverBackupLogsForCoordinator('local');
        await Bun.sleep(25);
        expect(commitCalls).toBe(1);

        if (gate.resolve === undefined) {
            throw new Error('Expected replay to be waiting for completion');
        }
        const releaseCommit = gate.resolve;
        releaseCommit();
        expect(await firstRecovery).toBe(1);
        expect(await secondRecovery).toBe(0);
        expect(commitCalls).toBe(1);
    });

    // ── helper ──────────────────────────────────────────────────────────

    function makeMapRecord(recordId: string): TransactionBackupRecord {
        return {
            recordId,
            kind: 'map',
            mapName: 'durable-map',
            partitionId: 1,
            entry: {
                opType: 'put',
                key: { bytes: Buffer.from('key') },
                value: { bytes: Buffer.from('value') },
                oldValue: null,
            },
        };
    }

    async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        while (!predicate()) {
            if (Date.now() >= deadline) {
                throw new Error(`waitFor timed out after ${timeoutMs}ms`);
            }
            await Bun.sleep(10);
        }
    }

    function assertTxLogState(txId: string, state: State): void {
        const backupLog = txService.txBackupLogs.get(txId);
        expect(backupLog).not.toBeNull();
        expect(backupLog).not.toBeUndefined();
        expect(backupLog!.state).toBe(state);
    }
});
